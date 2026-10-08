import { conversations, type Database, inboxes, messages, webhookEvents } from '@leadora/database';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { findOrCreateContactLead, recordInboundMessage } from './receive';

/** Generic inbound email webhook payload (what a mail relay posts to /webhooks/inbound/:inboxId). */
export const inboundEmailSchema = z.object({
  messageId: z.string().trim().min(3).max(998),
  from: z.object({ email: z.string().trim().pipe(z.email()), name: z.string().trim().max(200).optional() }),
  to: z.string().max(998).optional(),
  subject: z.string().max(998).optional(),
  text: z.string().max(200_000),
  inReplyTo: z.string().max(998).optional(),
  references: z.array(z.string().max(998)).max(100).optional(),
  date: z.string().optional(),
});
export type InboundEmail = z.infer<typeof inboundEmailSchema>;

export interface InboundResult {
  status: 'PROCESSED' | 'SKIPPED';
  organizationId?: string;
  conversationId?: string;
  leadId?: string;
  notifyUserId?: string | null;
}

/**
 * Turns a persisted inbound webhook event into a lead (if new), a conversation (threaded by
 * In-Reply-To/References, else the lead's latest open one in the inbox) and an INBOUND message.
 * Idempotent: processed events and already-stored message ids are skipped.
 */
export async function processInboundEvent(db: Database, eventId: string): Promise<InboundResult> {
  return db.transaction(async (tx) => {
    const [event] = await tx.select().from(webhookEvents).where(eq(webhookEvents.id, eventId)).for('update');
    if (!event || event.status === 'PROCESSED' || !event.inboxId) return { status: 'SKIPPED' };
    const [inbox] = await tx.select().from(inboxes).where(eq(inboxes.id, event.inboxId));
    const parsed = inboundEmailSchema.safeParse(event.payload);
    if (!inbox || !parsed.success) {
      await tx.update(webhookEvents).set({ status: 'FAILED', error: 'Invalid payload', processedAt: new Date() }).where(eq(webhookEvents.id, eventId));
      return { status: 'SKIPPED' };
    }
    const mail = parsed.data;
    const organizationId = inbox.organizationId;
    const markProcessed = () => tx.update(webhookEvents).set({ status: 'PROCESSED', processedAt: new Date() }).where(eq(webhookEvents.id, eventId));

    const lead = await findOrCreateContactLead(tx, organizationId, { name: mail.from.name, email: mail.from.email, sourceType: 'EMAIL' });

    // Email threads by In-Reply-To/References; other channels rely on the lead's open conversation.
    const threadIds = [mail.inReplyTo, ...(mail.references ?? [])].filter((x): x is string => !!x);
    const [threaded] = threadIds.length
      ? await tx
          .select({ id: conversations.id })
          .from(messages)
          .innerJoin(conversations, eq(conversations.id, messages.conversationId))
          .where(and(eq(messages.organizationId, organizationId), eq(conversations.inboxId, inbox.id), inArray(messages.externalMessageId, threadIds)))
          .orderBy(desc(messages.seq))
          .limit(1)
      : [];

    const result = await recordInboundMessage(tx, {
      organizationId,
      inbox,
      lead,
      conversationId: threaded?.id ?? null,
      subject: mail.subject ?? null,
      text: mail.text,
      externalMessageId: mail.messageId,
      metadata: { from: mail.from, subject: mail.subject ?? null },
      notificationTitle: `New message from ${mail.from.name || mail.from.email}`,
    });
    await markProcessed();
    if (result.duplicate) return { status: 'SKIPPED' };
    return { status: 'PROCESSED', organizationId, conversationId: result.conversationId, leadId: lead.id, notifyUserId: result.notifyUserId };
  });
}