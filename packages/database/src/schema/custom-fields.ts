import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns';
import { organizations } from './organizations';

// Spec §10.
export const customFieldType = pgEnum('custom_field_type', [
  'text',
  'long_text',
  'number',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'select',
  'multi_select',
  'url',
  'email',
  'phone',
]);
export const customFieldEntity = pgEnum('custom_field_entity', ['lead', 'contact', 'company']);

export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entity: customFieldEntity().notNull(),
    key: varchar({ length: 60 }).notNull(),
    label: text().notNull(),
    type: customFieldType().notNull(),
    options: jsonb().$type<string[]>(),
    required: boolean().notNull().default(false),
    position: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique('custom_field_definitions_org_entity_key_unique').on(t.organizationId, t.entity, t.key)],
);

// Typed columns keep values queryable and reportable (spec §8: no untyped JSON for business data).
export const customFieldValues = pgTable(
  'custom_field_values',
  {
    fieldId: uuid()
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: 'cascade' }),
    entityId: uuid().notNull(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    valueText: text(),
    valueNumber: numeric({ precision: 20, scale: 6 }),
    valueBoolean: boolean(),
    valueDate: date(),
    valueDatetime: timestamp({ withTimezone: true }),
    valueJson: jsonb().$type<string[]>(),
  },
  (t) => [primaryKey({ columns: [t.fieldId, t.entityId] }), index('custom_field_values_entity_idx').on(t.entityId)],
);

export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;
export type CustomFieldValueRow = typeof customFieldValues.$inferSelect;
