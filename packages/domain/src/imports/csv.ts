import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { DomainError } from '../errors';

export const IMPORT_LIMITS = { maxBytes: 5 * 1024 * 1024, maxRows: 20_000, maxColumns: 100 } as const;

export const IMPORTABLE_FIELDS = [
  'fullName',
  'email',
  'phone',
  'companyName',
  'jobTitle',
  'location',
  'industry',
  'notes',
  'tags',
  'priority',
] as const;
export type ImportableField = (typeof IMPORTABLE_FIELDS)[number];

export const importMappingSchema = z
  .partialRecord(z.enum(IMPORTABLE_FIELDS), z.string().min(1).max(200))
  .refine((m) => m.fullName, { message: 'Map a column to the lead name', path: ['fullName'] })
  .refine((m) => m.email || m.phone, { message: 'Map a column to email or phone', path: ['email'] });
export type ImportMapping = z.infer<typeof importMappingSchema>;

const invalidCsv = (message: string) => new DomainError('invalid', 'INVALID_CSV', message);

/** Strict parse: unbalanced quotes or binary content are rejected rather than guessed at. */
export function parseCsv(content: string): string[][] {
  if (content.includes('\u0000')) throw invalidCsv('The file is not a text CSV');
  try {
    return parse(content, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) as string[][];
  } catch (err) {
    throw invalidCsv(`Could not read the CSV: ${(err as Error).message}`);
  }
}

export function inspectCsv(content: string) {
  const records = parseCsv(content);
  if (!records.length) throw new DomainError('invalid', 'EMPTY_FILE', 'The file has no rows');
  const headers = records[0]!.map((h) => h.trim());
  if (headers.length > IMPORT_LIMITS.maxColumns) {
    throw new DomainError('invalid', 'TOO_MANY_COLUMNS', `At most ${IMPORT_LIMITS.maxColumns} columns are supported`);
  }
  if (headers.some((h) => !h)) throw invalidCsv('Every column needs a header');
  if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length) throw invalidCsv('Column headers must be unique');
  const rowCount = records.length - 1;
  if (rowCount > IMPORT_LIMITS.maxRows) {
    throw new DomainError('invalid', 'TOO_MANY_ROWS', `At most ${IMPORT_LIMITS.maxRows.toLocaleString('en')} rows per file`);
  }
  return { headers, rowCount, sample: records.slice(1, 6) };
}

const ALIASES: Record<ImportableField, string[]> = {
  fullName: ['name', 'full name', 'fullname', 'contact name', 'lead name', 'customer name'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  phone: ['phone', 'mobile', 'phone number', 'mobile number', 'cell', 'contact number', 'whatsapp'],
  companyName: ['company', 'company name', 'organization', 'organisation', 'business'],
  jobTitle: ['title', 'job title', 'designation', 'position', 'role'],
  location: ['location', 'city', 'address', 'area'],
  industry: ['industry', 'sector'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks'],
  tags: ['tags', 'tag', 'labels', 'label'],
  priority: ['priority'],
};

export function suggestMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  for (const field of IMPORTABLE_FIELDS) {
    const header = headers.find((h) => ALIASES[field].includes(h.trim().toLowerCase()));
    if (header) mapping[field] = header;
  }
  return mapping;
}

/** A spreadsheet must never execute a cell from untrusted data (CSV/formula injection). */
export function escapeCsvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}
