import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Database, inboxes, messages, webhookEvents } from '@leadora/database';
import { and, eq, inArray } from 'drizzle-orm';
import type { ChannelProvider, OutboundEnvelope } from '../communication/delivery';
import { findOrCreateContactLead, recordInboundMessage } from '../communication/receive';
import { decryptSecret } from '../secrets';

/**
 * Meta channels (spec §89): WhatsApp Cloud API, Messenger and Instagram. Everything provider-specific lives
 * here; the CRM sees normalized messages and statuses only (spec §88).
 */
export type MetaChannel = 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM';

/** `X-Hub-Signature-256: sha256=<hex HMAC_SHA256(app secret, raw body)>`, compared in constant time. */
export function verifyMetaSignature(appSecret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface MetaInboundMessage {
  externalId: string;
  /** WhatsApp: the phone number (wa_id); Messenger/Instagram: the page-scoped sender id. */
  fromId: string;
  name: string | null;
  text: string;
}

export interface MetaStatus {
  externalId: string;
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  error: string | null;
}

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** Media and other non-text messages become a readable placeholder plus any caption. */
function whatsappText(m: Json): string {
  const type = str(m.type) ?? 'unknown';
  if (type === 'text') return str(obj(m.text).body) ?? '';
  if (type === 'button') return str(obj(m.button).text) ?? '[button]';
  if (type === 'interactive') {
    const i = obj(m.interactive);
    return str(obj(i.button_reply).title) ?? str(obj(i.list_reply).title) ?? '[interactive reply]';
  }
  const caption = str(obj(m[type]).caption);
  return `[${type}]${caption ? ` ${caption}` : ''}`;
}

/** Normalizes a webhook payload for the given channel. Unknown shapes yield nothing rather than failing. */
export function parseMetaPayload(channel: MetaChannel, payload: unknown): { messages: MetaInboundMessage[]; statuses: MetaStatus[] } {
  const out = { messages: [] as MetaInboundMessage[], statuses: [] as MetaStatus[] };
  const body = obj(payload);
  for (const entry of arr(body.entry)) {
    if (channel === 'WHATSAPP') {
      for (const change of arr(entry.changes)) {
        const value = obj(change.value);
        const names = new Map(arr(value.contacts).map((c) => [str(c.wa_id), str(obj(c.profile).name)]));
        for (const m of arr(value.messages)) {
          const id = str(m.id);
          const from = str(m.from);
          if (!id || !from) continue;
          out.messages.push({ externalId: id, fromId: from, name: names.get(from) ?? null, text: whatsappText(m) });
        }
        for (const s of arr(value.statuses)) {
          const id = str(s.id);
          const status = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' }[str(s.status) ?? ''] as MetaStatus['status'] | undefined;
          if (!id || !status) continue;
          const err = arr(s.errors)[0];
          out.statuses.push({ externalId: id, status, error: err ? `${str(err.title) ?? 'Error'}${err.code ? ` (${String(err.code)})` : ''}` : null });
        }
      }
    } else {
      for (const ev of arr(entry.messaging)) {
        const message = obj(ev.message);
        const sender = str(obj(ev.sender).id);
        // Echoes are our own outbound messages coming back; deliveries/reads arrive without text.
        if (str(message.mid) && sender && !message.is_echo) {
          const attachments = arr(message.attachments).map((a) => `[${str(a.type) ?? 'attachment'}]`);
          const text = [str(message.text), ...attachments].filter(Boolean).join(' ');
          if (text) out.messages.push({ externalId: str(message.mid)!, fromId: sender, name: null, text });
        }
        for (const mid of arr(obj(ev.delivery).mids as unknown)) {
          if (typeof mid === 'string') out.statuses.push({ externalId: mid, status: 'DELIVERED', error: null });
        }
      }
    }
  }
  return out;
}

const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/**
 * Processes one stored webhook event: new customer messages through the shared receive path (idempotent on
 * the provider id) and delivery/read/failed statuses onto our outbound messages (never moving backwards).
 */
export async function processMetaEvent(db: Database, eventId: string) {
  return db.transaction(async (tx) => {
    const [event] = await tx.select().from(webhookEvents).where(eq(webhookEvents.id, eventId)).for('update');
    if (!event || event.status === 'PROCESSED' || !event.inboxId) return { status: 'SKIPPED' as const, conversations: [] as string[] };
    const [inbox] = await tx.select().from(inboxes).where(eq(inboxes.id, event.inboxId));
    if (!inbox || !['WHATSAPP', 'FACEBOOK', 'INSTAGRAM'].includes(inbox.channel)) {
      await tx.update(webhookEvents).set({ status: 'FAILED', error: 'Not a Meta inbox', processedAt: new Date() }).where(eq(webhookEvents.id, eventId));
      return { status: 'SKIPPED' as const, conversations: [] as string[] };
    }
    const channel = inbox.channel as MetaChannel;
    const parsed = parseMetaPayload(channel, event.payload);
    const touched = new Set<string>();

    for (const m of parsed.messages) {
      const lead = await findOrCreateContactLead(tx, inbox.organizationId, {
        name: m.name ?? (channel === 'WHATSAPP' ? null : `${channel === 'FACEBOOK' ? 'Messenger' : 'Instagram'} contact`),
        phone: channel === 'WHATSAPP' ? `+${m.fromId}` : null,
        channelId: { channel, id: m.fromId },
        sourceType: channel,
      });
      const r = await recordInboundMessage(tx, {
        organizationId: inbox.organizationId,
        inbox,
        lead,
        text: m.text,
        externalMessageId: m.externalId,
        metadata: { channel, fromId: m.fromId },
      });
      if (!r.duplicate) touched.add(r.conversationId);
    }

    const ids = parsed.statuses.map((s) => s.externalId);
    const existing = ids.length
      ? await tx
          .select({ id: messages.id, externalMessageId: messages.externalMessageId, status: messages.status, conversationId: messages.conversationId })
          .from(messages)
          .where(and(eq(messages.organizationId, inbox.organizationId), inArray(messages.externalMessageId, ids)))
      : [];
    for (const s of parsed.statuses) {
      const msg = existing.find((e) => e.externalMessageId === s.externalId);
      if (!msg) continue;
      const forward = s.status === 'FAILED' || (RANK[s.status] ?? 0) > (RANK[msg.status] ?? 0);
      if (!forward) continue;
      await tx.update(messages).set({ status: s.status, ...(s.error ? { error: s.error.slice(0, 500) } : {}) }).where(eq(messages.id, msg.id));
      msg.status = s.status;
      touched.add(msg.conversationId);
    }

    await tx.update(webhookEvents).set({ status: 'PROCESSED', processedAt: new Date() }).where(eq(webhookEvents.id, eventId));
    return { status: 'PROCESSED' as const, organizationId: inbox.organizationId, conversations: [...touched] };
  });
}

/** Sends through the Graph API with the inbox's own (sealed) access token. */
export class MetaGraphProvider implements ChannelProvider {
  constructor(
    private readonly opts: { encryptionKey: string; graphUrl: string; fetch?: typeof fetch },
  ) {}

  async send(env: OutboundEnvelope): Promise<{ externalMessageId: string }> {
    const cfg = env.inbox.config as { accessTokenEnc?: string; accountId?: string };
    if (!cfg.accessTokenEnc || !cfg.accountId) throw new Error('This inbox is missing its Meta credentials');
    const token = decryptSecret(cfg.accessTokenEnc, this.opts.encryptionKey);
    const body =
      env.channel === 'WHATSAPP'
        ? { messaging_product: 'whatsapp', to: env.to.replace(/^\+/, ''), type: 'text', text: { body: env.text, preview_url: false } }
        : { recipient: { id: env.to }, messaging_type: 'RESPONSE', message: { text: env.text } };
    const res = await (this.opts.fetch ?? fetch)(`${this.opts.graphUrl.replace(/\/$/, '')}/${encodeURIComponent(cfg.accountId)}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; message_id?: string; error?: { message?: string; code?: number } };
    if (!res.ok) {
      // Graph explains failures such as WhatsApp's 24-hour window; surface that text to the agent.
      throw new Error(`Meta rejected the message: ${json.error?.message ?? `HTTP ${res.status}`}${json.error?.code ? ` (code ${json.error.code})` : ''}`);
    }
    const id = json.messages?.[0]?.id ?? json.message_id;
    if (!id) throw new Error('Meta did not return a message id');
    return { externalMessageId: id };
  }
}
