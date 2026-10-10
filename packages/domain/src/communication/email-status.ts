import { activities, conversations, type Database, leads, messages, webhookEvents } from '@leadora/database';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { notify } from '../notifications';

/**
 * Spec §90: delivery tracking for email. Mail relays post one status per message to
 * /webhooks/email-status/:inboxId, signed like inbound email.
 */
export const emailStatusSchema = z.object({
  /** The Message-ID we sent with (stored as the message's external id). */
  messageId: z.string().trim().min(3).max(998),
  event: z.enum(['delivered', 'opened', 'bounced', 'complained']),
  reason: z.string().trim().max(500).optional(),
  at: z.string().max(40).optional(),
});
export type EmailStatus = z.infer<typeof emailStatusSchema>;

const STATUS = { delivered: 'DELIVERED', opened: 'READ', bounced: 'FAILED', complained: 'FAILED' } as const;
const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/** Applies one stored status event. Statuses only move forward; bounces and complaints always apply. */
export async function processEmailStatusEvent(db: Database, eventId: string) {
  return db.transaction(async (tx) => {
    const [event] = await tx.select().from(webhookEvents).where(eq(webhookEvents.id, eventId)).for('update');
    if (!event || event.status === 'PROCESSED') return { status: 'SKIPPED' as const };
    const done = (error?: string) =>
      tx
        .update(webhookEvents)
        .set({ status: error ? 'FAILED' : 'PROCESSED', error: error ?? null, processedAt: new Date() })
        .where(eq(webhookEvents.id, eventId));
    const parsed = emailStatusSchema.safeParse(event.payload);
    if (!parsed.success) {
      await done('Invalid payload');
      return { status: 'SKIPPED' as const };
    }
    const s = parsed.data;
    const [row] = await tx
      .select({ id: messages.id, status: messages.status, conversationId: messages.conversationId, leadId: conversations.leadId, ownerUserId: leads.ownerUserId, leadName: leads.fullName, email: leads.email })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .where(and(eq(messages.organizationId, event.organizationId), eq(messages.externalMessageId, s.messageId), eq(messages.direction, 'OUTBOUND')));
    if (!row) {
      // Not ours (or already deleted): nothing to do, and nothing to retry.
      await done('Unknown message');
      return { status: 'SKIPPED' as const };
    }

    const next = STATUS[s.event];
    const problem = s.event === 'bounced' || s.event === 'complained';
    if (problem || (RANK[next] ?? 0) > (RANK[row.status] ?? 0)) {
      await tx
        .update(messages)
        .set({ status: next, ...(problem ? { error: `${s.event === 'bounced' ? 'Bounced' : 'Marked as spam'}${s.reason ? `: ${s.reason}` : ''}`.slice(0, 500) } : {}) })
        .where(eq(messages.id, row.id));
    }
    if (problem) {
      // Flag the address so people (and automations, via metadata) stop mailing it blindly.
      await tx
        .update(leads)
        .set({ metadata: sql`coalesce(${leads.metadata}, '{}'::jsonb) || ${JSON.stringify({ emailStatus: s.event, emailStatusAt: new Date().toISOString() })}::jsonb` })
        .where(eq(leads.id, row.leadId));
      await tx.insert(activities).values({
        organizationId: event.organizationId,
        leadId: row.leadId,
        actorUserId: null,
        type: s.event === 'bounced' ? 'email.bounced' : 'email.complained',
        payload: { messageId: row.id, conversationId: row.conversationId, email: row.email, reason: s.reason ?? null },
      });
      if (row.ownerUserId) {
        await notify(tx, {
          organizationId: event.organizationId,
          userId: row.ownerUserId,
          type: 'message_received',
          title: s.event === 'bounced' ? `Email to ${row.leadName} bounced` : `${row.leadName} marked your email as spam`,
          body: s.reason ?? (s.event === 'bounced' ? 'Check the address or reach them another way.' : 'Avoid emailing this address again.'),
          link: `/leads/${row.leadId}`,
          data: { leadId: row.leadId, conversationId: row.conversationId },
        });
      }
    }
    await done();
    return { status: 'PROCESSED' as const, organizationId: event.organizationId, conversationId: row.conversationId };
  });
}
