import { customFieldDefinitions, type Database, dataExports, leadSources, leads, pipelineStages, users } from '@leadora/database';
import type { StorageProvider } from '@leadora/storage';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { readCustomFields } from '../custom-fields/values';
import { DomainError } from '../errors';
import { escapeCsvCell } from '../imports/csv';
import { type LeadFilterQuery, leadFilters } from '../leads/filters';

/** Spec §44: what can go into a lead export. Custom fields are added as `custom.<key>`. */
export const LEAD_EXPORT_FIELDS = {
  fullName: 'Name',
  email: 'Email',
  phone: 'Phone',
  companyName: 'Company',
  jobTitle: 'Job title',
  location: 'Location',
  country: 'Country',
  industry: 'Industry',
  budget: 'Budget',
  currency: 'Currency',
  priority: 'Priority',
  stage: 'Stage',
  source: 'Source',
  owner: 'Owner',
  score: 'Score',
  temperature: 'Temperature',
  tags: 'Tags',
  notes: 'Notes',
  createdAt: 'Created',
  lastContactedAt: 'Last contacted',
  nextFollowupAt: 'Next follow-up',
  convertedAt: 'Converted',
} as const;
export type LeadExportField = keyof typeof LEAD_EXPORT_FIELDS;

export const MAX_EXPORT_ROWS = 100_000;
const PAGE = 1000;

type Row = Record<string, string | number | null>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function* leadPages(db: Database, organizationId: string, viewerUserId: string, filters: LeadFilterQuery, customKeys: string[]) {
  let after: string | null = null;
  for (;;) {
    const rows: {
      id: string;
      lead: typeof leads.$inferSelect;
      stage: string;
      source: string;
      owner: string | null;
      tags: string | null;
    }[] = await db
      .select({
        id: leads.id,
        lead: leads,
        stage: pipelineStages.name,
        source: leadSources.name,
        owner: users.fullName,
        tags: sql<string | null>`(select string_agg(t.name::text, ', ' order by t.name) from lead_tag_links tl join lead_tags t on t.id = tl.tag_id where tl.lead_id = ${leads.id})`,
      })
      .from(leads)
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .innerJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .leftJoin(users, eq(users.id, leads.ownerUserId))
      .where(and(eq(leads.organizationId, organizationId), ...leadFilters(filters, viewerUserId), after ? gt(leads.id, after) : undefined))
      .orderBy(asc(leads.id))
      .limit(PAGE);
    if (rows.length === 0) return;
    const custom = customKeys.length ? await readCustomFields(db, organizationId, 'lead', rows.map((r) => r.id)) : new Map();
    yield rows.map((r) => {
      const l = r.lead;
      const values: Row = {
        fullName: l.fullName,
        email: l.email,
        phone: l.phone,
        companyName: l.companyName,
        jobTitle: l.jobTitle,
        location: l.location,
        country: l.country,
        industry: l.industry,
        budget: l.budget === null ? null : Number(l.budget),
        currency: l.currency,
        priority: l.priority,
        stage: r.stage,
        source: r.source,
        owner: r.owner,
        score: l.score,
        temperature: l.temperature,
        tags: r.tags,
        notes: l.notes,
        createdAt: iso(l.createdAt),
        lastContactedAt: iso(l.lastContactedAt),
        nextFollowupAt: iso(l.nextFollowupAt),
        convertedAt: iso(l.convertedAt),
      };
      const cf = (custom.get(r.id) ?? {}) as Record<string, unknown>;
      for (const key of customKeys) {
        const v = cf[key];
        values[`custom.${key}`] = v === null || v === undefined ? null : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : (v as string | number);
      }
      return values;
    });
    after = rows[rows.length - 1]!.id;
  }
}

/**
 * Builds the file for one export row and stores it. Visibility follows the requesting user's organization and
 * the filters they had on screen; permission to export was checked when the export was requested.
 */
export async function runLeadExport(db: Database, storage: StorageProvider, exportId: string) {
  const [job] = await db.update(dataExports).set({ status: 'RUNNING', error: null }).where(eq(dataExports.id, exportId)).returning();
  if (!job) return { status: 'SKIPPED' as const };
  try {
    const customKeys = job.fields.filter((f) => f.startsWith('custom.')).map((f) => f.slice(7));
    const columns = job.fields;
    const customLabels = new Map(
      (
        await db
          .select({ key: customFieldDefinitions.key, label: customFieldDefinitions.label })
          .from(customFieldDefinitions)
          .where(and(eq(customFieldDefinitions.organizationId, job.organizationId), eq(customFieldDefinitions.entity, 'lead')))
      ).map((d) => [d.key, d.label]),
    );
    const label = (f: string) => (f.startsWith('custom.') ? (customLabels.get(f.slice(7)) ?? f.slice(7)) : (LEAD_EXPORT_FIELDS[f as LeadExportField] ?? f));
    const rows: Row[] = [];
    for await (const page of leadPages(db, job.organizationId, job.userId, job.filters as LeadFilterQuery, customKeys)) {
      rows.push(...page);
      if (rows.length > MAX_EXPORT_ROWS) throw new DomainError('invalid', 'EXPORT_TOO_LARGE', `Exports are limited to ${MAX_EXPORT_ROWS.toLocaleString('en')} rows. Narrow the filters.`);
    }

    let body: Buffer;
    let contentType: string;
    if (job.format === 'CSV') {
      const lines = [columns.map((c) => escapeCsvCell(label(c))).join(',')];
      for (const r of rows) lines.push(columns.map((c) => escapeCsvCell(r[c] === null || r[c] === undefined ? '' : String(r[c]))).join(','));
      // BOM so Excel opens UTF-8 (Bangla names) correctly.
      body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8')]);
      contentType = 'text/csv';
    } else {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Leads');
      ws.columns = columns.map((c) => ({ header: label(c), key: c, width: Math.min(40, Math.max(12, label(c).length + 2)) }));
      ws.getRow(1).font = { bold: true };
      // Values are written as plain strings/numbers: XLSX cells are never evaluated as formulas this way.
      for (const r of rows) ws.addRow(columns.map((c) => r[c] ?? null));
      body = Buffer.from(await wb.xlsx.writeBuffer());
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    const fileName = `leads-${new Date().toISOString().slice(0, 10)}.${job.format === 'CSV' ? 'csv' : 'xlsx'}`;
    const storageKey = `orgs/${job.organizationId}/exports/${job.id}/${fileName}`;
    await storage.put(storageKey, body, contentType);
    await db
      .update(dataExports)
      .set({ status: 'SUCCEEDED', rowCount: rows.length, storageKey, fileName, completedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86_400_000) })
      .where(eq(dataExports.id, exportId));
    return { status: 'SUCCEEDED' as const, rows: rows.length };
  } catch (err) {
    const message = err instanceof DomainError ? err.message : 'The export failed. Please try again.';
    await db.update(dataExports).set({ status: 'FAILED', error: message, completedAt: new Date() }).where(eq(dataExports.id, exportId));
    if (!(err instanceof DomainError)) throw err;
    return { status: 'FAILED' as const, error: message };
  }
}

/** Retention: delete files of expired exports (the rows stay as a record of who exported what). */
export async function purgeExpiredExports(db: Database, storage: StorageProvider) {
  const expired = await db
    .select({ id: dataExports.id, key: dataExports.storageKey })
    .from(dataExports)
    .where(and(sql`${dataExports.expiresAt} < now()`, sql`${dataExports.storageKey} is not null`))
    .limit(500);
  for (const e of expired) {
    await storage.delete(e.key!).catch(() => undefined);
    await db.update(dataExports).set({ storageKey: null }).where(eq(dataExports.id, e.id));
  }
  return expired.length;
}
