import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

const ms = { withTimezone: true, precision: 3 } as const;

export type ModelProfile = 'fast' | 'balanced' | 'reasoning' | 'embedding';

export interface AiFeatures {
  leadAnalysis: boolean;
  conversationAnalysis: boolean;
  replySuggestions: boolean;
  knowledgeBase: boolean;
  nlSearch: boolean;
  autoReply: boolean;
}

/** USD per 1M tokens. */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
}

// Spec §27 / §74 / §75. One row per organization.
export const aiSettings = pgTable('ai_settings', {
  organizationId: uuid()
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  provider: varchar({ length: 30 }).notNull().default('openai'),
  // AES-GCM sealed with DATA_ENCRYPTION_KEY; never returned by the API.
  apiKeyEnc: text(),
  apiKeyLast4: varchar({ length: 4 }),
  enabled: boolean().notNull().default(false),
  models: jsonb().$type<Partial<Record<ModelProfile, string>>>().notNull().default({}),
  features: jsonb().$type<Partial<AiFeatures>>().notNull().default({}),
  monthlyBudgetUsd: numeric({ precision: 12, scale: 2 }),
  prices: jsonb().$type<Record<string, ModelPrice>>().notNull().default({}),
  updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp(ms).notNull().defaultNow(),
});

// Spec §29. Built-in v0 prompts ship in code; versions here override them once activated.
export const aiPromptVersions = pgTable(
  'ai_prompt_versions',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    promptKey: varchar({ length: 60 }).notNull(),
    version: integer().notNull(),
    systemPrompt: text().notNull(),
    modelProfile: varchar({ length: 20 }).notNull(),
    maxOutputTokens: integer().notNull(),
    temperature: numeric({ precision: 3, scale: 2 }),
    active: boolean().notNull().default(false),
    notes: text(),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [
    unique('ai_prompt_versions_org_key_version_unique').on(t.organizationId, t.promptKey, t.version),
    uniqueIndex('ai_prompt_versions_one_active').on(t.organizationId, t.promptKey).where(sql`${t.active}`),
  ],
);

export const aiRunStatus = pgEnum('ai_run_status', ['SUCCEEDED', 'FAILED', 'BLOCKED']);

// Spec §28: every AI operation, including blocked and failed ones.
export const aiRuns = pgTable(
  'ai_runs',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    provider: varchar({ length: 30 }).notNull(),
    model: text(),
    purpose: varchar({ length: 60 }).notNull(),
    promptKey: varchar({ length: 60 }),
    // 0 = built-in default prompt.
    promptVersion: integer(),
    requestId: text(),
    inputTokens: integer().notNull().default(0),
    cachedTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    // Null when the model has no configured price (unknown, not zero).
    estimatedCostUsd: numeric({ precision: 12, scale: 6 }),
    latencyMs: integer(),
    attempts: integer().notNull().default(1),
    status: aiRunStatus().notNull(),
    errorCode: varchar({ length: 60 }),
    entityType: varchar({ length: 30 }),
    entityId: uuid(),
    createdAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [index('ai_runs_org_created_idx').on(t.organizationId, t.createdAt.desc())],
);

// Structured AI results kept for history and display (spec §31: structured result + human summary).
export const aiAnalyses = pgTable(
  'ai_analyses',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entityType: varchar({ length: 30 }).notNull(),
    entityId: uuid().notNull(),
    purpose: varchar({ length: 60 }).notNull(),
    runId: uuid().references(() => aiRuns.id, { onDelete: 'set null' }),
    result: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [index('ai_analyses_entity_idx').on(t.entityId, t.createdAt.desc())],
);

export type AiSettings = typeof aiSettings.$inferSelect;
export type AiRun = typeof aiRuns.$inferSelect;
