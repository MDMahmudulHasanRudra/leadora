import { type Database, followups, leads, notifications, type Transaction } from '@leadora/database';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

export type NotificationType =
  | 'lead_assigned'
  | 'followup_due'
  | 'message_received'
  | 'mention'
  | 'ai_action_required'
  | 'import_completed'
  | 'automation_failed';

export interface NewNotification {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  data?: Record<string, unknown>;
}

export async function notify(db: Database | Transaction, n: NewNotification): Promise<string> {
  const [row] = await db
    .insert(notifications)
    .values({ ...n, body: n.body ?? null, link: n.link ?? null, data: n.data ?? null })
    .returning({ id: notifications.id });
  return row!.id;
}

/** Notifies the new owner unless they assigned the lead to themselves. */
export async function notifyLeadAssigned(
  db: Database | Transaction,
  args: { organizationId: string; leadId: string; leadName: string; toUserId: string | null; actorUserId: string | null; rule?: string },
) {
  if (!args.toUserId || args.toUserId === args.actorUserId) return null;
  return notify(db, {
    organizationId: args.organizationId,
    userId: args.toUserId,
    type: 'lead_assigned',
    title: `New lead assigned to you: ${args.leadName}`,
    body: args.rule ? `Assigned by rule "${args.rule}"` : null,
    link: `/leads/${args.leadId}`,
    data: { leadId: args.leadId },
  });
}

const REMINDER_WINDOW_MS = 15 * 60_000;

/**
 * Sends one reminder per pending follow-up due within the next 15 minutes (or already overdue and never
 * reminded). Marks each as reminded in the same transaction, so concurrent schedulers can't double-send.
 */
export async function sendFollowupReminders(db: Database, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({
        id: followups.id,
        organizationId: followups.organizationId,
        userId: followups.assignedUserId,
        type: followups.type,
        scheduledAt: followups.scheduledAt,
        leadId: leads.id,
        leadName: leads.fullName,
      })
      .from(followups)
      .innerJoin(leads, eq(leads.id, followups.leadId))
      .where(
        and(
          eq(followups.status, 'PENDING'),
          isNull(followups.remindedAt),
          lte(followups.scheduledAt, new Date(now.getTime() + REMINDER_WINDOW_MS)),
          gte(followups.scheduledAt, new Date(now.getTime() - 24 * 3600_000)),
        ),
      )
      .for('update', { of: followups, skipLocked: true })
      .limit(500);

    for (const f of due) {
      await tx.update(followups).set({ remindedAt: now }).where(eq(followups.id, f.id));
      if (!f.userId) continue;
      await notify(tx, {
        organizationId: f.organizationId,
        userId: f.userId,
        type: 'followup_due',
        title: `${f.type.charAt(0)}${f.type.slice(1).toLowerCase()} with ${f.leadName} is due`,
        link: `/leads/${f.leadId}`,
        data: { followupId: f.id, leadId: f.leadId, scheduledAt: f.scheduledAt.toISOString() },
      });
    }
    return due.length;
  });
}
