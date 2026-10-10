import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';

const ms = { withTimezone: true, precision: 3 } as const;

export const insightSeverity = pgEnum('insight_severity', ['INFO', 'WARNING', 'CRITICAL']);

export interface InsightEvidence {
  summary: string;
  items?: { label: string; value?: string | number; link?: string }[];
}

// Spec §47: periodic insights, each with title, severity, evidence, recommended action and generated_at.
// Regenerated as a set, so a resolved problem simply disappears.
export const salesInsights = pgTable(
  'sales_insights',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: varchar({ length: 60 }).notNull(),
    title: text().notNull(),
    severity: insightSeverity().notNull(),
    evidence: jsonb().$type<InsightEvidence>().notNull(),
    recommendedAction: text().notNull(),
    generatedAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [index('sales_insights_org_idx').on(t.organizationId, t.generatedAt.desc())],
);

export type SalesInsight = typeof salesInsights.$inferSelect;
