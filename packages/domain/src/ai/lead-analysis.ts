import {
  activities,
  aiAnalyses,
  conversations,
  type Database,
  leadSources,
  leadTagLinks,
  leadTags,
  leads,
  messages,
  pipelineStages,
} from '@leadora/database';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { readCustomFields } from '../custom-fields/values';
import { DomainError } from '../errors';
import { rescoreLeads } from '../scoring/rescore';
import { type AiContext, type AiDeps, runStructured } from './gateway';
import { dataBlock } from './prompts';

export const LEAD_ACTIONS = ['CALL_NOW', 'SEND_PRICING', 'OFFER_DEMO', 'FOLLOW_UP_LATER', 'NURTURE', 'ESCALATE_TO_MANAGER', 'DISQUALIFY'] as const;

/** Spec §30/§31: every machine-consumed AI result has a schema. Strict objects → strict JSON schema. */
export const leadAnalysisSchema = z.strictObject({
  summary: z.string().max(600),
  intent: z.enum(['PURCHASE', 'INQUIRY', 'SUPPORT', 'COMPLAINT', 'PARTNERSHIP', 'SPAM', 'UNKNOWN']),
  buyingSignal: z.enum(['NONE', 'WEAK', 'MODERATE', 'STRONG']),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  score: z.number().int().min(0).max(100),
  objections: z.array(z.string().max(120)).max(10),
  productInterest: z.array(z.string().max(120)).max(10),
  recommendedAction: z.enum(LEAD_ACTIONS),
  rationale: z.string().max(400),
  // A concrete follow-up the salesperson can schedule with one click (spec §108 "next action").
  nextAction: z.strictObject({
    type: z.enum(['CALL', 'EMAIL', 'MESSAGE', 'MEETING', 'NONE']),
    inHours: z.number().int().min(0).max(720),
    note: z.string().max(300),
  }),
});
export type LeadAnalysis = z.infer<typeof leadAnalysisSchema>;

/** Builds the analysis input from CRM data, every untrusted part wrapped as data (spec §56). */
async function leadAnalysisInput(db: Database, organizationId: string, leadId: string) {
  const [lead] = await db
    .select({ lead: leads, stage: pipelineStages.name, source: leadSources.name })
    .from(leads)
    .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .innerJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));
  if (!lead) throw new DomainError('not_found', 'LEAD_NOT_FOUND', 'Lead not found');
  const l = lead.lead;
  const [tags, custom, recent, convs] = await Promise.all([
    db
      .select({ name: leadTags.name })
      .from(leadTagLinks)
      .innerJoin(leadTags, eq(leadTags.id, leadTagLinks.tagId))
      .where(eq(leadTagLinks.leadId, leadId))
      .orderBy(asc(leadTags.name)),
    readCustomFields(db, organizationId, 'lead', [leadId]),
    db
      .select({ type: activities.type, payload: activities.payload, createdAt: activities.createdAt })
      .from(activities)
      .where(and(eq(activities.organizationId, organizationId), eq(activities.leadId, leadId)))
      .orderBy(desc(activities.seq))
      .limit(20),
    db.select({ id: conversations.id }).from(conversations).where(eq(conversations.leadId, leadId)),
  ]);
  const msgs = convs.length
    ? await db
        .select({ direction: messages.direction, content: messages.content, createdAt: messages.createdAt })
        .from(messages)
        .where(and(inArray(messages.conversationId, convs.map((c) => c.id)), ne(messages.direction, 'INTERNAL')))
        .orderBy(desc(messages.seq))
        .limit(10)
    : [];

  const profile = {
    name: l.fullName,
    company: l.companyName,
    jobTitle: l.jobTitle,
    location: l.location,
    industry: l.industry,
    budget: l.budget === null ? null : Number(l.budget),
    currency: l.currency,
    priority: l.priority,
    stage: lead.stage,
    source: lead.source,
    tags: tags.map((t) => t.name),
    customFields: custom.get(leadId) ?? {},
    notes: l.notes,
    createdAt: l.createdAt,
    lastContactedAt: l.lastContactedAt,
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
    lead: l,
    input: [
      `Today is ${new Date().toISOString().slice(0, 10)}. Analyse this lead.`,
      dataBlock('lead', JSON.stringify(profile, null, 2)),
      dataBlock('timeline', timeline || '(no activity yet)'),
      dataBlock('messages', thread || '(no messages yet)'),
    ].join('\n\n'),
  };
}

/**
 * Runs and stores a lead analysis. The AI score feeds the hybrid score (spec §14) — it never is the score.
 * Used by the API (on request) and by automations (ctx.userId = null → "System" in the timeline).
 */
export async function analyzeLeadWithAi(db: Database, deps: AiDeps, ctx: AiContext, leadId: string): Promise<LeadAnalysis> {
  const { lead, input } = await leadAnalysisInput(db, ctx.organizationId, leadId);
  if (lead.archivedAt) throw new DomainError('conflict', 'LEAD_ARCHIVED', 'Restore this lead first');
  const { data, runId } = await runStructured(db, deps, ctx, {
    purpose: 'lead_analysis',
    promptKey: 'lead_analysis',
    schema: leadAnalysisSchema,
    input,
    entity: { type: 'lead', id: leadId },
  });
  await db.transaction(async (tx) => {
    await tx.insert(aiAnalyses).values({ organizationId: ctx.organizationId, entityType: 'lead', entityId: leadId, purpose: 'lead_analysis', runId, result: data });
    await tx.update(leads).set({ aiScore: data.score }).where(eq(leads.id, leadId));
    await rescoreLeads(tx, ctx.organizationId, [leadId]);
    const [after] = await tx.select({ score: leads.score, temperature: leads.temperature }).from(leads).where(eq(leads.id, leadId));
    await tx.insert(activities).values({
      organizationId: ctx.organizationId,
      leadId,
      actorUserId: ctx.userId,
      type: 'ai.analysis_completed',
      payload: {
        score: data.score,
        leadScore: after!.score,
        previousScore: lead.score,
        temperature: after!.temperature,
        intent: data.intent,
        recommendedAction: data.recommendedAction,
      },
    });
  });
  return data;
}
