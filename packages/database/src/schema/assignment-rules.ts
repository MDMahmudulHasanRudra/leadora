import { boolean, index, integer, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns';
import { organizations } from './organizations';
import { teams } from './teams';
import { users } from './users';

export const assignmentStrategy = pgEnum('assignment_strategy', ['USER', 'ROUND_ROBIN', 'LEAST_LOADED']);

/** All present keys must match (AND); each list matches any of its values (OR). */
export interface AssignmentConditions {
  sourceTypes?: string[];
  countries?: string[];
  tags?: string[];
  priorities?: string[];
}

// Spec §17: ordered, deterministic rules. The first enabled match wins.
export const assignmentRules = pgTable(
  'assignment_rules',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    position: integer().notNull().default(0),
    enabled: boolean().notNull().default(true),
    conditions: jsonb().$type<AssignmentConditions>().notNull().default({}),
    strategy: assignmentStrategy().notNull(),
    targetUserId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    targetTeamId: uuid().references(() => teams.id, { onDelete: 'cascade' }),
    // Round-robin cursor: the member who got the previous lead.
    lastAssignedUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('assignment_rules_org_position_idx').on(t.organizationId, t.position)],
);

export type AssignmentRule = typeof assignmentRules.$inferSelect;
