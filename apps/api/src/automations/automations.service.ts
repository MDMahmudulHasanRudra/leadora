import { Inject, Injectable, NotFoundException, UnprocessableEntityException, ConflictException } from '@nestjs/common';
import { automationRules, automationRuns, type DbHandle, inboxes, leads, users } from '@leadora/database';
import { ACTION_TYPES, automationRunJob, CONDITION_FIELDS, CONDITION_OPS, evaluateConditions, TRIGGERS } from '@leadora/domain';
import type { Queue } from 'bullmq';
import { and, asc, count, desc, eq, gte, inArray, max, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import type { RequestMeta } from '../common/request-meta';
import { AUTOMATIONS_QUEUE, DB } from '../infra/tokens';
import type { RuleInput } from './automations.schemas';

const ruleNotFound = () => new NotFoundException({ code: 'RULE_NOT_FOUND', message: 'Automation not found' });
const runNotFound = () => new NotFoundException({ code: 'RUN_NOT_FOUND', message: 'Run not found' });


@Injectable()
export class AutomationsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(AUTOMATIONS_QUEUE) private readonly queue: Queue,
    private readonly audit: AuditService,
  ) {}

  meta() {
    return {
      triggers: TRIGGERS,
      conditionFields: Object.entries(CONDITION_FIELDS).map(([key, f]) => ({ key, ...f })),
      operators: CONDITION_OPS,
      actions: ACTION_TYPES,
    };
  }

  /** Actions may only point at this organization's users and inboxes. */
  private async validateTargets(organizationId: string, input: RuleInput) {
    const userIds = new Set<string>();
    const inboxIds = new Set<string>();
    for (const a of input.actions) {
      if (a.type === 'assign_lead' && a.params.mode === 'user') {
        if (!a.params.userId) throw this.invalid('Choose who to assign to');
        userIds.add(a.params.userId);
      }
      if (a.type === 'create_followup' && a.params.assignTo === 'user') {
        if (!a.params.userId) throw this.invalid('Choose who gets the follow-up');
        userIds.add(a.params.userId);
      }
      if (a.type === 'send_notification' && a.params.to === 'user') {
        if (!a.params.userId) throw this.invalid('Choose who to notify');
        userIds.add(a.params.userId);
      }
      if (a.type === 'send_email') inboxIds.add(a.params.inboxId);
    }
    if (userIds.size) {
      const [{ n } = { n: 0 }] = await this.handle.db.select({ n: count() }).from(users).where(and(eq(users.organizationId, organizationId), inArray(users.id, [...userIds])));
      if (n !== userIds.size) throw this.invalid('One of the chosen users does not exist');
    }
    if (inboxIds.size) {
      const [{ n } = { n: 0 }] = await this.handle.db.select({ n: count() }).from(inboxes).where(and(eq(inboxes.organizationId, organizationId), inArray(inboxes.id, [...inboxIds])));
      if (n !== inboxIds.size) throw this.invalid('The chosen inbox does not exist');
    }
  }

  private invalid(message: string) {
    return new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message, details: [{ path: 'actions', message }] });
  }

  async list(auth: AuthContext) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const rules = await this.handle.db
      .select()
      .from(automationRules)
      .where(eq(automationRules.organizationId, auth.organizationId))
      .orderBy(asc(automationRules.priority), asc(automationRules.createdAt));
    const stats = rules.length
      ? await this.handle.db
          .select({
            ruleId: automationRuns.ruleId,
            runs: count(),
            failed: sql<number>`count(*) filter (where ${automationRuns.status} = 'FAILED')`,
            lastRunAt: max(automationRuns.createdAt),
          })
          .from(automationRuns)
          .where(and(eq(automationRuns.organizationId, auth.organizationId), gte(automationRuns.createdAt, since)))
          .groupBy(automationRuns.ruleId)
      : [];
    return {
      items: rules.map((r) => {
        const s = stats.find((x) => x.ruleId === r.id);
        return { ...r, stats: { runs7d: Number(s?.runs ?? 0), failed7d: Number(s?.failed ?? 0), lastRunAt: s?.lastRunAt ?? null } };
      }),
    };
  }

  async get(auth: AuthContext, id: string) {
    const [rule] = await this.handle.db.select().from(automationRules).where(and(eq(automationRules.id, id), eq(automationRules.organizationId, auth.organizationId)));
    if (!rule) throw ruleNotFound();
    return rule;
  }

  async create(auth: AuthContext, input: RuleInput, meta: RequestMeta) {
    await this.validateTargets(auth.organizationId, input);
    return this.handle.db.transaction(async (tx) => {
      const [rule] = await tx
        .insert(automationRules)
        .values({ ...input, description: input.description ?? null, organizationId: auth.organizationId, createdByUserId: auth.userId, updatedByUserId: auth.userId })
        .returning();
      await this.audit.record(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'automation.created', resourceType: 'automation_rule', resourceId: rule!.id, newValues: input, meta });
      return rule!;
    });
  }

  /** Every edit is a new version; runs keep the snapshot they executed. */
  async update(auth: AuthContext, id: string, input: RuleInput, meta: RequestMeta) {
    const current = await this.get(auth, id);
    await this.validateTargets(auth.organizationId, input);
    return this.handle.db.transaction(async (tx) => {
      const [rule] = await tx
        .update(automationRules)
        .set({ ...input, description: input.description ?? null, version: current.version + 1, updatedByUserId: auth.userId })
        .where(eq(automationRules.id, id))
        .returning();
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'automation.updated',
        resourceType: 'automation_rule',
        resourceId: id,
        oldValues: { version: current.version, trigger: current.trigger, conditions: current.conditions, actions: current.actions, enabled: current.enabled },
        newValues: { version: rule!.version, ...input },
        meta,
      });
      return rule!;
    });
  }

  async setEnabled(auth: AuthContext, id: string, enabled: boolean, meta: RequestMeta) {
    const current = await this.get(auth, id);
    return this.handle.db.transaction(async (tx) => {
      const [rule] = await tx.update(automationRules).set({ enabled, updatedByUserId: auth.userId }).where(eq(automationRules.id, id)).returning();
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: enabled ? 'automation.enabled' : 'automation.disabled',
        resourceType: 'automation_rule',
        resourceId: id,
        oldValues: { enabled: current.enabled },
        newValues: { enabled },
        meta,
      });
      return rule!;
    });
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta) {
    const current = await this.get(auth, id);
    await this.handle.db.transaction(async (tx) => {
      await tx.delete(automationRules).where(eq(automationRules.id, id));
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'automation.deleted',
        resourceType: 'automation_rule',
        resourceId: id,
        oldValues: { name: current.name, trigger: current.trigger, version: current.version },
        meta,
      });
    });
  }

  /** Dry run: would this rule's conditions match this lead right now? Nothing is executed. */
  async test(auth: AuthContext, id: string, leadId: string) {
    const rule = await this.get(auth, id);
    const [lead] = await this.handle.db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), eq(leads.organizationId, auth.organizationId)));
    if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead not found' });
    const facts = await this.facts(auth.organizationId, leadId);
    const results = rule.conditions.map((c) => ({ ...c, actual: facts[c.field as keyof typeof facts] ?? null, passed: evaluateConditions([c], facts) }));
    return { matches: results.every((r) => r.passed), conditions: results };
  }

  private async facts(organizationId: string, leadId: string) {
    const { rows } = await this.handle.db.execute<{ temperature: string | null; score: number | null; priority: string; stage: string; outcome: string; source: string; owner: string | null; country: string | null; budget: string | null; tags: string[] }>(sql`
      select l.temperature, l.score, l.priority, s.key as stage, s.outcome, src.type as source, l.owner_user_id as owner, l.country, l.budget,
        coalesce((select array_agg(t.name::text) from lead_tag_links tl join lead_tags t on t.id = tl.tag_id where tl.lead_id = l.id), '{}') as tags
      from leads l join pipeline_stages s on s.id = l.stage_id join lead_sources src on src.id = l.source_id
      where l.id = ${leadId} and l.organization_id = ${organizationId}`);
    const r = rows[0]!;
    return {
      'lead.temperature': r.temperature,
      'lead.score': r.score,
      'lead.priority': r.priority,
      'lead.stage': r.stage,
      'lead.stageOutcome': r.outcome,
      'lead.source': r.source,
      'lead.owner': r.owner,
      'lead.tags': r.tags,
      'lead.country': r.country,
      'lead.budget': r.budget === null ? null : Number(r.budget),
    };
  }

  async runs(auth: AuthContext, q: { ruleId?: string; status?: string; limit: number }) {
    const items = await this.handle.db
      .select({
        id: automationRuns.id,
        ruleId: automationRuns.ruleId,
        ruleVersion: automationRuns.ruleVersion,
        ruleName: sql<string>`${automationRuns.ruleSnapshot}->>'name'`,
        trigger: automationRuns.trigger,
        leadId: automationRuns.leadId,
        leadName: leads.fullName,
        status: automationRuns.status,
        steps: automationRuns.steps,
        stepCount: sql<number>`jsonb_array_length(${automationRuns.ruleSnapshot}->'actions')`,
        error: automationRuns.error,
        attempts: automationRuns.attempts,
        depth: automationRuns.depth,
        createdAt: automationRuns.createdAt,
        finishedAt: automationRuns.finishedAt,
      })
      .from(automationRuns)
      .leftJoin(leads, eq(leads.id, automationRuns.leadId))
      .where(
        and(
          eq(automationRuns.organizationId, auth.organizationId),
          q.ruleId ? eq(automationRuns.ruleId, q.ruleId) : undefined,
          q.status ? eq(automationRuns.status, q.status as 'FAILED') : undefined,
        ),
      )
      .orderBy(desc(automationRuns.createdAt))
      .limit(q.limit);
    return { items };
  }

  async run(auth: AuthContext, id: string) {
    const [run] = await this.handle.db.select().from(automationRuns).where(and(eq(automationRuns.id, id), eq(automationRuns.organizationId, auth.organizationId)));
    if (!run) throw runNotFound();
    return run;
  }

  /** Re-queues a failed run. The failed step is dropped so it runs again; finished steps are kept and skipped. */
  async retry(auth: AuthContext, id: string, meta: RequestMeta) {
    const run = await this.run(auth, id);
    if (run.status !== 'FAILED') throw new ConflictException({ code: 'RUN_NOT_FAILED', message: 'Only failed runs can be retried' });
    await this.handle.db.transaction(async (tx) => {
      await tx
        .update(automationRuns)
        .set({
          status: 'QUEUED',
          error: null,
          finishedAt: null,
          steps: sql`case when ${automationRuns.steps}->-1->>'status' = 'FAILED' then ${automationRuns.steps} - -1 else ${automationRuns.steps} end`,
        })
        .where(eq(automationRuns.id, id));
      await this.audit.record(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'automation.run_retried', resourceType: 'automation_run', resourceId: id, meta });
    });
    const job = automationRunJob(id);
    await this.queue.add(job.name, job.data, job.opts);
    return this.run(auth, id);
  }
}
