import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { customFieldDefinitions, dataExports, type DbHandle } from '@leadora/database';
import { LEAD_EXPORT_FIELDS } from '@leadora/domain';
import type { StorageProvider } from '@leadora/storage';
import type { Queue } from 'bullmq';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import type { RequestMeta } from '../common/request-meta';
import { DB, EXPORTS_QUEUE, STORAGE } from '../infra/tokens';
import { listLeadsSchema } from '../leads/leads.schemas';

export const exportRequestSchema = z.object({
  entity: z.literal('leads'),
  format: z.enum(['CSV', 'XLSX']),
  fields: z.array(z.string().max(80)).min(1).max(80),
  // The same filters as the lead list (paging excluded).
  filters: listLeadsSchema.omit({ limit: true, cursor: true }).partial().default({}),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

const notFound = () => new NotFoundException({ code: 'EXPORT_NOT_FOUND', message: 'Export not found' });
const view = (e: typeof dataExports.$inferSelect) => {
  const { storageKey, organizationId: _o, ...rest } = e;
  return { ...rest, downloadable: e.status === 'SUCCEEDED' && !!storageKey };
};

@Injectable()
export class ExportsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(STORAGE) private readonly storage: StorageProvider,
    @Inject(EXPORTS_QUEUE) private readonly queue: Queue,
    private readonly audit: AuditService,
  ) {}

  async fields(auth: AuthContext) {
    const custom = await this.handle.db
      .select({ key: customFieldDefinitions.key, label: customFieldDefinitions.label })
      .from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.organizationId, auth.organizationId), eq(customFieldDefinitions.entity, 'lead')));
    return {
      items: [...Object.entries(LEAD_EXPORT_FIELDS).map(([key, label]) => ({ key, label })), ...custom.map((c) => ({ key: `custom.${c.key}`, label: c.label }))],
    };
  }

  async request(auth: AuthContext, input: ExportRequest, meta: RequestMeta) {
    const allowed = new Set((await this.fields(auth)).items.map((f) => f.key));
    const unknown = input.fields.filter((f) => !allowed.has(f));
    if (unknown.length) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: 'Unknown export fields', details: [{ path: 'fields', message: `Unknown: ${unknown.join(', ')}` }] });
    }
    const job = await this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(dataExports)
        .values({ organizationId: auth.organizationId, userId: auth.userId, entity: input.entity, format: input.format, fields: [...new Set(input.fields)], filters: input.filters })
        .returning();
      // Spec §49: exporting customer data is an auditable event.
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'lead.exported',
        resourceType: 'data_export',
        resourceId: row!.id,
        newValues: { format: input.format, fields: input.fields, filters: input.filters },
        meta,
      });
      return row!;
    });
    await this.queue.add('lead.export', { exportId: job.id }, { jobId: `export-${job.id}`, attempts: 2, backoff: { type: 'custom' }, removeOnComplete: true });
    return view(job);
  }

  /** People see their own exports: an export can contain data others shouldn't download. */
  async list(auth: AuthContext) {
    const rows = await this.handle.db
      .select()
      .from(dataExports)
      .where(and(eq(dataExports.organizationId, auth.organizationId), eq(dataExports.userId, auth.userId)))
      .orderBy(desc(dataExports.createdAt))
      .limit(20);
    return { items: rows.map(view) };
  }

  private async own(auth: AuthContext, id: string) {
    const [row] = await this.handle.db
      .select()
      .from(dataExports)
      .where(and(eq(dataExports.id, id), eq(dataExports.organizationId, auth.organizationId), eq(dataExports.userId, auth.userId)));
    if (!row) throw notFound();
    return row;
  }

  async get(auth: AuthContext, id: string) {
    return view(await this.own(auth, id));
  }

  async download(auth: AuthContext, id: string) {
    const row = await this.own(auth, id);
    if (row.status !== 'SUCCEEDED' || !row.storageKey) throw new ConflictException({ code: 'EXPORT_NOT_READY', message: 'This export is not ready (or has expired)' });
    return {
      body: await this.storage.get(row.storageKey),
      fileName: row.fileName ?? 'export',
      contentType: row.format === 'CSV' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}
