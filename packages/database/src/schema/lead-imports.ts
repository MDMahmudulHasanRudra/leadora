import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

export const leadImportStatus = pgEnum('lead_import_status', ['UPLOADED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);

export interface LeadImportRowError {
  row: number;
  code: string;
  message: string;
  field?: string;
  existingLeadId?: string;
  values?: string[];
}

const ms = { withTimezone: true, precision: 3 } as const;

export const leadImports = pgTable(
  'lead_imports',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    status: leadImportStatus().notNull().default('UPLOADED'),
    fileName: text().notNull(),
    // Raw CSV (≤ 5 MB). Moves to object storage once the storage provider exists.
    content: text().notNull(),
    headers: jsonb().$type<string[]>().notNull(),
    rowCount: integer().notNull(),
    mapping: jsonb().$type<Record<string, string>>(),
    ownerUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    autoAssign: boolean().notNull().default(false),
    // Checkpoint: rows fully handled. Each row and this counter commit together.
    processedRows: integer().notNull().default(0),
    importedCount: integer().notNull().default(0),
    duplicateCount: integer().notNull().default(0),
    invalidCount: integer().notNull().default(0),
    failedCount: integer().notNull().default(0),
    errors: jsonb().$type<LeadImportRowError[]>().notNull().default([]),
    errorMessage: text(),
    createdAt: timestamp(ms).notNull().defaultNow(),
    startedAt: timestamp(ms),
    finishedAt: timestamp(ms),
  },
  (t) => [index('lead_imports_org_created_idx').on(t.organizationId, t.createdAt.desc())],
);

export type LeadImport = typeof leadImports.$inferSelect;
