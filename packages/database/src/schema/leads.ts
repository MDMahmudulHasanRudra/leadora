import {
  bigint,
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
import { citext, id } from './columns';
import { companies, contacts } from './contacts';
import { leadSources } from './lead-sources';
import { organizations } from './organizations';
import { pipelineStages, pipelines } from './pipelines';
import { users } from './users';

export const leadPriority = pgEnum('lead_priority', ['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const leadTemperature = pgEnum('lead_temperature', ['COLD', 'WARM', 'HOT']);

export interface ScoreBreakdown {
  rules: { key: string; points: number }[];
  ruleScore: number;
  aiScore: number | null;
  ruleWeight: number;
  aiWeight: number;
}

// Millisecond precision so (created_at, id) keyset cursors round-trip exactly through JS Dates.
const ms = { withTimezone: true, precision: 3 } as const;

export const leads = pgTable(
  'leads',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    fullName: text().notNull(),
    email: citext(),
    // E.164
    phone: varchar({ length: 20 }),
    companyName: text(),
    jobTitle: text(),
    sourceId: uuid()
      .notNull()
      .references(() => leadSources.id, { onDelete: 'restrict' }),
    pipelineId: uuid()
      .notNull()
      .references(() => pipelines.id, { onDelete: 'restrict' }),
    stageId: uuid()
      .notNull()
      .references(() => pipelineStages.id, { onDelete: 'restrict' }),
    ownerUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    // Spec §14: score = weighted blend of ruleScore and aiScore; breakdown explains it.
    score: integer(),
    temperature: leadTemperature(),
    ruleScore: integer(),
    aiScore: integer(),
    scoreBreakdown: jsonb().$type<ScoreBreakdown>(),
    scoredAt: timestamp(ms),
    priority: leadPriority().notNull().default('MEDIUM'),
    location: text(),
    country: varchar({ length: 2 }),
    industry: text(),
    budget: numeric({ precision: 14, scale: 2 }),
    currency: varchar({ length: 3 }),
    notes: text(),
    metadata: jsonb(),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    // Set on conversion (spec §9); the lead itself is kept for history.
    contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    companyId: uuid().references(() => companies.id, { onDelete: 'set null' }),
    lastContactedAt: timestamp(ms),
    nextFollowupAt: timestamp(ms),
    convertedAt: timestamp(ms),
    lostAt: timestamp(ms),
    archivedAt: timestamp(ms),
    createdAt: timestamp(ms).notNull().defaultNow(),
    updatedAt: timestamp(ms)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('leads_org_created_idx').on(t.organizationId, t.createdAt.desc(), t.id.desc()),
    index('leads_org_email_idx').on(t.organizationId, t.email),
    index('leads_org_phone_idx').on(t.organizationId, t.phone),
    index('leads_org_stage_idx').on(t.organizationId, t.stageId),
    index('leads_org_owner_idx').on(t.organizationId, t.ownerUserId),
  ],
);

export const leadTags = pgTable(
  'lead_tags',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: citext().notNull(),
    color: varchar({ length: 9 }),
    createdAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [unique('lead_tags_organization_id_name_unique').on(t.organizationId, t.name)],
);

export const leadTagLinks = pgTable(
  'lead_tag_links',
  {
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => leadTags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.tagId] }), index('lead_tag_links_tag_id_idx').on(t.tagId)],
);

// Spec §20: the lead timeline. Append-only; corrections are new activities.
export const activities = pgTable(
  'activities',
  {
    id: id(),
    // Insertion order: activities written in one transaction share a timestamp.
    seq: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    type: varchar({ length: 64 }).notNull(),
    payload: jsonb(),
    createdAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [index('activities_lead_seq_idx').on(t.leadId, t.seq.desc())],
);

export type Lead = typeof leads.$inferSelect;
export type Activity = typeof activities.$inferSelect;
