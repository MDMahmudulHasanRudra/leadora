import { index, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
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
    // Globally unique so login needs no organization picker (ADR-012).
    email: citext().notNull().unique(),
    fullName: text().notNull(),
    passwordHash: text(),
    status: userStatus().notNull().default('INVITED'),
    locale: varchar({ length: 10 }),
    timezone: text(),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('users_organization_id_idx').on(t.organizationId)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
