import { leadSources, pipelineStages, pipelines, type Transaction } from '@leadora/database';
import { seedDefaultRoles } from '../auth/roles';

// Spec §16. Keep in sync with the backfill in migration 0004.
export const DEFAULT_STAGES = [
  { key: 'NEW', name: 'New', probability: 5, outcome: 'OPEN', color: '#64748b' },
  { key: 'CONTACTED', name: 'Contacted', probability: 10, outcome: 'OPEN', color: '#0ea5e9' },
  { key: 'QUALIFIED', name: 'Qualified', probability: 25, outcome: 'OPEN', color: '#6366f1' },
  { key: 'INTERESTED', name: 'Interested', probability: 40, outcome: 'OPEN', color: '#8b5cf6' },
  { key: 'NEGOTIATION', name: 'Negotiation', probability: 60, outcome: 'OPEN', color: '#f59e0b' },
  { key: 'FOLLOW_UP', name: 'Follow-up', probability: 50, outcome: 'OPEN', color: '#14b8a6' },
  { key: 'CONVERTED', name: 'Converted', probability: 100, outcome: 'WON', color: '#22c55e' },
  { key: 'LOST', name: 'Lost', probability: 0, outcome: 'LOST', color: '#ef4444' },
] as const;

export const DEFAULT_SOURCES = [
  { type: 'MANUAL', name: 'Manual entry' },
  { type: 'CSV', name: 'CSV import' },
  { type: 'WEBSITE', name: 'Website form' },
  { type: 'API', name: 'API' },
  { type: 'EMAIL', name: 'Email' },
] as const;

/** Everything a brand-new organization needs to be usable. Runs inside the creating transaction. */
export async function initializeOrganization(tx: Transaction, organizationId: string) {
  const roleIds = await seedDefaultRoles(tx, organizationId);

  const [pipeline] = await tx
    .insert(pipelines)
    .values({ organizationId, name: 'Sales pipeline', isDefault: true })
    .returning({ id: pipelines.id });
  await tx
    .insert(pipelineStages)
    .values(DEFAULT_STAGES.map((s, position) => ({ ...s, position, organizationId, pipelineId: pipeline!.id })));

  await tx.insert(leadSources).values(DEFAULT_SOURCES.map((s) => ({ ...s, organizationId })));
  return { roleIds };
}
