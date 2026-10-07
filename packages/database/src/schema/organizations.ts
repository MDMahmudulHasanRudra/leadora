import { pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns';

export const organizations = pgTable('organizations', {
  id: id(),
  name: text().notNull(),
  slug: varchar({ length: 63 }).notNull().unique(),
  timezone: text().notNull().default('UTC'),
  defaultCurrency: varchar({ length: 3 }).notNull().default('USD'),
  defaultLocale: varchar({ length: 10 }).notNull().default('en'),
  ...timestamps,
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
