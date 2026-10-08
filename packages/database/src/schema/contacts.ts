import { index, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { citext, id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

const ms = { withTimezone: true, precision: 3 } as const;
const stamps = {
  createdAt: timestamp(ms).notNull().defaultNow(),
  updatedAt: timestamp(ms)
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Spec §9. "Company" is a customer's business; not to be confused with "Organization" (the tenant).
export const companies = pgTable(
  'companies',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    // lower(trim(collapsed whitespace)) — conversion reuses companies by this key.
    normalizedName: text().notNull(),
    domain: varchar({ length: 255 }),
    industry: text(),
    phone: varchar({ length: 20 }),
    address: text(),
    ...stamps,
  },
  (t) => [unique('companies_org_normalized_name_unique').on(t.organizationId, t.normalizedName)],
);

export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    companyId: uuid().references(() => companies.id, { onDelete: 'set null' }),
    ownerUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    fullName: text().notNull(),
    email: citext(),
    phone: varchar({ length: 20 }),
    jobTitle: text(),
    location: text(),
    ...stamps,
  },
  (t) => [
    index('contacts_org_email_idx').on(t.organizationId, t.email),
    index('contacts_org_phone_idx').on(t.organizationId, t.phone),
    index('contacts_company_idx').on(t.companyId),
  ],
);

export type Company = typeof companies.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
