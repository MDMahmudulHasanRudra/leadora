import { pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns';
import { organizations } from './organizations';
import { users } from './users';

export const teams = pgTable(
  'teams',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    ...timestamps,
  },
  (t) => [unique('teams_organization_id_name_unique').on(t.organizationId, t.name)],
);

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export type Team = typeof teams.$inferSelect;
