import { integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

/** Spec §14–15. Only overrides are stored; code defaults fill the rest, so new rules reach existing orgs. */
export const scoringSettings = pgTable('scoring_settings', {
  organizationId: uuid()
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  rules: jsonb().$type<Record<string, { enabled: boolean; points: number }>>().notNull().default({}),
  ruleWeight: integer(),
  aiWeight: integer(),
  hotThreshold: integer(),
  warmThreshold: integer(),
  updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
