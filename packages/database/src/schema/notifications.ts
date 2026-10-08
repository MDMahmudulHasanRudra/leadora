import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

const ms = { withTimezone: true, precision: 3 } as const;

// Spec §48. In-app first; email/push delivery can fan out from the same rows later.
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar({ length: 50 }).notNull(),
    title: text().notNull(),
    body: text(),
    // In-app path to open, e.g. /leads/<id>.
    link: text(),
    data: jsonb().$type<Record<string, unknown>>(),
    readAt: timestamp(ms),
    createdAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_created_idx').on(t.userId, t.createdAt.desc())],
);

export type Notification = typeof notifications.$inferSelect;
