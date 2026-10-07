import { pgEnum, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { citext, id, timestamps } from './columns';
import { organizations } from './organizations';

export const userStatus = pgEnum('user_status', ['INVITED', 'ACTIVE', 'DISABLED']);

export const users = pgTable(
  'users',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    email: citext().notNull(),
    fullName: text().notNull(),
    passwordHash: text(),
    status: userStatus().notNull().default('INVITED'),
    locale: varchar({ length: 10 }),
    timezone: text(),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  // Leading organization_id column also serves tenant-scoped lookups.
  (t) => [unique('users_organization_id_email_unique').on(t.organizationId, t.email)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
