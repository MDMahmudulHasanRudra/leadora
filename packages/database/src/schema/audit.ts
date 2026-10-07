import { sql } from 'drizzle-orm';
import { bigint, index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

// Append-only (spec §49). Never store secrets or password hashes in old/new values.
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    // Insertion order for display and keyset pagination; timestamps can tie or lose precision in JS.
    seq: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
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
    createdAt: timestamp({ withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [index('audit_logs_organization_id_seq_idx').on(t.organizationId, t.seq.desc())],
);

export type AuditLog = typeof auditLogs.$inferSelect;
