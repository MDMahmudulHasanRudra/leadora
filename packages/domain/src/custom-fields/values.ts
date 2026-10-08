import {
  type CustomFieldDefinition,
  customFieldDefinitions,
  type CustomFieldValueRow,
  customFieldValues,
  type Database,
  type Transaction,
} from '@leadora/database';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { DomainError } from '../errors';

export type CustomFieldEntity = CustomFieldDefinition['entity'];
export type CustomFieldValue = string | number | boolean | string[];
type Db = Database | Transaction;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Invalid date');

function valueSchema(def: Pick<CustomFieldDefinition, 'type' | 'options'>): z.ZodType<CustomFieldValue> {
  const options = def.options ?? [];
  switch (def.type) {
    case 'text':
      return z.string().trim().min(1).max(500);
    case 'long_text':
      return z.string().trim().min(1).max(5000);
    case 'number':
      return z.number().int().min(-1e15).max(1e15);
    case 'decimal':
      return z.number().finite().min(-1e13).max(1e13);
    case 'boolean':
      return z.boolean();
    case 'date':
      return isoDate;
    case 'datetime':
      return z.iso.datetime({ offset: true });
    case 'select':
      return z.string().refine((v) => options.includes(v), 'Not one of the allowed options');
    case 'multi_select':
      return z
        .array(z.string())
        .max(50)
        .refine((vs) => vs.every((v) => options.includes(v)), 'Contains a value that is not an allowed option')
        .transform((vs) => [...new Set(vs)]);
    case 'url':
      return z.url({ protocol: /^https?$/ }).max(2000);
    case 'email':
      return z.string().trim().toLowerCase().pipe(z.email());
    case 'phone':
      return z.string().trim().min(3).max(40);
  }
}

export function loadCustomFieldDefinitions(db: Db, organizationId: string, entity: CustomFieldEntity) {
  return db
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.organizationId, organizationId),
        eq(customFieldDefinitions.entity, entity),
        isNull(customFieldDefinitions.archivedAt),
      ),
    )
    .orderBy(asc(customFieldDefinitions.position), asc(customFieldDefinitions.createdAt));
}

/**
 * Validates `{ key: value }` against active definitions. `null` (or '') clears a value.
 * On create, required fields must be present; on update, they may be omitted but not cleared.
 */
export function validateCustomFields(
  defs: CustomFieldDefinition[],
  input: Record<string, unknown>,
  mode: 'create' | 'update',
): Map<CustomFieldDefinition, CustomFieldValue | null> {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const unknown = Object.keys(input).filter((k) => !byKey.has(k));
  if (unknown.length) {
    throw new DomainError('invalid', 'UNKNOWN_CUSTOM_FIELD', `Unknown custom field: ${unknown.join(', ')}`, [
      { path: `customFields.${unknown[0]}`, message: 'Unknown custom field' },
    ]);
  }

  const result = new Map<CustomFieldDefinition, CustomFieldValue | null>();
  const fail = (key: string, message: string) => {
    throw new DomainError('invalid', 'VALIDATION_FAILED', 'Validation failed', [{ path: `customFields.${key}`, message }]);
  };

  for (const def of defs) {
    const present = Object.hasOwn(input, def.key);
    const raw = input[def.key];
    const empty = raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
    if (!present) {
      if (mode === 'create' && def.required) fail(def.key, `${def.label} is required`);
      continue;
    }
    if (empty) {
      if (def.required) fail(def.key, `${def.label} is required`);
      result.set(def, null);
      continue;
    }
    const parsed = valueSchema(def).safeParse(raw);
    if (!parsed.success) fail(def.key, parsed.error.issues[0]?.message ?? 'Invalid value');
    result.set(def, parsed.data!);
  }
  return result;
}

function toColumns(type: CustomFieldDefinition['type'], value: CustomFieldValue) {
  switch (type) {
    case 'number':
    case 'decimal':
      return { valueNumber: String(value) };
    case 'boolean':
      return { valueBoolean: value as boolean };
    case 'date':
      return { valueDate: value as string };
    case 'datetime':
      return { valueDatetime: new Date(value as string) };
    case 'multi_select':
      return { valueJson: value as string[] };
    default:
      return { valueText: value as string };
  }
}

function fromColumns(type: CustomFieldDefinition['type'], row: CustomFieldValueRow): CustomFieldValue | null {
  switch (type) {
    case 'number':
    case 'decimal':
      return row.valueNumber === null ? null : Number(row.valueNumber);
    case 'boolean':
      return row.valueBoolean;
    case 'date':
      return row.valueDate;
    case 'datetime':
      return row.valueDatetime?.toISOString() ?? null;
    case 'multi_select':
      return row.valueJson;
    default:
      return row.valueText;
  }
}

export async function writeCustomFields(
  tx: Transaction,
  organizationId: string,
  entityId: string,
  values: Map<CustomFieldDefinition, CustomFieldValue | null>,
) {
  for (const [def, value] of values) {
    if (value === null) {
      await tx.delete(customFieldValues).where(and(eq(customFieldValues.fieldId, def.id), eq(customFieldValues.entityId, entityId)));
      continue;
    }
    const empty = { valueText: null, valueNumber: null, valueBoolean: null, valueDate: null, valueDatetime: null, valueJson: null };
    const columns = { ...empty, ...toColumns(def.type, value) };
    await tx
      .insert(customFieldValues)
      .values({ fieldId: def.id, entityId, organizationId, ...columns })
      .onConflictDoUpdate({ target: [customFieldValues.fieldId, customFieldValues.entityId], set: columns });
  }
}

/** `{ entityId: { key: value } }` for active definitions only. */
export async function readCustomFields(
  db: Db,
  organizationId: string,
  entity: CustomFieldEntity,
  entityIds: string[],
): Promise<Map<string, Record<string, CustomFieldValue>>> {
  const out = new Map<string, Record<string, CustomFieldValue>>(entityIds.map((id) => [id, {}]));
  if (!entityIds.length) return out;
  const defs = await loadCustomFieldDefinitions(db, organizationId, entity);
  if (!defs.length) return out;
  const byId = new Map(defs.map((d) => [d.id, d]));
  const rows = await db
    .select()
    .from(customFieldValues)
    .where(
      and(
        eq(customFieldValues.organizationId, organizationId),
        inArray(customFieldValues.entityId, entityIds),
        inArray(customFieldValues.fieldId, [...byId.keys()]),
      ),
    );
  for (const def of defs) {
    for (const row of rows) {
      if (row.fieldId !== def.id) continue;
      const value = fromColumns(def.type, row);
      if (value !== null) out.get(row.entityId)![def.key] = value;
    }
  }
  return out;
}
