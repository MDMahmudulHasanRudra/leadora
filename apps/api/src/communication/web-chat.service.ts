import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import type { Env } from '@leadora/config';
import { conversations, type DbHandle, inboxes, messages } from '@leadora/database';
import { findOrCreateContactLead, recordInboundMessage } from '@leadora/domain';
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { RateLimiter } from '../common/rate-limiter';
import { DB, ENV } from '../infra/tokens';
import { RealtimePublisher } from '../realtime/realtime.publisher';

const startSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254).optional().or(z.literal('').transform(() => undefined)),
  phone: z.string().trim().min(5).max(30).optional().or(z.literal('').transform(() => undefined)),
  message: z.string().trim().min(1).max(5000),
});
const messageSchema = z.object({ text: z.string().trim().min(1).max(5000) });

const invalid = (issues: z.core.$ZodIssue[]) =>
  new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: 'Please check your message', details: issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });

interface ChatConfig {
  allowedOrigins?: string[];
  title?: string;
  greeting?: string;
}

/**
 * Website chat (spec §111). A visitor's session is one conversation, identified by a signed token that only
 * opens that conversation — never the lead's other conversations, even when an email matches an existing lead.
 */
@Injectable()
export class WebChatService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    private readonly limiter: RateLimiter,
    private readonly realtime: RealtimePublisher,
  ) {}

  private sign(inboxId: string, conversationId: string) {
    return createHmac('sha256', this.env.JWT_SECRET).update(`webchat:${inboxId}:${conversationId}`).digest('base64url');
  }

  private token(inboxId: string, conversationId: string) {
    return `${conversationId}.${this.sign(inboxId, conversationId)}`;
  }

  private async inbox(key: string) {
    const [inbox] = await this.handle.db
      .select()
      .from(inboxes)
      .where(and(eq(inboxes.channel, 'WEB_CHAT'), eq(inboxes.address, key), eq(inboxes.enabled, true)));
    if (!inbox) throw new NotFoundException({ code: 'CHAT_NOT_FOUND', message: 'This chat is not available' });
    return { ...inbox, chat: inbox.config as ChatConfig };
  }

  private assertOrigin(chat: ChatConfig, origin: string | null) {
    const allowed = chat.allowedOrigins ?? [];
    if (allowed.length && (!origin || !allowed.includes(origin))) {
      throw new ForbiddenException({ code: 'ORIGIN_NOT_ALLOWED', message: 'This chat cannot be used from this website' });
    }
  }

  /** Verifies the token and that its conversation belongs to this widget's inbox. */
  private async session(key: string, token: string | undefined, origin: string | null) {
    const inbox = await this.inbox(key);
    this.assertOrigin(inbox.chat, origin);
    const unauthorized = new UnauthorizedException({ code: 'INVALID_CHAT_TOKEN', message: 'This chat session has expired. Please start a new one.' });
    const [conversationId, sig] = (token ?? '').split('.');
    if (!conversationId || !sig || !/^[0-9a-f-]{36}$/.test(conversationId)) throw unauthorized;
    const expected = Buffer.from(this.sign(inbox.id, conversationId));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw unauthorized;
    const [conv] = await this.handle.db
      .select({ id: conversations.id, leadId: conversations.leadId, assignedUserId: conversations.assignedUserId })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.inboxId, inbox.id)));
    if (!conv) throw unauthorized;
    return { inbox, conv };
  }

  async widget(key: string) {
    const { chat } = await this.inbox(key);
    return { title: chat.title ?? 'Chat with us', greeting: chat.greeting ?? 'Hi! How can we help?' };
  }

  async start(key: string, raw: unknown, ctx: { origin: string | null; ip: string | null }) {
    const inbox = await this.inbox(key);
    this.assertOrigin(inbox.chat, ctx.origin);
    const parsed = startSchema.safeParse(raw);
    if (!parsed.success) throw invalid(parsed.error.issues);
    await this.limiter.hit(`chat-start:${inbox.id}:${ctx.ip ?? 'unknown'}`, 5, 600);
    const body = parsed.data;

    const conversationId = await this.handle.db.transaction(async (tx) => {
      const lead = await findOrCreateContactLead(tx, inbox.organizationId, {
        name: body.name,
        email: body.email,
        phone: body.phone,
        // A visitor who leaves no email or phone is an anonymous chat contact of their own.
        channelId: body.email || body.phone ? null : { channel: 'WEB_CHAT', id: randomUUID() },
        sourceType: 'WEBSITE',
      });
      // Always a fresh conversation: the token must never reveal earlier conversations with this lead.
      const [conv] = await tx
        .insert(conversations)
        .values({ organizationId: inbox.organizationId, inboxId: inbox.id, leadId: lead.id, subject: 'Website chat' })
        .returning({ id: conversations.id });
      await recordInboundMessage(tx, {
        organizationId: inbox.organizationId,
        inbox,
        lead,
        conversationId: conv!.id,
        subject: 'Website chat',
        text: body.message,
        metadata: { origin: ctx.origin },
        notificationTitle: `New website chat from ${body.name}`,
      });
      return conv!.id;
    });
    await this.realtime.publish(inbox.organizationId, 'conversation.updated', { conversationId });
    return { token: this.token(inbox.id, conversationId), messages: (await this.messages(conversationId, 0)).items };
  }

  async send(key: string, token: string | undefined, raw: unknown, origin: string | null) {
    const { inbox, conv } = await this.session(key, token, origin);
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success) throw invalid(parsed.error.issues);
    await this.limiter.hit(`chat-msg:${conv.id}`, 30, 60);
    await this.handle.db.transaction(async (tx) => {
      const lead = { id: conv.leadId, ownerUserId: null as string | null };
      await recordInboundMessage(tx, { organizationId: inbox.organizationId, inbox, lead, conversationId: conv.id, text: parsed.data.text, notificationTitle: 'New website chat message' });
    });
    await this.realtime.publish(inbox.organizationId, 'conversation.updated', { conversationId: conv.id });
    return { ok: true };
  }

  async poll(key: string, token: string | undefined, after: number, origin: string | null) {
    const { conv } = await this.session(key, token, origin);
    return this.messages(conv.id, after);
  }

  /** What the visitor may see: their messages and our replies — never internal notes or failed sends. */
  private async messages(conversationId: string, after: number) {
    const rows = await this.handle.db
      .select({ id: messages.id, seq: messages.seq, direction: messages.direction, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), ne(messages.direction, 'INTERNAL'), ne(messages.status, 'FAILED'), gt(messages.seq, after)))
      .orderBy(asc(messages.seq))
      .limit(100);
    return { items: rows.map((m) => ({ id: m.id, seq: m.seq, from: m.direction === 'INBOUND' ? 'you' : 'agent', text: m.content, at: m.createdAt })) };
  }
}
