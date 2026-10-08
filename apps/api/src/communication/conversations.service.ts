import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { conversations, type DbHandle, inboxes, leads, messages, type Transaction, users } from '@leadora/database';
import type { Queue } from 'bullmq';
import { aliasedTable, and, asc, desc, eq, isNull, ne, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth-context';
import { DB, MESSAGES_QUEUE } from '../infra/tokens';
import { RealtimePublisher } from '../realtime/realtime.publisher';

export const startSchema = z.object({
  inboxId: z.uuid(),
  leadId: z.uuid(),
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1).max(20_000),
});
export const messageSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  internal: z.boolean().optional(),
  // Set when the agent sends an AI-drafted reply, so AI involvement stays visible (spec §32).
  aiGenerated: z.boolean().optional(),
});
export const updateSchema = z
  .object({ status: z.enum(['OPEN', 'PENDING', 'RESOLVED']), assignedUserId: z.uuid().nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export const listSchema = z.object({
  view: z.enum(['all', 'mine', 'unassigned', 'unread', 'waiting_agent', 'waiting_customer', 'resolved']).default('all'),
  inboxId: z.uuid().optional(),
  leadId: z.uuid().optional(),
});

const notFound = () => new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' });
const assignee = aliasedTable(users, 'assignee');
const sender = aliasedTable(users, 'sender');
const preview = (text: string) => text.replace(/\s+/g, ' ').slice(0, 160);

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(MESSAGES_QUEUE) private readonly queue: Queue,
    private readonly realtime: RealtimePublisher,
  ) {}

  async list(auth: AuthContext, q: z.infer<typeof listSchema>) {
    const open = ne(conversations.status, 'RESOLVED');
    const view: Record<typeof q.view, SQL | undefined> = {
      all: open,
      mine: and(open, eq(conversations.assignedUserId, auth.userId)),
      unassigned: and(open, isNull(conversations.assignedUserId)),
      unread: and(open, eq(conversations.unread, true)),
      waiting_agent: and(open, eq(conversations.lastDirection, 'INBOUND')),
      waiting_customer: and(open, eq(conversations.lastDirection, 'OUTBOUND')),
      resolved: eq(conversations.status, 'RESOLVED'),
    };
    return this.find(
      this.handle.db,
      auth.organizationId,
      and(view[q.view], q.inboxId ? eq(conversations.inboxId, q.inboxId) : undefined, q.leadId ? eq(conversations.leadId, q.leadId) : undefined),
    );
  }

  private async find(db: DbHandle['db'] | Transaction, organizationId: string, where?: SQL) {
    const rows = await db
      .select({
        id: conversations.id,
        subject: conversations.subject,
        status: conversations.status,
        unread: conversations.unread,
        lastDirection: conversations.lastDirection,
        lastMessageAt: conversations.lastMessageAt,
        lastMessagePreview: conversations.lastMessagePreview,
        createdAt: conversations.createdAt,
        inboxId: inboxes.id,
        inboxName: inboxes.name,
        channel: inboxes.channel,
        leadId: leads.id,
        leadName: leads.fullName,
        leadEmail: leads.email,
        leadPhone: leads.phone,
        assigneeId: assignee.id,
        assigneeName: assignee.fullName,
      })
      .from(conversations)
      .innerJoin(inboxes, eq(inboxes.id, conversations.inboxId))
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .leftJoin(assignee, eq(assignee.id, conversations.assignedUserId))
      .where(and(eq(conversations.organizationId, organizationId), where))
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt))
      .limit(200);
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      status: r.status,
      unread: r.unread,
      waitingOn: r.lastDirection === 'INBOUND' ? 'AGENT' : r.lastDirection === 'OUTBOUND' ? 'CUSTOMER' : null,
      lastMessageAt: r.lastMessageAt,
      lastMessagePreview: r.lastMessagePreview,
      createdAt: r.createdAt,
      inbox: { id: r.inboxId, name: r.inboxName, channel: r.channel },
      lead: { id: r.leadId, fullName: r.leadName, email: r.leadEmail, phone: r.leadPhone },
      assignee: r.assigneeId ? { id: r.assigneeId, fullName: r.assigneeName } : null,
    }));
  }

  async get(organizationId: string, id: string, db: DbHandle['db'] | Transaction = this.handle.db) {
    const [row] = await this.find(db, organizationId, eq(conversations.id, id));
    if (!row) throw notFound();
    return row;
  }

  async messages(auth: AuthContext, id: string) {
    await this.get(auth.organizationId, id);
    const rows = await this.handle.db
      .select({
        id: messages.id,
        direction: messages.direction,
        senderType: messages.senderType,
        content: messages.content,
        contentType: messages.contentType,
        status: messages.status,
        error: messages.error,
        sentAt: messages.sentAt,
        createdAt: messages.createdAt,
        aiGenerated: messages.aiGenerated,
        senderId: sender.id,
        senderName: sender.fullName,
      })
      .from(messages)
      .leftJoin(sender, eq(sender.id, messages.senderUserId))
      .where(and(eq(messages.organizationId, auth.organizationId), eq(messages.conversationId, id)))
      .orderBy(asc(messages.seq))
      .limit(500);
    return rows.map(({ senderId, senderName, ...m }) => ({ ...m, sender: senderId ? { id: senderId, fullName: senderName } : null }));
  }

  async start(auth: AuthContext, input: z.infer<typeof startSchema>) {
    const result = await this.handle.db.transaction(async (tx) => {
      const [inbox] = await tx
        .select()
        .from(inboxes)
        .where(and(eq(inboxes.id, input.inboxId), eq(inboxes.organizationId, auth.organizationId), eq(inboxes.enabled, true)));
      if (!inbox) throw new UnprocessableEntityException({ code: 'INVALID_INBOX', message: 'Inbox not found' });
      const [lead] = await tx
        .select({ id: leads.id, email: leads.email, phone: leads.phone, archivedAt: leads.archivedAt })
        .from(leads)
        .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, auth.organizationId)));
      if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead not found' });
      if (lead.archivedAt) throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Restore this lead first' });
      const address = inbox.channel === 'EMAIL' ? lead.email : lead.phone;
      if (!address) {
        throw new UnprocessableEntityException({
          code: 'LEAD_HAS_NO_ADDRESS',
          message: inbox.channel === 'EMAIL' ? 'This lead has no email address' : 'This lead has no phone number',
        });
      }

      const [conversation] = await tx
        .insert(conversations)
        .values({ organizationId: auth.organizationId, inboxId: inbox.id, leadId: lead.id, subject: input.subject || null })
        .returning({ id: conversations.id });
      const message = await this.addOutbound(tx, auth, conversation!.id, input.body);
      return { conversationId: conversation!.id, message };
    });
    await this.realtime.publish(auth.organizationId, 'conversation.updated', { conversationId: result.conversationId });
    return { conversation: await this.get(auth.organizationId, result.conversationId), message: result.message };
  }

  /** Persists QUEUED, then hands off to the worker (spec §33: no sending inside the request). */
  private async addOutbound(tx: Transaction, auth: AuthContext, conversationId: string, body: string, aiGenerated = false) {
    const [message] = await tx
      .insert(messages)
      .values({
        organizationId: auth.organizationId,
        conversationId,
        direction: 'OUTBOUND',
        senderType: 'USER',
        senderUserId: auth.userId,
        content: body,
        status: 'QUEUED',
        aiGenerated,
      })
      .returning();
    await tx
      .update(conversations)
      .set({ lastDirection: 'OUTBOUND', lastMessageAt: message!.createdAt, lastMessagePreview: preview(body), unread: false, status: 'OPEN' })
      .where(eq(conversations.id, conversationId));
    // Enqueued before commit: the worker skips messages it can't find, so a rollback is harmless.
    await this.queue.add('message.send', { messageId: message!.id }, { jobId: message!.id, attempts: 4, backoff: { type: 'custom' } });
    return this.shape(message!, auth);
  }

  private shape(m: typeof messages.$inferSelect, auth: AuthContext) {
    return {
      id: m.id,
      direction: m.direction,
      senderType: m.senderType,
      content: m.content,
      contentType: m.contentType,
      status: m.status,
      error: m.error,
      sentAt: m.sentAt,
      createdAt: m.createdAt,
      aiGenerated: m.aiGenerated,
      sender: { id: auth.userId },
    };
  }

  async send(auth: AuthContext, id: string, input: z.infer<typeof messageSchema>) {
    const message = await this.handle.db.transaction(async (tx) => {
      const [conv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.organizationId, auth.organizationId)))
        .for('update');
      if (!conv) throw notFound();
      if (!input.internal) return this.addOutbound(tx, auth, id, input.body, input.aiGenerated ?? false);
      const [note] = await tx
        .insert(messages)
        .values({
          organizationId: auth.organizationId,
          conversationId: id,
          direction: 'INTERNAL',
          senderType: 'USER',
          senderUserId: auth.userId,
          content: input.body,
          status: 'SENT',
          sentAt: new Date(),
        })
        .returning();
      return this.shape(note!, auth);
    });
    await this.realtime.publish(auth.organizationId, 'message.created', { conversationId: id, messageId: message.id });
    return message;
  }

  async update(auth: AuthContext, id: string, input: z.infer<typeof updateSchema>) {
    await this.handle.db.transaction(async (tx) => {
      const [conv] = await tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.organizationId, auth.organizationId)))
        .for('update');
      if (!conv) throw notFound();
      if (input.assignedUserId !== undefined && input.assignedUserId !== conv.assignedUserId) {
        if (!auth.permissions.has('conversation.assign')) {
          throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to assign conversations' });
        }
        if (input.assignedUserId) {
          const [u] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, input.assignedUserId), eq(users.organizationId, auth.organizationId), eq(users.status, 'ACTIVE')));
          if (!u) throw new UnprocessableEntityException({ code: 'INVALID_ASSIGNEE', message: 'Assignee must be an active user in your organization' });
        }
      }
      await tx.update(conversations).set(input).where(eq(conversations.id, id));
    });
    await this.realtime.publish(auth.organizationId, 'conversation.updated', { conversationId: id });
    return this.get(auth.organizationId, id);
  }

  async markRead(auth: AuthContext, id: string) {
    const updated = await this.handle.db
      .update(conversations)
      .set({ unread: false })
      .where(and(eq(conversations.id, id), eq(conversations.organizationId, auth.organizationId)))
      .returning({ id: conversations.id });
    if (!updated.length) throw notFound();
  }
}
