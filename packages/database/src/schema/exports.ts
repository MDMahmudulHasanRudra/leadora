import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

const ms = { withTimezone: true, precision: 3 } as const;

export const exportStatus = pgEnum('export_status', ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']);
export const exportFormat = pgEnum('export_format', ['CSV', 'XLSX']);

// Spec §44: exports run as background jobs and respect organization, permissions, fields and filters.
export const dataExports = pgTable(
  'data_exports',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entity: varchar({ length: 30 }).notNull(),
    format: exportFormat().notNull(),
    fields: text().array().notNull(),
    filters: jsonb().$type<Record<string, unknown>>().notNull(),
    status: exportStatus().notNull().default('QUEUED'),
    rowCount: integer(),
    storageKey: text(),
    fileName: text(),
    error: text(),
    createdAt: timestamp(ms).notNull().defaultNow(),
    completedAt: timestamp(ms),
    // Files are deleted after this; the row stays as an audit record.
    expiresAt: timestamp(ms),
  },
  (t) => [index('data_exports_user_idx').on(t.organizationId, t.userId, t.createdAt.desc())],
);

export type DataExport = typeof dataExports.$inferSelect;
