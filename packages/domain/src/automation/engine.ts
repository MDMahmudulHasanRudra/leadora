import {
  type AutomationStep,
  automationRules,
  automationRuns,
  type Database,
  type DomainEvent,
  domainEvents,
  followups,
  leadSources,
  leadTagLinks,
  leadTags,
  leads,
  pipelineStages,
  type Transaction,
} from '@leadora/database';
import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { DomainError } from '../errors';
import { type ActionInput, actionSchema, applyAction, type AutomationDeps, prepareAction } from './actions';
import { evaluateConditions, type Facts } from './conditions';
import { EVENT_TYPES, emitEvent, setEventCause } from './events';

export const TRIGGERS = [...EVENT_TYPES, 'lead.inactive'] as const;
export type Trigger = (typeof TRIGGERS)[number];
/** Events caused by automations this many levels deep no longer trigger rules (loop guard). */
export const MAX_AUTOMATION_DEPTH = 3;

type Db = Database | Transaction;

async function leadSnapshot(db: Db, organizationId: string, leadId: string) {
  const [row] = await db
    .select({
      id: leads.id,
      fullName: leads.fullName,
      temperature: leads.temperature,
      score: leads.score,
      priority: leads.priority,
      stage: pipelineStages.key,
      stageOutcome: pipelineStages.outcome,
      source: leadSources.type,
      owner: leads.ownerUserId,
      country: leads.country,
      budget: leads.budget,
      archivedAt: leads.archivedAt,
    })
    .from(leads)
    .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .innerJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));
  if (!row || row.archivedAt) return null;
  const tags = await db.select({ name: leadTags.name }).from(leadTagLinks).innerJoin(leadTags, eq(leadTags.id, leadTagLinks.tagId)).where(eq(leadTagLinks.leadId, leadId));
  const facts: Facts = {
    'lead.temperature': row.temperature,
    'lead.score': row.score,
    'lead.priority': row.priority,
    'lead.stage': row.stage,
    'lead.stageOutcome': row.stageOutcome,
    'lead.source': row.source,
    'lead.owner': row.owner,
    'lead.tags': tags.map((t) => t.name),
    'lead.country': row.country,
    'lead.budget': row.budget === null ? null : Number(row.budget),
  };
  return { lead: { id: row.id, fullName: row.fullName }, facts };
}

function eventFacts(e: Pick<DomainEvent, 'type' | 'payload'>): Facts {
  const p = e.payload;
  return {
    'event.from': p.from ?? null,
    'event.to': p.to ?? null,
    'event.temperatureTo': p.temperatureTo ?? null,
    'message.text': e.type === 'message.received' ? (p.text ?? '') : null,
    'message.channel': p.channel ?? null,
  };
}

async function onCooldown(tx: Transaction, ruleId: string, leadId: string, minutes: number) {
  if (minutes <= 0) return false;
  const [recent] = await tx
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(and(eq(automationRuns.ruleId, ruleId), eq(automationRuns.leadId, leadId), gte(automationRuns.createdAt, new Date(Date.now() - minutes * 60_000))))
    .limit(1);
  return !!recent;
}

type RuleRow = typeof automationRules.$inferSelect;

async function createRun(
  tx: Transaction,
  rule: RuleRow,
  v: { idempotencyKey: string; leadId: string; eventId: string | null; depth: number; input: Record<string, unknown> },
): Promise<string | null> {
  const [run] = await tx
    .insert(automationRuns)
    .values({
      organizationId: rule.organizationId,
      ruleId: rule.id,
      ruleVersion: rule.version,
      ruleSnapshot: { name: rule.name, trigger: rule.trigger, conditions: rule.conditions, actions: rule.actions },
      eventId: v.eventId,
      trigger: rule.trigger,
      idempotencyKey: v.idempotencyKey,
      leadId: v.leadId,
      depth: v.depth,
      input: v.input,
    })
    // Spec §41: a re-dispatched event or a repeated sweep can never create a second run.
    .onConflictDoNothing()
    .returning({ id: automationRuns.id });
  return run?.id ?? null;
}

/**
 * Claims a batch of outbox events (SKIP LOCKED, so parallel workers never share one), matches enabled rules,
 * evaluates conditions and creates runs. Runs are enqueued only after the claim commits.
 */
export async function dispatchEvents(db: Database, opts: { enqueueRun: (runId: string) => Promise<void>; batch?: number; rulesEnabled?: boolean }) {
  const runIds: string[] = [];
  const count = await db.transaction(async (tx) => {
    const events = await tx
      .select()
      .from(domainEvents)
      .where(isNull(domainEvents.processedAt))
      .orderBy(asc(domainEvents.seq))
      .limit(opts.batch ?? 100)
      .for('update', { skipLocked: true });
    for (const e of events) {
      const depth = e.cause?.automationDepth ?? 0;
      // With automations switched off the outbox is still drained, so it never grows without bound.
      if (opts.rulesEnabled !== false && depth < MAX_AUTOMATION_DEPTH && e.leadId) {
        const rules = await tx
          .select()
          .from(automationRules)
          .where(and(eq(automationRules.organizationId, e.organizationId), eq(automationRules.trigger, e.type), eq(automationRules.enabled, true)))
          .orderBy(asc(automationRules.priority), asc(automationRules.createdAt));
        const snapshot = rules.length ? await leadSnapshot(tx, e.organizationId, e.leadId) : null;
        for (const rule of snapshot ? rules : []) {
          // A rule never reacts to an event its own run caused.
          if (e.cause?.ruleId === rule.id) continue;
          const facts = { ...snapshot!.facts, ...eventFacts(e) };
          if (!evaluateConditions(rule.conditions, facts)) continue;
          if (await onCooldown(tx, rule.id, e.leadId, rule.cooldownMinutes)) continue;
          const id = await createRun(tx, rule, {
            idempotencyKey: `${rule.id}:${e.id}`,
            leadId: e.leadId,
            eventId: e.id,
            depth,
            input: { event: { id: e.id, type: e.type, payload: e.payload, occurredAt: e.occurredAt }, facts },
          });
          if (id) runIds.push(id);
        }
      }
      await tx.update(domainEvents).set({ processedAt: new Date() }).where(eq(domainEvents.id, e.id));
    }
    return events.length;
  });
  for (const id of runIds) await opts.enqueueRun(id);
  return { events: count, runs: runIds };
}

/** Spec §40 `followup.overdue`: one event per follow-up, the first time it is found overdue. */
export async function emitOverdueFollowupEvents(db: Database, now = new Date()) {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: followups.id, organizationId: followups.organizationId, leadId: followups.leadId, type: followups.type, scheduledAt: followups.scheduledAt, assignedUserId: followups.assignedUserId })
      .from(followups)
      .where(and(eq(followups.status, 'PENDING'), lt(followups.scheduledAt, now), isNull(followups.overdueEventAt)))
      .limit(200)
      .for('update', { skipLocked: true });
    for (const f of due) {
      await emitEvent(tx, {
        organizationId: f.organizationId,
        type: 'followup.overdue',
        leadId: f.leadId,
        payload: { followupId: f.id, type: f.type, scheduledAt: f.scheduledAt.toISOString(), assignedUserId: f.assignedUserId },
      });
      await tx.update(followups).set({ overdueEventAt: now }).where(eq(followups.id, f.id));
    }
    return due.length;
  });
}

/**
 * Spec §40 `lead.inactive`: open leads with no contact for `triggerConfig.days`. The idempotency key includes the
 * last-activity time, so a rule fires once per quiet period and again only after the lead is touched and goes quiet.
 */
export async function dispatchInactiveLeads(db: Database, opts: { enqueueRun: (runId: string) => Promise<void>; now?: Date }) {
  const now = opts.now ?? new Date();
  const rules = await db.select().from(automationRules).where(and(eq(automationRules.trigger, 'lead.inactive'), eq(automationRules.enabled, true)));
  const runIds: string[] = [];
  for (const rule of rules) {
    const days = Math.max(1, Number(rule.triggerConfig.days ?? 7));
    const lastTouch = sql<Date>`coalesce(${leads.lastContactedAt}, ${leads.createdAt})`;
    const quiet = await db
      .select({ id: leads.id, lastTouch })
      .from(leads)
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .where(
        and(
          eq(leads.organizationId, rule.organizationId),
          isNull(leads.archivedAt),
          eq(pipelineStages.outcome, 'OPEN'),
          lt(lastTouch, new Date(now.getTime() - days * 86_400_000)),
        ),
      )
      .limit(200);
    for (const l of quiet) {
      const snapshot = await leadSnapshot(db, rule.organizationId, l.id);
      if (!snapshot || !evaluateConditions(rule.conditions, snapshot.facts)) continue;
      const id = await db.transaction(async (tx) => {
        if (await onCooldown(tx, rule.id, l.id, rule.cooldownMinutes)) return null;
        return createRun(tx, rule, {
          idempotencyKey: `${rule.id}:${l.id}:${new Date(l.lastTouch).toISOString()}`,
          leadId: l.id,
          eventId: null,
          depth: 0,
          input: { event: { type: 'lead.inactive', days, lastActivityAt: l.lastTouch }, facts: snapshot.facts },
        });
      });
      if (id) runIds.push(id);
    }
  }
  for (const id of runIds) await opts.enqueueRun(id);
  return runIds;
}

/** One job per run; the job id dedupes enqueues from the dispatcher, the stale sweep and manual retries. */
export const automationRunJob = (runId: string) => ({
  name: 'automation.run',
  data: { runId },
  opts: { jobId: `run-${runId}`, attempts: 3, backoff: { type: 'custom' as const }, removeOnComplete: true, removeOnFail: 500 },
});

/** Outbox retention: processed events are only needed for a while (run logs keep their own copy). */
export async function purgeProcessedEvents(db: Database, olderThanDays = 30) {
  const res = await db.delete(domainEvents).where(lt(domainEvents.processedAt, new Date(Date.now() - olderThanDays * 86_400_000)));
  return res.rowCount ?? 0;
}

/** Runs whose enqueue was lost (e.g. a crash right after dispatch commits) are picked up again. */
export async function staleQueuedRuns(db: Database, olderThanMs = 60_000) {
  const rows = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(and(eq(automationRuns.status, 'QUEUED'), lt(automationRuns.createdAt, new Date(Date.now() - olderThanMs))))
    .limit(200);
  return rows.map((r) => r.id);
}

const transient = (err: unknown) => !(err instanceof DomainError) || err.kind === 'upstream';

/**
 * Executes a run's actions in order. Each step commits together with its effect, so a retry resumes at the
 * first unfinished step and never repeats a finished one (spec §41 idempotency). Transient failures rethrow
 * for the queue to retry; anything else, or the last attempt, fails the run with the error on the step.
 */
export async function executeRun(db: Database, deps: AutomationDeps, runId: string, opts: { finalAttempt: boolean }) {
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, runId));
  if (!run || run.status === 'SUCCEEDED' || run.status === 'FAILED') return { status: 'SKIPPED' as const };
  await db
    .update(automationRuns)
    .set({ status: 'RUNNING', attempts: sql`${automationRuns.attempts} + 1`, startedAt: run.startedAt ?? new Date(), error: null })
    .where(eq(automationRuns.id, runId));
  const ctx = { organizationId: run.organizationId, leadId: run.leadId ?? '' };
  const actions = run.ruleSnapshot.actions;

  const recordStep = (tx: Transaction, step: AutomationStep) =>
    tx
      .update(automationRuns)
      .set({ steps: sql`${automationRuns.steps} || ${JSON.stringify([step])}::jsonb` })
      .where(eq(automationRuns.id, runId));
  const fail = async (index: number, type: string, message: string) => {
    await db.transaction(async (tx) => {
      await recordStep(tx, { index, type, status: 'FAILED', error: message, at: new Date().toISOString() });
      await tx.update(automationRuns).set({ status: 'FAILED', error: message, finishedAt: new Date() }).where(eq(automationRuns.id, runId));
    });
    return { status: 'FAILED' as const, error: message };
  };

  for (let i = run.steps.length; i < actions.length; i++) {
    const parsed = actionSchema.safeParse(actions[i]);
    if (!parsed.success) return fail(i, String(actions[i]?.type ?? 'unknown'), 'This action is not valid any more');
    const action: ActionInput = parsed.data;
    try {
      if (!run.leadId) throw new DomainError('invalid', 'LEAD_GONE', 'The lead no longer exists');
      const prepared = await prepareAction(db, deps, ctx, action);
      await db.transaction(async (tx) => {
        const [current] = await tx.select({ steps: automationRuns.steps }).from(automationRuns).where(eq(automationRuns.id, runId)).for('update');
        // Another attempt already finished this step.
        if (current!.steps.length > i) return;
        await setEventCause(tx, { automationDepth: run.depth + 1, runId, ruleId: run.ruleId });
        const result = await applyAction(tx, deps, ctx, action, prepared);
        await recordStep(tx, {
          index: i,
          type: action.type,
          status: 'skipped' in result ? 'SKIPPED' : 'SUCCEEDED',
          output: 'output' in result ? result.output : null,
          error: 'skipped' in result ? result.skipped : null,
          at: new Date().toISOString(),
        });
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      if (transient(err) && !opts.finalAttempt) {
        await db.update(automationRuns).set({ status: 'RETRYING', error: message }).where(eq(automationRuns.id, runId));
        throw err;
      }
      return fail(i, action.type, message);
    }
  }
  await db.update(automationRuns).set({ status: 'SUCCEEDED', finishedAt: new Date(), error: null }).where(eq(automationRuns.id, runId));
  return { status: 'SUCCEEDED' as const };
}
