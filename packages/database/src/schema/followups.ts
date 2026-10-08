import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { leadPriority, leads } from './leads';
import { organizations } from './organizations';
import { users } from './users';

// Spec §18. OVERDUE is derived (PENDING and scheduled in the past), never stored.
export const followupType = pgEnum('followup_type', ['CALL', 'EMAIL', 'MESSAGE', 'MEETING', 'CUSTOM']);
export const followupStatus = pgEnum('followup_status', ['PENDING', 'COMPLETED', 'SKIPPED', 'CANCELLED']);

const ms = { withTimezone: true, precision: 3 } as const;

export const followups = pgTable(
  'followups',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    assignedUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    type: followupType().notNull(),
    status: followupStatus().notNull().default('PENDING'),
    priority: leadPriority().notNull().default('MEDIUM'),
    scheduledAt: timestamp(ms).notNull(),
    notes: text(),
    outcome: text(),
    completedAt: timestamp(ms),
    // Set when the due reminder has been sent, so the scheduler notifies once.
    remindedAt: timestamp(ms),
    createdAt: timestamp(ms).notNull().defaultNow(),
    updatedAt: timestamp(ms)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('followups_org_assignee_status_idx').on(t.organizationId, t.assignedUserId, t.status, t.scheduledAt),
    index('followups_lead_idx').on(t.leadId, t.status, t.scheduledAt),
  ],
);

export type Followup = typeof followups.$inferSelect;
