import { type Database, type LeadImportRowError, leadImports, type Transaction } from '@leadora/database';
import { and, eq, sql } from 'drizzle-orm';
import { DomainError } from '../errors';
import { notify } from '../notifications';
import { ingestLead } from '../leads/ingestion';
import { createLeadSchema, PRIORITIES } from '../leads/schemas';
import { type ImportMapping, parseCsv } from './csv';

const MAX_STORED_ERRORS = 500;

type Outcome =
  | { kind: 'imported' }
  | { kind: 'duplicate'; error: LeadImportRowError }
  | { kind: 'invalid'; error: LeadImportRowError }
  | { kind: 'failed'; error: LeadImportRowError };

/** Another worker already handled this row; stop instead of double-counting. */
class CheckpointMoved extends Error {}

function rowToInput(values: string[], headers: string[], mapping: ImportMapping) {
  const input: Record<string, unknown> = {};
  for (const [field, header] of Object.entries(mapping)) {
    const value = values[headers.indexOf(header)]?.trim() ?? '';
    if (!value) continue;
    if (field === 'tags') input.tags = value.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
    else if (field === 'priority') input.priority = (PRIORITIES as readonly string[]).includes(value.toUpperCase()) ? value.toUpperCase() : value;
    else input[field] = value;
  }
  if (input.fullName === undefined) input.fullName = '';
  return input;
}

/**
 * Advances processed_rows from `index` to `index + 1` and applies the outcome. The `processed_rows = index`
 * guard makes each row count exactly once even if a retried job overlaps a slow one.
 */
async function checkpoint(db: Database | Transaction, importId: string, index: number, outcome: Outcome) {
  const error = outcome.kind === 'imported' ? null : outcome.error;
  const updated = await db
    .update(leadImports)
    .set({
      processedRows: index + 1,
      importedCount: sql`${leadImports.importedCount} + ${outcome.kind === 'imported' ? 1 : 0}`,
      duplicateCount: sql`${leadImports.duplicateCount} + ${outcome.kind === 'duplicate' ? 1 : 0}`,
      invalidCount: sql`${leadImports.invalidCount} + ${outcome.kind === 'invalid' ? 1 : 0}`,
      failedCount: sql`${leadImports.failedCount} + ${outcome.kind === 'failed' ? 1 : 0}`,
      errors: error
        ? sql`case when jsonb_array_length(${leadImports.errors}) < ${MAX_STORED_ERRORS}
                then ${leadImports.errors} || ${JSON.stringify([error])}::jsonb else ${leadImports.errors} end`
        : undefined,
    })
    .where(and(eq(leadImports.id, importId), eq(leadImports.processedRows, index)))
    .returning({ id: leadImports.id });
  if (!updated.length) throw new CheckpointMoved();
}

function fieldOf(details: unknown): string | undefined {
  return Array.isArray(details) ? (details[0] as { path?: string })?.path : undefined;
}

/**
 * Imports a queued CSV row by row through ingestLead. Safe to call repeatedly: it resumes from the
 * checkpoint, and each row commits together with its checkpoint.
 */
export async function processLeadImport(db: Database, importId: string): Promise<void> {
  const [imp] = await db.select().from(leadImports).where(eq(leadImports.id, importId));
  if (!imp || imp.status === 'UPLOADED' || imp.status === 'COMPLETED' || !imp.mapping) return;
  if (imp.status !== 'PROCESSING') {
    await db.update(leadImports).set({ status: 'PROCESSING', startedAt: new Date() }).where(eq(leadImports.id, importId));
  }

  const [, ...rows] = parseCsv(imp.content);
  const ctx = { organizationId: imp.organizationId, actorUserId: imp.createdByUserId, sourceType: 'CSV' as const, autoAssign: imp.autoAssign };

  try {
    for (let i = imp.processedRows; i < rows.length; i++) {
      const values = rows[i]!;
      const base = { row: i + 2, values: values.map((v) => v.slice(0, 200)) };
      const parsed = createLeadSchema.safeParse(rowToInput(values, imp.headers, imp.mapping));

      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        await checkpoint(db, importId, i, {
          kind: 'invalid',
          error: { ...base, code: 'VALIDATION_FAILED', field: String(issue.path[0] ?? ''), message: issue.message },
        });
        continue;
      }

      const input = imp.ownerUserId ? { ...parsed.data, ownerUserId: imp.ownerUserId } : parsed.data;
      try {
        await db.transaction(async (tx) => {
          const result = await ingestLead(tx, ctx, input);
          await checkpoint(
            tx,
            importId,
            i,
            result.status === 'CREATED'
              ? { kind: 'imported' }
              : {
                  kind: 'duplicate',
                  error: { ...base, code: 'LEAD_DUPLICATE', message: `Matches an existing lead by ${result.matchedOn}`, existingLeadId: result.existingLeadId },
                },
          );
        });
      } catch (err) {
        if (err instanceof CheckpointMoved) throw err;
        const outcome: Outcome =
          err instanceof DomainError && err.kind === 'invalid'
            ? { kind: 'invalid', error: { ...base, code: err.code, field: fieldOf(err.details), message: err.message } }
            : { kind: 'failed', error: { ...base, code: 'ROW_FAILED', message: 'Unexpected error while importing this row' } };
        await checkpoint(db, importId, i, outcome);
      }
    }
  } catch (err) {
    if (err instanceof CheckpointMoved) return;
    throw err;
  }

  const finished = await db
    .update(leadImports)
    .set({ status: 'COMPLETED', finishedAt: new Date() })
    .where(and(eq(leadImports.id, importId), eq(leadImports.status, 'PROCESSING')))
    .returning({ imported: leadImports.importedCount, rows: leadImports.rowCount });
  if (finished.length && imp.createdByUserId) {
    await notify(db, {
      organizationId: imp.organizationId,
      userId: imp.createdByUserId,
      type: 'import_completed',
      title: `Import finished: ${imp.fileName}`,
      body: `Imported ${finished[0]!.imported} of ${finished[0]!.rows} rows`,
      link: `/leads/import?id=${importId}`,
      data: { importId },
    });
  }
}

export async function markLeadImportFailed(db: Database, importId: string, message: string): Promise<void> {
  await db
    .update(leadImports)
    .set({ status: 'FAILED', errorMessage: message.slice(0, 500), finishedAt: new Date() })
    .where(eq(leadImports.id, importId));
}
