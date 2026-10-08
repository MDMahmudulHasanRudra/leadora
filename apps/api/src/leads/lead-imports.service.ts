import path from 'node:path';
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { type DbHandle, leadImports } from '@leadora/database';
import { type ImportMapping, inspectCsv, resolveOwner, suggestMapping, toCsv } from '@leadora/domain';
import type { Queue } from 'bullmq';
import { and, desc, eq } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { DB, IMPORTS_QUEUE } from '../infra/tokens';

const notFound = () => new NotFoundException({ code: 'IMPORT_NOT_FOUND', message: 'Import not found' });

@Injectable()
export class LeadImportsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(IMPORTS_QUEUE) private readonly queue: Queue,
  ) {}

  async upload(auth: AuthContext, file: { originalname: string; buffer: Buffer } | undefined) {
    if (!file?.buffer.length) {
      throw new UnprocessableEntityException({ code: 'EMPTY_FILE', message: 'The file has no rows' });
    }
    const content = file.buffer.toString('utf8');
    const { headers, rowCount, sample } = inspectCsv(content);
    const fileName = path.basename(file.originalname || 'import.csv').slice(0, 200);

    const [row] = await this.handle.db
      .insert(leadImports)
      .values({ organizationId: auth.organizationId, createdByUserId: auth.userId, fileName, content, headers, rowCount })
      .returning({ id: leadImports.id, status: leadImports.status });
    return { id: row!.id, fileName, status: row!.status, headers, rowCount, sample, suggestedMapping: suggestMapping(headers) };
  }

  async start(auth: AuthContext, id: string, mapping: ImportMapping, ownerUserId: string | null | undefined) {
    return this.handle.db.transaction(async (tx) => {
      const [imp] = await tx
        .select({ id: leadImports.id, status: leadImports.status, headers: leadImports.headers })
        .from(leadImports)
        .where(and(eq(leadImports.id, id), eq(leadImports.organizationId, auth.organizationId)))
        .for('update');
      if (!imp) throw notFound();
      if (imp.status !== 'UPLOADED') {
        throw new ConflictException({ code: 'IMPORT_ALREADY_STARTED', message: 'This import has already been started' });
      }
      const unknown = Object.values(mapping).filter((h) => !imp.headers.includes(h));
      if (unknown.length) {
        throw new UnprocessableEntityException({ code: 'UNKNOWN_COLUMN', message: `Unknown column: ${unknown.join(', ')}` });
      }
      const owner = ownerUserId === undefined ? null : await resolveOwner(tx, auth.organizationId, ownerUserId);

      await tx.update(leadImports).set({ status: 'QUEUED', mapping, ownerUserId: owner }).where(eq(leadImports.id, id));
      // Enqueue before commit: if the commit then fails, the worker finds the import still UPLOADED and skips it.
      await this.queue.add(
        'lead.import',
        { importId: id },
        { jobId: id, attempts: 4, backoff: { type: 'custom' }, removeOnComplete: 1000, removeOnFail: 5000 },
      );
      return { id, status: 'QUEUED' as const };
    });
  }

  private summaryColumns = {
    id: leadImports.id,
    fileName: leadImports.fileName,
    status: leadImports.status,
    rowCount: leadImports.rowCount,
    processedRows: leadImports.processedRows,
    imported: leadImports.importedCount,
    duplicates: leadImports.duplicateCount,
    invalid: leadImports.invalidCount,
    failed: leadImports.failedCount,
    errorMessage: leadImports.errorMessage,
    createdAt: leadImports.createdAt,
    startedAt: leadImports.startedAt,
    finishedAt: leadImports.finishedAt,
  };

  list(auth: AuthContext) {
    return this.handle.db
      .select(this.summaryColumns)
      .from(leadImports)
      .where(eq(leadImports.organizationId, auth.organizationId))
      .orderBy(desc(leadImports.createdAt))
      .limit(50);
  }

  private async load(auth: AuthContext, id: string) {
    const [imp] = await this.handle.db
      .select({ ...this.summaryColumns, headers: leadImports.headers, mapping: leadImports.mapping, errors: leadImports.errors })
      .from(leadImports)
      .where(and(eq(leadImports.id, id), eq(leadImports.organizationId, auth.organizationId)));
    if (!imp) throw notFound();
    return imp;
  }

  async get(auth: AuthContext, id: string) {
    const imp = await this.load(auth, id);
    return { ...imp, errors: imp.errors.slice(0, 100).map(({ values: _v, ...e }) => e) };
  }

  async errorReport(auth: AuthContext, id: string) {
    const imp = await this.load(auth, id);
    return {
      fileName: `${path.parse(imp.fileName).name}-errors.csv`,
      csv: toCsv([
        ['Row', 'Code', 'Field', 'Message', ...imp.headers],
        ...imp.errors.map((e) => [String(e.row), e.code, e.field ?? '', e.message, ...(e.values ?? [])]),
      ]),
    };
  }
}
