import { activities, conversations, leads, messages, organizations, type Transaction } from '@leadora/database';
import { and, desc, eq, ne, or, sql } from 'drizzle-orm';
import { emitEvent } from '../automation/events';
import { type IngestSourceType, ingestLead } from '../leads/ingestion';
import { normalizeEmail, normalizePhone } from '../leads/normalize';
import { createLeadSchema, leadFields } from '../leads/schemas';
import { z } from 'zod';
import { notify } from '../notifications';
import { rescoreLeads } from '../scoring/rescore';

export const preview = (text: string) => text.replace(/\s+/g, ' ').slice(0, 160);

/** Who wrote in, as each channel knows them: email, phone, and/or a channel-scoped id (Messenger PSID…). */
export interface InboundContact {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  /** e.g. { channel: 'FACEBOOK', id: '<page-scoped id>' } — stored on the lead to recognise repeat contacts. */
  channelId?: { channel: string; id: string } | null;
  sourceType: IngestSourceType;
}

/**
 * Finds the lead behind an inbound message (by channel id, email or phone) or creates one through the
 * single ingestion path (spec §12), auto-assigned like every other new lead.
 */
export async function findOrCreateContactLead(tx: Transaction, organizationId: string, c: InboundContact) {
  const email = c.email ? normalizeEmail(c.email) : null;
  const country = c.phone ? (await tx.select({ c: organizations.defaultCountry }).from(organizations).where(eq(organizations.id, organizationId)))[0]?.c : undefined;
  const phone = c.phone ? normalizePhone(c.phone, country ?? 'BD') : null;
  const matchers = [
    c.channelId ? sql`${leads.metadata} -> 'channelIds' ->> ${c.channelId.channel} = ${c.channelId.id}` : undefined,
    email ? eq(leads.email, email) : undefined,
    phone ? eq(leads.phone, phone) : undefined,
  ].filter((m) => m !== undefined);
  if (matchers.length) {
    const [existing] = await tx
      .select({ id: leads.id, ownerUserId: leads.ownerUserId })
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), or(...matchers)))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    if (existing) return existing;
  }
  const result = await ingestLead(
    tx,
    {
      organizationId,
      actorUserId: null,
      sourceType: c.sourceType,
      autoAssign: true,
      ...(c.channelId ? { metadata: { channelIds: { [c.channelId.channel]: c.channelId.id } } } : {}),
    },
    // Human-entered leads need an email or phone; a channel contact is reachable through its channel id.
    (c.channelId ? z.object(leadFields) : createLeadSchema).parse({
      fullName: c.name?.trim() || (email ? email.split('@')[0]! : phone ?? 'New contact'),
      ...(email ? { email } : {}),
      ...(c.phone ? { phone: c.phone } : {}),
    }),
  );
  const id = result.status === 'CREATED' ? result.leadId : result.existingLeadId;
  const [lead] = await tx.select({ id: leads.id, ownerUserId: leads.ownerUserId }).from(leads).where(eq(leads.id, id));
  return lead!;
}

export interface RecordInbound {
  organizationId: string;
  inbox: { id: string; channel: string };
  lead: { id: string; ownerUserId: string | null };
  /** A conversation the channel already threads to; else the lead's open one in this inbox, else a new one. */
  conversationId?: string | null;
  subject?: string | null;
  text: string;
  externalMessageId?: string | null;
  metadata?: Record<string, unknown>;
  notificationTitle?: string;
}

/**
 * Records one customer message the same way for every channel: conversation, message, timeline,
 * notification, rescore and the `message.received` outbox event. Idempotent on the provider message id.
 */
export async function recordInboundMessage(tx: Transaction, r: RecordInbound) {
  if (r.externalMessageId) {
    const [already] = await tx
      .select({ id: messages.id, conversationId: messages.conversationId })
      .from(messages)
      .where(and(eq(messages.organizationId, r.organizationId), eq(messages.externalMessageId, r.externalMessageId)));
    if (already) return { duplicate: true as const, conversationId: already.conversationId, messageId: already.id, notifyUserId: null };
  }

  let conversation = r.conversationId
    ? (await tx.select({ id: conversations.id, assignedUserId: conversations.assignedUserId }).from(conversations).where(eq(conversations.id, r.conversationId)))[0]
    : undefined;
  conversation ??= (
    await tx
      .select({ id: conversations.id, assignedUserId: conversations.assignedUserId })
      .from(conversations)
      .where(and(eq(conversations.inboxId, r.inbox.id), eq(conversations.leadId, r.lead.id), ne(conversations.status, 'RESOLVED')))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1)
  )[0];
  conversation ??= (
    await tx
      .insert(conversations)
      .values({ organizationId: r.organizationId, inboxId: r.inbox.id, leadId: r.lead.id, subject: r.subject?.slice(0, 300) || null })
      .returning({ id: conversations.id, assignedUserId: conversations.assignedUserId })
  )[0]!;

  const [message] = await tx
    .insert(messages)
    .values({
      organizationId: r.organizationId,
      conversationId: conversation.id,
      direction: 'INBOUND',
      senderType: 'LEAD',
      externalMessageId: r.externalMessageId ?? null,
      content: r.text,
      status: 'RECEIVED',
      metadata: r.metadata ?? null,
    })
    .returning({ id: messages.id, createdAt: messages.createdAt });
  await tx
    .update(conversations)
    .set({ lastDirection: 'INBOUND', lastMessageAt: message!.createdAt, lastMessagePreview: preview(r.text), unread: true, status: 'OPEN' })
    .where(eq(conversations.id, conversation.id));
  await tx.insert(activities).values({
    organizationId: r.organizationId,
    leadId: r.lead.id,
    actorUserId: null,
    type: 'message.received',
    payload: { channel: r.inbox.channel, conversationId: conversation.id, messageId: message!.id },
  });
  const notifyUserId = conversation.assignedUserId ?? r.lead.ownerUserId;
  if (notifyUserId) {
    await notify(tx, {
      organizationId: r.organizationId,
      userId: notifyUserId,
      type: 'message_received',
      title: r.notificationTitle ?? `New ${r.inbox.channel === 'EMAIL' ? 'email' : 'message'}${r.subject ? `: ${r.subject.slice(0, 80)}` : ''}`,
      body: preview(r.text),
      link: `/inbox?c=${conversation.id}`,
      data: { conversationId: conversation.id, leadId: r.lead.id },
    });
  }
  await rescoreLeads(tx, r.organizationId, [r.lead.id]);
  await emitEvent(tx, {
    organizationId: r.organizationId,
    type: 'message.received',
    leadId: r.lead.id,
    payload: { channel: r.inbox.channel, conversationId: conversation.id, messageId: message!.id, text: r.text.slice(0, 2000) },
  });
  return { duplicate: false as const, conversationId: conversation.id, messageId: message!.id, notifyUserId };
}
