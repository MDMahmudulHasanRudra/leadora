import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgEnum, pgTable, text, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns';
import { organizations } from './organizations';

export const pipelines = pgTable(
  'pipelines',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    isDefault: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('pipelines_organization_id_idx').on(t.organizationId),
    uniqueIndex('pipelines_one_default_per_org').on(t.organizationId).where(sql`${t.isDefault}`),
  ],
);

export const stageOutcome = pgEnum('stage_outcome', ['OPEN', 'WON', 'LOST']);

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: id(),
    pipelineId: uuid()
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    // Denormalized so every stage lookup can be tenant-scoped without a join.
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: varchar({ length: 50 }).notNull(),
    name: text().notNull(),
    position: integer().notNull(),
    probability: integer().notNull().default(0),
    outcome: stageOutcome().notNull().default('OPEN'),
    color: varchar({ length: 9 }).notNull().default('#71717a'),
    ...timestamps,
  },
  (t) => [unique('pipeline_stages_pipeline_id_key_unique').on(t.pipelineId, t.key)],
);

export type Pipeline = typeof pipelines.$inferSelect;
export type PipelineStage = typeof pipelineStages.$inferSelect;
