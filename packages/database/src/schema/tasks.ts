import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { leadPriority, leads } from './leads';
import { organizations } from './organizations';
import { users } from './users';

export const taskStatus = pgEnum('task_status', ['OPEN', 'DONE']);

export interface ChecklistItem {
  text: string;
  done: boolean;
}

const ms = { withTimezone: true, precision: 3 } as const;

// Spec §19. Relations to contacts/companies/conversations are added with those modules.
export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text(),
    status: taskStatus().notNull().default('OPEN'),
    priority: leadPriority().notNull().default('MEDIUM'),
    dueAt: timestamp(ms),
    assignedUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    leadId: uuid().references(() => leads.id, { onDelete: 'cascade' }),
    checklist: jsonb().$type<ChecklistItem[]>().notNull().default([]),
    completedAt: timestamp(ms),
    createdAt: timestamp(ms).notNull().defaultNow(),
    updatedAt: timestamp(ms)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('tasks_org_assignee_status_idx').on(t.organizationId, t.assignedUserId, t.status, t.dueAt),
    index('tasks_lead_idx').on(t.leadId),
  ],
);

export type Task = typeof tasks.$inferSelect;
