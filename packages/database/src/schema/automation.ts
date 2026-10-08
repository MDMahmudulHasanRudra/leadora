import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { leads } from './leads';
import { organizations } from './organizations';
import { users } from './users';

const ms = { withTimezone: true, precision: 3 } as const;

/** Set on events caused by an automation run, so rules can't trigger each other forever. */
export interface EventCause {
  automationDepth: number;
  runId: string;
  ruleId: string;
}

/**
 * Transactional outbox: written in the same transaction as the change it describes, so an event exists
 * exactly when the change committed. The worker claims unprocessed rows with SKIP LOCKED.
 */
export const domainEvents = pgTable(
  'domain_events',
  {
    id: id(),
    seq: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: varchar({ length: 60 }).notNull(),
    leadId: uuid().references(() => leads.id, { onDelete: 'cascade' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    cause: jsonb().$type<EventCause>(),
    occurredAt: timestamp(ms).notNull().defaultNow(),
    processedAt: timestamp(ms),
  },
  (t) => [index('domain_events_pending_idx').on(t.seq).where(sql`processed_at is null`)],
);

export interface AutomationCondition {
  field: string;
  op: string;
  value?: unknown;
}

export interface AutomationAction {
  type: string;
  params: Record<string, unknown>;
}

export interface AutomationStep {
  index: number;
  type: string;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  output?: Record<string, unknown> | null;
  error?: string | null;
  at: string;
}

// Spec §40. `version` bumps on every edit; runs keep the snapshot they executed (spec §41).
export const automationRules = pgTable(
  'automation_rules',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    enabled: boolean().notNull().default(true),
    trigger: varchar({ length: 60 }).notNull(),
    triggerConfig: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    conditions: jsonb().$type<AutomationCondition[]>().notNull().default([]),
    actions: jsonb().$type<AutomationAction[]>().notNull(),
    priority: integer().notNull().default(100),
    // Execution policy: don't run again for the same lead within this many minutes (0 = no limit).
    cooldownMinutes: integer().notNull().default(0),
    version: integer().notNull().default(1),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp(ms).notNull().defaultNow(),
    updatedAt: timestamp(ms)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('automation_rules_org_trigger_idx').on(t.organizationId, t.trigger, t.enabled)],
);

export const automationRunStatus = pgEnum('automation_run_status', ['QUEUED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED']);

// Spec §41: one row per execution with trigger event, rule version, inputs, step outputs, status and timing.
export const automationRuns = pgTable(
  'automation_runs',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    ruleId: uuid()
      .notNull()
      .references(() => automationRules.id, { onDelete: 'cascade' }),
    ruleVersion: integer().notNull(),
    ruleSnapshot: jsonb().$type<{ name: string; trigger: string; conditions: AutomationCondition[]; actions: AutomationAction[] }>().notNull(),
    eventId: uuid().references(() => domainEvents.id, { onDelete: 'set null' }),
    trigger: varchar({ length: 60 }).notNull(),
    // Spec §41: duplicate dispatch of the same event can never create a second run.
    idempotencyKey: varchar({ length: 200 }).notNull(),
    leadId: uuid().references(() => leads.id, { onDelete: 'set null' }),
    depth: integer().notNull().default(0),
    input: jsonb().$type<Record<string, unknown>>().notNull(),
    steps: jsonb().$type<AutomationStep[]>().notNull().default([]),
    status: automationRunStatus().notNull().default('QUEUED'),
    error: text(),
    attempts: integer().notNull().default(0),
    startedAt: timestamp(ms),
    finishedAt: timestamp(ms),
    createdAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('automation_runs_idempotency_unique').on(t.organizationId, t.idempotencyKey),
    index('automation_runs_rule_idx').on(t.ruleId, t.createdAt.desc()),
    index('automation_runs_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('automation_runs_lead_rule_idx').on(t.leadId, t.ruleId, t.createdAt.desc()),
  ],
);

export type AutomationRule = typeof automationRules.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type DomainEvent = typeof domainEvents.$inferSelect;
