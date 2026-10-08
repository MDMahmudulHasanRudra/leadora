import { type Database, followups, leads, scoringSettings } from '@leadora/database';
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { emitEvent } from '../automation/events';
import { combineScore, computeRuleScore, type LeadFacts, resolveScoringConfig, type ScoringConfig, temperatureFor } from './rules';

type Db = Pick<Database, 'select' | 'selectDistinct' | 'update' | 'insert' | 'execute'>;

const BATCH = 500;

export async function loadScoringConfig(db: Db, organizationId: string): Promise<ScoringConfig> {
  const [row] = await db.select().from(scoringSettings).where(eq(scoringSettings.organizationId, organizationId));
  if (!row) return resolveScoringConfig();
  return resolveScoringConfig({
    rules: row.rules,
    ruleWeight: row.ruleWeight ?? undefined,
    aiWeight: row.aiWeight ?? undefined,
    hotThreshold: row.hotThreshold ?? undefined,
    warmThreshold: row.warmThreshold ?? undefined,
  });
}

async function scoreBatch(db: Db, organizationId: string, config: ScoringConfig, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .select({
      id: leads.id,
      email: leads.email,
      phone: leads.phone,
      budget: leads.budget,
      notes: leads.notes,
      aiScore: leads.aiScore,
      score: leads.score,
      ruleScore: leads.ruleScore,
      temperature: leads.temperature,
    })
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), inArray(leads.id, ids)));

  // The latest 50 customer-visible messages per conversation are plenty for every rule.
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const { rows: msgs } = await db.execute<{ lead_id: string; direction: 'INBOUND' | 'OUTBOUND'; created_at: Date | string; text: string }>(sql`
    select c.lead_id, m.direction, m.created_at, m.text
    from conversations c
    cross join lateral (
      select direction, created_at, left(content, 2000) as text
      from messages
      where conversation_id = c.id and direction <> 'INTERNAL' and status <> 'FAILED'
      order by seq desc
      limit 50
    ) m
    where c.organization_id = ${organizationId} and c.lead_id in (${idList})`);
  const done = await db
    .select({ leadId: followups.leadId, completedAt: followups.completedAt })
    .from(followups)
    .where(and(eq(followups.organizationId, organizationId), inArray(followups.leadId, ids), eq(followups.status, 'COMPLETED'), isNotNull(followups.completedAt)));

  let changed = 0;
  for (const lead of rows) {
    const facts: LeadFacts = {
      email: lead.email,
      phone: lead.phone,
      budget: lead.budget === null ? null : Number(lead.budget),
      notes: lead.notes,
      messages: msgs.filter((m) => m.lead_id === lead.id).map((m) => ({ direction: m.direction, at: new Date(m.created_at), text: m.text })),
      completedFollowupsAt: done.filter((f) => f.leadId === lead.id).map((f) => f.completedAt!),
    };
    const rule = computeRuleScore(facts, config);
    const score = combineScore(rule.score, lead.aiScore, config);
    const temperature = temperatureFor(score, config);
    if (score === lead.score && temperature === lead.temperature && rule.score === lead.ruleScore) continue;
    await db
      .update(leads)
      .set({
        score,
        temperature,
        ruleScore: rule.score,
        scoreBreakdown: { rules: rule.matched, ruleScore: rule.score, aiScore: lead.aiScore, ruleWeight: config.ruleWeight, aiWeight: config.aiWeight },
        scoredAt: new Date(),
      })
      .where(eq(leads.id, lead.id));
    // A brand-new lead getting its first score is lead.created, not a change.
    if (lead.score !== null && lead.score !== score) {
      await emitEvent(db, {
        organizationId,
        type: 'lead.score_changed',
        leadId: lead.id,
        payload: { from: lead.score, to: score, temperatureFrom: lead.temperature, temperatureTo: temperature },
      });
    }
    changed++;
  }
  return changed;
}

/**
 * Recomputes score and temperature from current facts. Cheap and idempotent, so callers run it after any
 * change that can move a score (create, edit, message, follow-up, AI analysis). Returns rows changed.
 */
export async function rescoreLeads(db: Db, organizationId: string, leadIds: string[]): Promise<number> {
  const config = await loadScoringConfig(db, organizationId);
  let changed = 0;
  for (let i = 0; i < leadIds.length; i += BATCH) changed += await scoreBatch(db, organizationId, config, leadIds.slice(i, i + BATCH));
  return changed;
}

/** Whole-organization rescore after a settings change; walks leads by id so memory stays flat. */
export async function rescoreOrganization(db: Db, organizationId: string): Promise<number> {
  const config = await loadScoringConfig(db, organizationId);
  let changed = 0;
  let after: string | null = null;
  for (;;) {
    const page: { id: string }[] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), after ? gt(leads.id, after) : undefined))
      .orderBy(asc(leads.id))
      .limit(BATCH);
    if (page.length === 0) return changed;
    changed += await scoreBatch(db, organizationId, config, page.map((p) => p.id));
    after = page[page.length - 1]!.id;
  }
}

/** Organizations with leads never scored (created before scoring existed, or a rescore that failed). */
export async function organizationsNeedingRescore(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ organizationId: leads.organizationId }).from(leads).where(isNull(leads.scoredAt));
  return rows.map((r) => r.organizationId);
}