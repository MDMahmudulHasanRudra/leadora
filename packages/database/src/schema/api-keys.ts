import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

const ms = { withTimezone: true, precision: 3 } as const;

/**
 * Spec §92. A key is `lk_<keyId>_<secret>`; only the SHA-256 of the secret is stored, so a database leak
 * does not leak working keys. Requests act as the creating user, limited to the key's scopes.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    keyId: varchar({ length: 32 }).notNull(),
    secretHash: varchar({ length: 64 }).notNull(),
    scopes: text().array().notNull(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastUsedAt: timestamp(ms),
    expiresAt: timestamp(ms),
    revokedAt: timestamp(ms),
    createdAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('api_keys_key_id_unique').on(t.keyId), index('api_keys_org_idx').on(t.organizationId, t.createdAt.desc())],
);

export type ApiKey = typeof apiKeys.$inferSelect;
