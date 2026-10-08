import { boolean, jsonb, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns';
import { organizations } from './organizations';

// Spec §11.
export const leadSourceType = pgEnum('lead_source_type', [
  'MANUAL',
  'CSV',
  'WEBSITE',
  'LANDING_PAGE',
  'API',
  'WEBHOOK',
  'FACEBOOK',
  'INSTAGRAM',
  'WHATSAPP',
  'EMAIL',
  'REFERRAL',
  'OTHER',
]);

export const leadSources = pgTable(
  'lead_sources',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: leadSourceType().notNull(),
    name: text().notNull(),
    enabled: boolean().notNull().default(true),
    config: jsonb(),
    ...timestamps,
  },
  (t) => [unique('lead_sources_organization_id_name_unique').on(t.organizationId, t.name)],
);

export type LeadSource = typeof leadSources.$inferSelect;
