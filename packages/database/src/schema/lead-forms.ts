import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

const ms = { withTimezone: true, precision: 3 } as const;

export const captchaProvider = pgEnum('captcha_provider', ['NONE', 'TURNSTILE', 'HCAPTCHA']);

export interface LeadFormFields {
  email: 'required' | 'optional' | 'hidden';
  phone: 'required' | 'optional' | 'hidden';
  companyName: 'optional' | 'hidden';
  message: 'optional' | 'hidden';
}

// Spec §91: an embeddable public form. The public key identifies it; origins, honeypot, rate limits and an
// optional CAPTCHA guard it.
export const leadForms = pgTable(
  'lead_forms',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    publicKey: varchar({ length: 40 }).notNull(),
    title: text(),
    successMessage: text().notNull(),
    fields: jsonb().$type<LeadFormFields>().notNull(),
    // Exact origins (scheme://host[:port]) allowed to submit; empty = any origin.
    allowedOrigins: text().array().notNull(),
    captchaProvider: captchaProvider().notNull().default('NONE'),
    captchaSiteKey: text(),
    captchaSecretEnc: text(),
    tags: text().array().notNull(),
    enabled: boolean().notNull().default(true),
    submissionCount: integer().notNull().default(0),
    lastSubmissionAt: timestamp(ms),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp(ms).notNull().defaultNow(),
    updatedAt: timestamp(ms)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('lead_forms_public_key_unique').on(t.publicKey), index('lead_forms_org_idx').on(t.organizationId)],
);

export type LeadForm = typeof leadForms.$inferSelect;
