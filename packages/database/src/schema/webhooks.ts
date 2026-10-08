import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { domainEvents } from './automation';
import { id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

const ms = { withTimezone: true, precision: 3 } as const;

// Spec §93. Endpoints subscribe to outbox event types; the secret is encrypted at rest and shown once.
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    description: text(),
    events: text().array().notNull(),
    secretEnc: text().notNull(),
    enabled: boolean().notNull().default(true),
    // Consecutive failed deliveries; reset on success. The endpoint is disabled at the limit.
    failureCount: integer().notNull().default(0),
    disabledReason: text(),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp(ms).notNull().defaultNow(),
    updatedAt: timestamp(ms)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('webhook_endpoints_org_idx').on(t.organizationId)],
);

export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', ['PENDING', 'SUCCEEDED', 'FAILED']);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    endpointId: uuid()
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventId: uuid().references(() => domainEvents.id, { onDelete: 'set null' }),
    eventType: varchar({ length: 60 }).notNull(),
    // The exact body sent, so retries are byte-identical and X-Webhook-ID stays stable.
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: webhookDeliveryStatus().notNull().default('PENDING'),
    attempts: integer().notNull().default(0),
    lastStatusCode: integer(),
    lastError: text(),
    deliveredAt: timestamp(ms),
    createdAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [
    // One delivery per endpoint and event, however often the event is dispatched.
    uniqueIndex('webhook_deliveries_endpoint_event_unique').on(t.endpointId, t.eventId),
    index('webhook_deliveries_endpoint_idx').on(t.endpointId, t.createdAt.desc()),
  ],
);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
