import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AiProvider } from '@leadora/ai';
import type { Env } from '@leadora/config';
import {
  activities,
  aiAnalyses,
  aiPromptVersions,
  aiRuns,
  aiSettings,
  conversations,
  type DbHandle,
  leads,
  messages,
  users,
} from '@leadora/database';
import { type AiDeps, BUILTIN_PROMPTS, dataBlock, encryptSecret, monthToDateSpendUsd, runStructured } from '@leadora/domain';
import { and, asc, desc, eq, gte, inArray, max, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { AI_PROVIDER_FACTORY, DB, ENV } from '../infra/tokens';
import { LeadReader } from '../leads/lead-reader.service';
import { DEFAULT_FEATURES, leadAnalysisSchema, type PromptVersionInput, temperatureFor, type UpdateSettingsInput } from './ai.schemas';

type ProviderFactory = (provider: string, apiKey: string) => AiProvider;

@Injectable()
export class AiService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(AI_PROVIDER_FACTORY) private readonly providerFor: ProviderFactory,
    private readonly reader: LeadReader,
  ) {}

  deps(): AiDeps {
    return { platformEnabled: this.env.ENABLE_AI, encryptionKey: this.env.DATA_ENCRYPTION_KEY, providerFor: this.providerFor };
  }

  async getSettings(auth: AuthContext) {
    const [row] = await this.handle.db.select().from(aiSettings).where(eq(aiSettings.organizationId, auth.organizationId));
    return {
      provider: row?.provider ?? 'openai',
      enabled: row?.enabled ?? false,
      platformEnabled: this.env.ENABLE_AI,
      hasApiKey: !!row?.apiKeyEnc,
      apiKeyLast4: row?.apiKeyLast4 ?? null,
      models: row?.models ?? {},
      features: { ...DEFAULT_FEATURES, ...(row?.features ?? {}) },
      monthlyBudgetUsd: row?.monthlyBudgetUsd == null ? null : Number(row.monthlyBudgetUsd),
      prices: row?.prices ?? {},
      monthToDateSpendUsd: await monthToDateSpendUsd(this.handle.db, auth.organizationId),
    };
  }

  async updateSettings(auth: AuthContext, input: UpdateSettingsInput) {
    const [current] = await this.handle.db.select().from(aiSettings).where(eq(aiSettings.organizationId, auth.organizationId));
    const models = input.models
      ? Object.fromEntries(Object.entries({ ...(current?.models ?? {}), ...input.models }).filter(([, v]) => v))
      : undefined;
    const values = {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.apiKey !== undefined
        ? input.apiKey === ''
          ? { apiKeyEnc: null, apiKeyLast4: null }
          : { apiKeyEnc: encryptSecret(input.apiKey, this.env.DATA_ENCRYPTION_KEY), apiKeyLast4: input.apiKey.slice(-4) }
        : {}),
      ...(models ? { models } : {}),
      ...(input.features ? { features: { ...(current?.features ?? {}), ...input.features } } : {}),
      ...(input.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: input.monthlyBudgetUsd === null ? null : String(input.monthlyBudgetUsd) } : {}),
      ...(input.prices ? { prices: { ...(current?.prices ?? {}), ...input.prices } } : {}),
      updatedByUserId: auth.userId,
      updatedAt: new Date(),
    };
    await this.handle.db
      .insert(aiSettings)
      .values({ organizationId: auth.organizationId, ...values })
      .onConflictDoUpdate({ target: aiSettings.organizationId, set: values });
    return this.getSettings(auth);
  }

  /** Builds the analysis input from CRM data, every untrusted part wrapped as data (spec §56). */
  private async leadInput(auth: AuthContext, leadId: string) {
    const lead = await this.reader.get(auth.organizationId, leadId);
    const recent = await this.handle.db
      .select({ type: activities.type, payload: activities.payload, createdAt: activities.createdAt })
      .from(activities)
      .where(and(eq(activities.organizationId, auth.organizationId), eq(activities.leadId, leadId)))
      .orderBy(desc(activities.seq))
      .limit(20);
    const convIds = (
      await this.handle.db.select({ id: conversations.id }).from(conversations).where(eq(conversations.leadId, leadId))
    ).map((c) => c.id);
    const msgs = convIds.length
      ? await this.handle.db
          .select({ direction: messages.direction, content: messages.content, createdAt: messages.createdAt })
          .from(messages)
          .where(and(inArray(messages.conversationId, convIds), sql`${messages.direction} <> 'INTERNAL'`))
          .orderBy(desc(messages.seq))
          .limit(10)
      : [];

    const profile = {
      name: lead.fullName,
      company: lead.companyName,
      jobTitle: lead.jobTitle,
      location: lead.location,
      industry: lead.industry,
      budget: lead.budget,
      currency: lead.currency,
      priority: lead.priority,
      stage: lead.stage.name,
      source: lead.source.name,
      tags: lead.tags,
      customFields: lead.customFields,
      notes: lead.notes,
      createdAt: lead.createdAt,
      lastContactedAt: lead.lastContactedAt,
    };
    const timeline = recent
      .reverse()
      .map((a) => `${a.createdAt.toISOString()} ${a.type}${a.type === 'note.added' ? `: ${String((a.payload as { body?: unknown } | null)?.body ?? '')}` : ''}`)
      .join('\n');
    const thread = msgs
      .reverse()
      .map((m) => `${m.createdAt.toISOString()} ${m.direction === 'INBOUND' ? 'CUSTOMER' : 'US'}: ${m.content.slice(0, 1000)}`)
      .join('\n');

    return {
      lead,
      input: [
        `Today is ${new Date().toISOString().slice(0, 10)}. Analyse this lead.`,
        dataBlock('lead', JSON.stringify(profile, null, 2)),
        dataBlock('timeline', timeline || '(no activity yet)'),
        dataBlock('messages', thread || '(no messages yet)'),
      ].join('\n\n'),
    };
  }

  async analyzeLead(auth: AuthContext, leadId: string) {
    const { lead, input } = await this.leadInput(auth, leadId);
    if (lead.archivedAt) throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Restore this lead first' });
    const { data, runId } = await runStructured(
      this.handle.db,
      this.deps(),
      { organizationId: auth.organizationId, userId: auth.userId },
      { purpose: 'lead_analysis', promptKey: 'lead_analysis', schema: leadAnalysisSchema, input, entity: { type: 'lead', id: leadId } },
    );
    const temperature = temperatureFor(data.score);
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(aiAnalyses).values({ organizationId: auth.organizationId, entityType: 'lead', entityId: leadId, purpose: 'lead_analysis', runId, result: data });
      await tx.update(leads).set({ score: data.score, temperature }).where(eq(leads.id, leadId));
      await tx.insert(activities).values({
        organizationId: auth.organizationId,
        leadId,
        actorUserId: auth.userId,
        type: 'ai.analysis_completed',
        payload: { score: data.score, previousScore: lead.score, temperature, intent: data.intent, recommendedAction: data.recommendedAction },
      });
    });
    return data;
  }

  async latestAnalysis(auth: AuthContext, leadId: string) {
    await this.reader.get(auth.organizationId, leadId);
    const [row] = await this.handle.db
      .select({ result: aiAnalyses.result, createdAt: aiAnalyses.createdAt })
      .from(aiAnalyses)
      .where(and(eq(aiAnalyses.organizationId, auth.organizationId), eq(aiAnalyses.entityId, leadId), eq(aiAnalyses.purpose, 'lead_analysis')))
      .orderBy(desc(aiAnalyses.createdAt))
      .limit(1);
    if (!row) throw new NotFoundException({ code: 'NO_ANALYSIS', message: 'This lead has not been analysed yet' });
    return row;
  }

  async usage(auth: AuthContext) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const agg = {
      calls: sql<number>`count(*) filter (where ${aiRuns.status} <> 'BLOCKED')`,
      inputTokens: sql<number>`coalesce(sum(${aiRuns.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiRuns.outputTokens}), 0)`,
      costUsd: sql<string>`coalesce(sum(${aiRuns.estimatedCostUsd}), 0)`,
      failed: sql<number>`count(*) filter (where ${aiRuns.status} = 'FAILED')`,
    };
    const shape = (r?: { calls: number; inputTokens: number; outputTokens: number; costUsd: string; failed: number }) => ({
      calls: Number(r?.calls ?? 0),
      inputTokens: Number(r?.inputTokens ?? 0),
      outputTokens: Number(r?.outputTokens ?? 0),
      costUsd: Number(Number(r?.costUsd ?? 0).toFixed(6)),
      failed: Number(r?.failed ?? 0),
    });
    const scope = (since: Date) => and(eq(aiRuns.organizationId, auth.organizationId), gte(aiRuns.createdAt, since));
    const [[today], [month], byPurpose, byModel, byUser] = await Promise.all([
      this.handle.db.select(agg).from(aiRuns).where(scope(dayStart)),
      this.handle.db.select(agg).from(aiRuns).where(scope(monthStart)),
      this.handle.db.select({ purpose: aiRuns.purpose, ...agg }).from(aiRuns).where(scope(monthStart)).groupBy(aiRuns.purpose),
      this.handle.db.select({ model: aiRuns.model, ...agg }).from(aiRuns).where(scope(monthStart)).groupBy(aiRuns.model),
      this.handle.db
        .select({ userId: aiRuns.userId, fullName: users.fullName, ...agg })
        .from(aiRuns)
        .leftJoin(users, eq(users.id, aiRuns.userId))
        .where(scope(monthStart))
        .groupBy(aiRuns.userId, users.fullName),
    ]);
    return {
      today: shape(today),
      month: shape(month),
      byPurpose: byPurpose.map((r) => ({ purpose: r.purpose, ...shape(r) })),
      byModel: byModel.map((r) => ({ model: r.model, ...shape(r) })),
      byUser: byUser.map((r) => ({ userId: r.userId, fullName: r.fullName, ...shape(r) })),
    };
  }

  async prompts(auth: AuthContext) {
    const versions = await this.handle.db
      .select({
        promptKey: aiPromptVersions.promptKey,
        version: aiPromptVersions.version,
        active: aiPromptVersions.active,
        modelProfile: aiPromptVersions.modelProfile,
        maxOutputTokens: aiPromptVersions.maxOutputTokens,
        systemPrompt: aiPromptVersions.systemPrompt,
        notes: aiPromptVersions.notes,
        createdAt: aiPromptVersions.createdAt,
      })
      .from(aiPromptVersions)
      .where(eq(aiPromptVersions.organizationId, auth.organizationId))
      .orderBy(asc(aiPromptVersions.version));
    return Object.values(BUILTIN_PROMPTS).map((p) => {
      const mine = versions.filter((v) => v.promptKey === p.key);
      return {
        key: p.key,
        description: p.description,
        activeVersion: mine.find((v) => v.active)?.version ?? 0,
        builtin: { version: 0, systemPrompt: p.systemPrompt, modelProfile: p.modelProfile, maxOutputTokens: p.maxOutputTokens },
        versions: mine.map(({ promptKey: _k, ...v }) => v),
      };
    });
  }

  private assertKnownPrompt(key: string) {
    if (!BUILTIN_PROMPTS[key]) throw new NotFoundException({ code: 'PROMPT_NOT_FOUND', message: 'Unknown prompt' });
  }

  async addPromptVersion(auth: AuthContext, key: string, input: PromptVersionInput) {
    this.assertKnownPrompt(key);
    return this.handle.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`prompt:${auth.organizationId}:${key}`}))`);
      const [{ top } = { top: null }] = await tx
        .select({ top: max(aiPromptVersions.version) })
        .from(aiPromptVersions)
        .where(and(eq(aiPromptVersions.organizationId, auth.organizationId), eq(aiPromptVersions.promptKey, key)));
      const [row] = await tx
        .insert(aiPromptVersions)
        .values({
          organizationId: auth.organizationId,
          promptKey: key,
          version: (top ?? 0) + 1,
          systemPrompt: input.systemPrompt,
          modelProfile: input.modelProfile,
          maxOutputTokens: input.maxOutputTokens,
          temperature: input.temperature === undefined ? null : String(input.temperature),
          notes: input.notes ?? null,
          createdByUserId: auth.userId,
        })
        .returning();
      return row;
    });
  }

  /** Version 0 reverts to the built-in prompt. */
  async activatePromptVersion(auth: AuthContext, key: string, version: number) {
    this.assertKnownPrompt(key);
    await this.handle.db.transaction(async (tx) => {
      const scope = and(eq(aiPromptVersions.organizationId, auth.organizationId), eq(aiPromptVersions.promptKey, key));
      if (version > 0) {
        const [exists] = await tx.select({ id: aiPromptVersions.id }).from(aiPromptVersions).where(and(scope, eq(aiPromptVersions.version, version)));
        if (!exists) throw new NotFoundException({ code: 'PROMPT_VERSION_NOT_FOUND', message: 'Prompt version not found' });
      }
      await tx.update(aiPromptVersions).set({ active: false }).where(scope);
      if (version > 0) await tx.update(aiPromptVersions).set({ active: true }).where(and(scope, eq(aiPromptVersions.version, version)));
    });
    return { key, activeVersion: version };
  }
}
