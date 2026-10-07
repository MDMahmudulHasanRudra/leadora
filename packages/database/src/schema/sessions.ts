import { char, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    // SHA-256 of the cookie token; the token itself is never stored.
    tokenHash: char({ length: 64 }).notNull().unique('sessions_token_hash_unique'),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    ip: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export type Session = typeof sessions.$inferSelect;
