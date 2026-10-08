import { activities, conversations, type Database, inboxes, leads, messages } from '@leadora/database';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { rescoreLeads } from '../scoring/rescore';

export type ChannelKind = (typeof inboxes.$inferSelect)['channel'];

export interface OutboundEnvelope {
  channel: ChannelKind;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  /** Email threading; other channels ignore these. */
  inReplyTo: string | null;
  references: string[];
}

/** Spec §21: core code depends on this, never on a provider SDK. */
export interface ChannelProvider {
  send(envelope: OutboundEnvelope): Promise<{ externalMessageId: string }>;
}

export type ChannelProviders = Partial<Record<ChannelKind, ChannelProvider>>;

const MAX_REFERENCES = 20;

/**
 * Sends one QUEUED outbound message. Safe to retry: anything not QUEUED is skipped. Transient provider
 * errors are rethrown for the queue to retry; on the final attempt (or with no provider) the message is
 * marked FAILED so agents can see it.
 */
export async function deliverMessage(
  db: Database,
  messageId: string,
  providers: ChannelProviders,
  opts: { finalAttempt: boolean },
): Promise<{ status: 'SENT' | 'SKIPPED'; conversationId?: string; organizationId?: string }> {
  const [row] = await db
    .select({ message: messages, conversation: conversations, inbox: inboxes, lead: leads })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(inboxes, eq(inboxes.id, conversations.inboxId))
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .where(eq(messages.id, messageId));
  if (!row || row.message.status !== 'QUEUED' || row.message.direction !== 'OUTBOUND') return { status: 'SKIPPED' };

  const fail = async (error: string) =>
    db.update(messages).set({ status: 'FAILED', error: error.slice(0, 500) }).where(eq(messages.id, messageId));

  const provider = providers[row.inbox.channel];
  if (!provider) {
    const error = `No provider configured for ${row.inbox.channel}`;
    await fail(error);
    throw new Error(error);
  }

  const thread = await db
    .select({ externalMessageId: messages.externalMessageId })
    .from(messages)
    .where(and(eq(messages.conversationId, row.conversation.id), isNotNull(messages.externalMessageId)))
    .orderBy(asc(messages.seq));
  const references = thread.map((m) => m.externalMessageId!).slice(-MAX_REFERENCES);
  const baseSubject = row.conversation.subject ?? `Message from ${row.inbox.name}`;
  const subject = references.length && !/^re:/i.test(baseSubject) ? `Re: ${baseSubject}` : baseSubject;
  const to = row.inbox.channel === 'EMAIL' ? row.lead.email : row.lead.phone;

  let externalMessageId: string;
  try {
    if (!to) throw new Error('The lead has no address for this channel');
    ({ externalMessageId } = await provider.send({
      channel: row.inbox.channel,
      from: row.inbox.address,
      fromName: String(row.inbox.config.fromName ?? row.inbox.name),
      to,
      subject,
      text: row.message.content,
      inReplyTo: references.at(-1) ?? null,
      references,
    }));
  } catch (err) {
    if (opts.finalAttempt) await fail((err as Error).message);
    throw err;
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(messages).set({ status: 'SENT', sentAt: now, externalMessageId, error: null }).where(eq(messages.id, messageId));
    await tx.update(leads).set({ lastContactedAt: now }).where(eq(leads.id, row.lead.id));
    await tx.insert(activities).values({
      organizationId: row.message.organizationId,
      leadId: row.lead.id,
      actorUserId: row.message.senderUserId,
      type: 'message.sent',
      payload: { channel: row.inbox.channel, conversationId: row.conversation.id, messageId },
    });
    await rescoreLeads(tx, row.message.organizationId, [row.lead.id]);
  });
  return { status: 'SENT', conversationId: row.conversation.id, organizationId: row.message.organizationId };
}
