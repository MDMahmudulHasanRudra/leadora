import { sql } from 'drizzle-orm';
import { bigint, boolean, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { leads } from './leads';
import { organizations } from './organizations';
import { users } from './users';

const ms = { withTimezone: true, precision: 3 } as const;
const stamps = {
  createdAt: timestamp(ms).notNull().defaultNow(),
  updatedAt: timestamp(ms)
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Spec §21. Core code only knows the channel type; provider details live in `config`.
export const channelType = pgEnum('channel_type', ['EMAIL', 'WEB_CHAT', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'SMS']);

export const inboxes = pgTable(
  'inboxes',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    channel: channelType().notNull(),
    // Our address on the channel: email address, phone number, page id…
    address: text().notNull(),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // AES-GCM sealed (DATA_ENCRYPTION_KEY); verifies inbound webhooks.
    webhookSecretEnc: text().notNull(),
    enabled: boolean().notNull().default(true),
    ...stamps,
  },
  (t) => [unique('inboxes_org_name_unique').on(t.organizationId, t.name)],
);

export const conversationStatus = pgEnum('conversation_status', ['OPEN', 'PENDING', 'RESOLVED']);

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    inboxId: uuid()
      .notNull()
      .references(() => inboxes.id, { onDelete: 'cascade' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    subject: text(),
    status: conversationStatus().notNull().default('OPEN'),
    assignedUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    // True when the customer wrote last and no agent has opened it since.
    unread: boolean().notNull().default(false),
    lastDirection: text(),
    lastMessageAt: timestamp(ms),
    lastMessagePreview: text(),
    ...stamps,
  },
  (t) => [
    index('conversations_org_status_last_idx').on(t.organizationId, t.status, t.lastMessageAt.desc()),
    index('conversations_org_assignee_idx').on(t.organizationId, t.assignedUserId),
    index('conversations_lead_idx').on(t.leadId),
  ],
);

export const messageDirection = pgEnum('message_direction', ['INBOUND', 'OUTBOUND', 'INTERNAL']);
export const messageSender = pgEnum('message_sender', ['LEAD', 'USER', 'SYSTEM', 'AI']);
export const messageStatus = pgEnum('message_status', ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED']);
export const messageContentType = pgEnum('message_content_type', ['TEXT', 'IMAGE', 'FILE', 'AUDIO', 'VIDEO', 'SYSTEM']);

// Spec §23.
export const messages = pgTable(
  'messages',
  {
    id: id(),
    seq: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    direction: messageDirection().notNull(),
    senderType: messageSender().notNull(),
    senderUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    // Provider id (email Message-ID, WhatsApp wamid…): threading and idempotency.
    externalMessageId: text(),
    content: text().notNull(),
    contentType: messageContentType().notNull().default('TEXT'),
    metadata: jsonb().$type<Record<string, unknown>>(),
    status: messageStatus().notNull(),
    error: text(),
    sentAt: timestamp(ms),
    deliveredAt: timestamp(ms),
    readAt: timestamp(ms),
    aiGenerated: boolean().notNull().default(false),
    aiApproved: boolean(),
    createdAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [
    index('messages_conversation_seq_idx').on(t.conversationId, t.seq),
    uniqueIndex('messages_org_external_id_unique').on(t.organizationId, t.externalMessageId).where(sql`${t.externalMessageId} is not null`),
  ],
);

export const webhookEventStatus = pgEnum('webhook_event_status', ['RECEIVED', 'PROCESSED', 'FAILED']);

// Spec §53: inbound events are persisted before processing; the unique key makes redelivery a no-op.
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    inboxId: uuid().references(() => inboxes.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    externalId: text().notNull(),
    payload: jsonb().notNull(),
    status: webhookEventStatus().notNull().default('RECEIVED'),
    error: text(),
    receivedAt: timestamp(ms).notNull().defaultNow(),
    processedAt: timestamp(ms),
  },
  (t) => [unique('webhook_events_inbox_external_unique').on(t.inboxId, t.externalId)],
);

export type Inbox = typeof inboxes.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
