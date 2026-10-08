import { type Database, domainEvents, type EventCause } from '@leadora/database';
import { sql } from 'drizzle-orm';

type Tx = Pick<Database, 'insert' | 'execute'>;

export const EVENT_TYPES = ['lead.created', 'lead.stage_changed', 'lead.score_changed', 'message.received', 'followup.overdue'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Records a domain event in the caller's transaction (outbox). Events written while an automation step runs
 * pick up that run as their cause from a transaction-local setting, so callers never have to pass it along.
 */
export async function emitEvent(
  tx: Tx,
  e: { organizationId: string; type: EventType; leadId?: string | null; actorUserId?: string | null; payload?: Record<string, unknown> },
) {
  await tx.insert(domainEvents).values({
    organizationId: e.organizationId,
    type: e.type,
    leadId: e.leadId ?? null,
    actorUserId: e.actorUserId ?? null,
    payload: e.payload ?? {},
    cause: sql`nullif(current_setting('leadora.event_cause', true), '')::jsonb`,
  });
}

/** Marks every event emitted later in this transaction as caused by an automation run. */
export async function setEventCause(tx: Pick<Database, 'execute'>, cause: EventCause) {
  await tx.execute(sql`select set_config('leadora.event_cause', ${JSON.stringify(cause)}, true)`);
}
