import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

// Append-only (spec §49). Never store secrets or password hashes in old/new values.
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: varchar({ length: 100 }).notNull(),
    resourceType: varchar({ length: 50 }).notNull(),
    resourceId: uuid(),
    oldValues: jsonb(),
    newValues: jsonb(),
    ip: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_organization_id_created_at_idx').on(t.organizationId, t.createdAt)],
);

export type AuditLog = typeof auditLogs.$inferSelect;
