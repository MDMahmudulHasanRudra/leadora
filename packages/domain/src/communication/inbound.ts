import { activities, conversations, type Database, inboxes, leads, messages, type Transaction, webhookEvents } from '@leadora/database';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { ingestLead } from '../leads/ingestion';
import { normalizeEmail } from '../leads/normalize';
import { notify } from '../notifications';
import { createLeadSchema } from '../leads/schemas';
import { rescoreLeads } from '../scoring/rescore';
import { emitEvent } from '../automation/events';

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

const preview = (text: string) => text.replace(/\s+/g, ' ').slice(0, 160);

export interface InboundResult {
  status: 'PROCESSED' | 'SKIPPED';
  organizationId?: string;
  conversationId?: string;
  leadId?: string;
  notifyUserId?: string | null;
}

async function findOrCreateLead(tx: Transaction, organizationId: string, from: InboundEmail['from']) {
  const email = normalizeEmail(from.email);
  const [existing] = await tx
    .select({ id: leads.id, ownerUserId: leads.ownerUserId })
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), eq(leads.email, email)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  if (existing) return existing;
  const result = await ingestLead(
    tx,
    { organizationId, actorUserId: null, sourceType: 'EMAIL', autoAssign: true },
    createLeadSchema.parse({ fullName: from.name || email.split('@')[0]!, email }),
  );
  const id = result.status === 'CREATED' ? result.leadId : result.existingLeadId;
  const [lead] = await tx.select({ id: leads.id, ownerUserId: leads.ownerUserId }).from(leads).where(eq(leads.id, id));
  return lead!;
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

    const [already] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.organizationId, organizationId), eq(messages.externalMessageId, mail.messageId)));
    if (already) {
      await markProcessed();
      return { status: 'SKIPPED' };
    }

    const lead = await findOrCreateLead(tx, organizationId, mail.from);

    const threadIds = [mail.inReplyTo, ...(mail.references ?? [])].filter((x): x is string => !!x);
    let [conversation] = threadIds.length
      ? await tx
          .select({ id: conversations.id, assignedUserId: conversations.assignedUserId })
          .from(messages)
          .innerJoin(conversations, eq(conversations.id, messages.conversationId))
          .where(and(eq(messages.organizationId, organizationId), eq(conversations.inboxId, inbox.id), inArray(messages.externalMessageId, threadIds)))
          .orderBy(desc(messages.seq))
          .limit(1)
      : [];
    conversation ??= (
      await tx
        .select({ id: conversations.id, assignedUserId: conversations.assignedUserId })
        .from(conversations)
        .where(and(eq(conversations.inboxId, inbox.id), eq(conversations.leadId, lead.id), ne(conversations.status, 'RESOLVED')))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(1)
    )[0];
    if (!conversation) {
      [conversation] = await tx
        .insert(conversations)
        .values({ organizationId, inboxId: inbox.id, leadId: lead.id, subject: mail.subject?.slice(0, 300) || null })
        .returning({ id: conversations.id, assignedUserId: conversations.assignedUserId });
    }

    const [message] = await tx
      .insert(messages)
      .values({
        organizationId,
        conversationId: conversation!.id,
        direction: 'INBOUND',
        senderType: 'LEAD',
        externalMessageId: mail.messageId,
        content: mail.text,
        status: 'RECEIVED',
        metadata: { from: mail.from, subject: mail.subject ?? null },
      })
      .returning({ id: messages.id, createdAt: messages.createdAt });
    await tx
      .update(conversations)
      .set({ lastDirection: 'INBOUND', lastMessageAt: message!.createdAt, lastMessagePreview: preview(mail.text), unread: true, status: 'OPEN' })
      .where(eq(conversations.id, conversation!.id));
    await tx.insert(activities).values({
      organizationId,
      leadId: lead.id,
      actorUserId: null,
      type: 'message.received',
      payload: { channel: inbox.channel, conversationId: conversation!.id, messageId: message!.id },
    });
    const notifyUserId = conversation!.assignedUserId ?? lead.ownerUserId;
    if (notifyUserId) {
      await notify(tx, {
        organizationId,
        userId: notifyUserId,
        type: 'message_received',
        title: `New message from ${mail.from.name || mail.from.email}`,
        body: preview(mail.text),
        link: `/inbox?c=${conversation!.id}`,
        data: { conversationId: conversation!.id, leadId: lead.id },
      });
    }
    await rescoreLeads(tx, organizationId, [lead.id]);
    await emitEvent(tx, {
      organizationId,
      type: 'message.received',
      leadId: lead.id,
      payload: { channel: inbox.channel, conversationId: conversation!.id, messageId: message!.id, text: mail.text.slice(0, 2000) },
    });
    await markProcessed();
    return {
      status: 'PROCESSED',
      organizationId,
      conversationId: conversation!.id,
      leadId: lead.id,
      notifyUserId: conversation!.assignedUserId ?? lead.ownerUserId,
    };
  });
}
