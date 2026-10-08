import { type AiProvider, AiProviderError, type AiUsage } from '@leadora/ai';
import { aiPromptVersions, aiRuns, aiSettings, type Database, type ModelPrice } from '@leadora/database';
import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DomainError } from '../errors';
import { decryptSecret } from '../secrets';
import { getBuiltinPrompt } from './prompts';

export interface AiDeps {
  /** Platform kill switch (ENABLE_AI). */
  platformEnabled: boolean;
  encryptionKey: string;
  providerFor: (provider: string, apiKey: string) => AiProvider;
}

export interface AiContext {
  organizationId: string;
  userId: string | null;
}

export interface StructuredTask<T> {
  purpose: string;
  promptKey: string;
  schema: z.ZodType<T>;
  input: string;
  entity?: { type: string; id: string };
}

export function estimateCostUsd(price: ModelPrice | undefined, usage: AiUsage): number | null {
  if (!price) return null;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedTokens);
  return (uncached * price.input + usage.cachedTokens * price.cachedInput + usage.outputTokens * price.output) / 1_000_000;
}

const addUsage = (a: AiUsage, b: AiUsage): AiUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cachedTokens: a.cachedTokens + b.cachedTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

function parseJson<T>(schema: z.ZodType<T>, text: string): { ok: true; data: T } | { ok: false; problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'The output was not valid JSON.' };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, problem: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
}

export async function monthToDateSpendUsd(db: Database, organizationId: string, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${aiRuns.estimatedCostUsd}), 0)` })
    .from(aiRuns)
    .where(and(eq(aiRuns.organizationId, organizationId), gte(aiRuns.createdAt, start)));
  return Number(row?.total ?? 0);
}

/**
 * The single path for structured AI calls (spec §25–30, §75): checks switches, configuration and budget,
 * calls the provider with the active prompt version, validates with one corrective retry, and records an
 * ai_runs row for every outcome. Throws DomainError on any failure, so callers never persist bad output.
 */
export async function runStructured<T>(db: Database, deps: AiDeps, ctx: AiContext, task: StructuredTask<T>): Promise<{ data: T; runId: string }> {
  // Distinct from AI_DISABLED: only the server operator (ENABLE_AI) can lift this, not an org admin.
  if (!deps.platformEnabled) throw new DomainError('conflict', 'AI_PLATFORM_DISABLED', 'AI is turned off for this installation');
  const [settings] = await db.select().from(aiSettings).where(eq(aiSettings.organizationId, ctx.organizationId));
  if (!settings?.enabled) throw new DomainError('conflict', 'AI_DISABLED', 'AI is turned off for your organization');

  const builtin = getBuiltinPrompt(task.promptKey);
  if (settings.features[builtin.feature] === false) {
    throw new DomainError('conflict', 'AI_FEATURE_DISABLED', 'This AI feature is turned off for your organization');
  }
  if (!settings.apiKeyEnc) throw new DomainError('conflict', 'AI_NOT_CONFIGURED', 'Add an AI provider API key in AI settings');

  const [active] = await db
    .select()
    .from(aiPromptVersions)
    .where(and(eq(aiPromptVersions.organizationId, ctx.organizationId), eq(aiPromptVersions.promptKey, task.promptKey), eq(aiPromptVersions.active, true)));
  const prompt = active
    ? { version: active.version, system: active.systemPrompt, profile: active.modelProfile, maxOutputTokens: active.maxOutputTokens, temperature: active.temperature ? Number(active.temperature) : undefined }
    : { version: 0, system: builtin.systemPrompt, profile: builtin.modelProfile, maxOutputTokens: builtin.maxOutputTokens, temperature: undefined };

  const model = settings.models[prompt.profile as keyof typeof settings.models];
  if (!model) throw new DomainError('conflict', 'AI_NOT_CONFIGURED', `Choose a model for the "${prompt.profile}" profile in AI settings`);

  const record = async (values: Partial<typeof aiRuns.$inferInsert> & { status: 'SUCCEEDED' | 'FAILED' | 'BLOCKED' }) => {
    const [run] = await db
      .insert(aiRuns)
      .values({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        provider: settings.provider,
        model,
        purpose: task.purpose,
        promptKey: task.promptKey,
        promptVersion: prompt.version,
        entityType: task.entity?.type ?? null,
        entityId: task.entity?.id ?? null,
        ...values,
      })
      .returning({ id: aiRuns.id });
    return run!.id;
  };

  const budget = settings.monthlyBudgetUsd === null ? null : Number(settings.monthlyBudgetUsd);
  if (budget !== null && (await monthToDateSpendUsd(db, ctx.organizationId)) >= budget) {
    await record({ status: 'BLOCKED', errorCode: 'AI_BUDGET_EXCEEDED', attempts: 0 });
    throw new DomainError('conflict', 'AI_BUDGET_EXCEEDED', 'The monthly AI budget is used up');
  }

  const provider = deps.providerFor(settings.provider, decryptSecret(settings.apiKeyEnc, deps.encryptionKey));
  const jsonSchema = z.toJSONSchema(task.schema, { target: 'draft-7' }) as Record<string, unknown>;
  const started = Date.now();
  let usage: AiUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
  let requestId: string | null = null;
  let input = task.input;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let text: string;
    try {
      const res = await provider.generateStructured({
        model,
        system: prompt.system,
        input,
        jsonSchema,
        schemaName: task.promptKey,
        maxOutputTokens: prompt.maxOutputTokens,
        temperature: prompt.temperature,
      });
      usage = addUsage(usage, res.usage);
      requestId = res.requestId;
      text = res.text;
    } catch (err) {
      const code = err instanceof AiProviderError ? err.code : 'AI_UNAVAILABLE';
      await record({ status: 'FAILED', errorCode: code, attempts: attempt, latencyMs: Date.now() - started, ...usage, estimatedCostUsd: costOf(usage) });
      throw new DomainError('upstream', code, err instanceof AiProviderError ? err.message : 'The AI provider failed');
    }

    const parsed = parseJson(task.schema, text);
    if (parsed.ok) {
      const runId = await record({ status: 'SUCCEEDED', attempts: attempt, latencyMs: Date.now() - started, requestId, ...usage, estimatedCostUsd: costOf(usage) });
      return { data: parsed.data, runId };
    }
    // Spec §30: retry once with a correction instruction.
    input = `${task.input}\n\nYour previous answer was rejected: ${parsed.problem}\nReturn only a JSON object that matches the required schema.`;
  }

  await record({ status: 'FAILED', errorCode: 'AI_INVALID_OUTPUT', attempts: 2, latencyMs: Date.now() - started, requestId, ...usage, estimatedCostUsd: costOf(usage) });
  throw new DomainError('upstream', 'AI_INVALID_OUTPUT', 'The AI returned an answer we could not use. Please try again.');

  function costOf(u: AiUsage) {
    const cost = estimateCostUsd(settings!.prices[model!], u);
    return cost === null ? null : cost.toFixed(6);
  }
}
