import {
  type AssignmentRule,
  assignmentRules,
  leads,
  pipelineStages,
  teamMembers,
  type Transaction,
  users,
} from '@leadora/database';
import { and, asc, count, eq, isNull } from 'drizzle-orm';

export interface AssignmentFacts {
  sourceType: string;
  country?: string | null;
  tags?: string[];
  priority?: string;
}

export function ruleMatches(rule: Pick<AssignmentRule, 'conditions'>, facts: AssignmentFacts): boolean {
  const c = rule.conditions;
  const tags = (facts.tags ?? []).map((t) => t.toLowerCase());
  if (c.sourceTypes?.length && !c.sourceTypes.includes(facts.sourceType)) return false;
  if (c.countries?.length && !(facts.country && c.countries.includes(facts.country))) return false;
  if (c.priorities?.length && !(facts.priority && c.priorities.includes(facts.priority))) return false;
  if (c.tags?.length && !c.tags.some((t) => tags.includes(t.toLowerCase()))) return false;
  return true;
}

async function activeMembers(tx: Transaction, teamId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(users.status, 'ACTIVE')))
    .orderBy(asc(users.id));
  return rows.map((r) => r.id);
}

async function isActiveUser(tx: Transaction, organizationId: string, userId: string) {
  const [u] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, organizationId), eq(users.status, 'ACTIVE')));
  return !!u;
}

/**
 * Picks an owner from the first enabled rule that matches and can assign someone (spec §17).
 * Locks the rule row so concurrent round-robin picks advance the cursor one at a time.
 */
export async function pickOwnerByRules(
  tx: Transaction,
  organizationId: string,
  facts: AssignmentFacts,
): Promise<{ userId: string; ruleId: string; ruleName: string } | null> {
  const rules = await tx
    .select()
    .from(assignmentRules)
    .where(and(eq(assignmentRules.organizationId, organizationId), eq(assignmentRules.enabled, true)))
    .orderBy(asc(assignmentRules.position), asc(assignmentRules.createdAt));

  for (const rule of rules) {
    if (!ruleMatches(rule, facts)) continue;

    if (rule.strategy === 'USER') {
      if (rule.targetUserId && (await isActiveUser(tx, organizationId, rule.targetUserId))) {
        return { userId: rule.targetUserId, ruleId: rule.id, ruleName: rule.name };
      }
      continue;
    }

    if (!rule.targetTeamId) continue;
    const members = await activeMembers(tx, rule.targetTeamId);
    if (!members.length) continue;

    if (rule.strategy === 'ROUND_ROBIN') {
      const [locked] = await tx.select().from(assignmentRules).where(eq(assignmentRules.id, rule.id)).for('update');
      const prev = locked?.lastAssignedUserId ? members.indexOf(locked.lastAssignedUserId) : -1;
      const next = members[(prev + 1) % members.length]!;
      await tx.update(assignmentRules).set({ lastAssignedUserId: next }).where(eq(assignmentRules.id, rule.id));
      return { userId: next, ruleId: rule.id, ruleName: rule.name };
    }

    // LEAST_LOADED: fewest open (non-archived, OPEN-outcome) leads; ties go to the lowest id for determinism.
    const loads = await tx
      .select({ owner: leads.ownerUserId, n: count() })
      .from(leads)
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .where(and(eq(leads.organizationId, organizationId), isNull(leads.archivedAt), eq(pipelineStages.outcome, 'OPEN')))
      .groupBy(leads.ownerUserId);
    const load = new Map(loads.map((l) => [l.owner, Number(l.n)]));
    const pick = [...members].sort((x, y) => (load.get(x) ?? 0) - (load.get(y) ?? 0) || x.localeCompare(y))[0]!;
    return { userId: pick, ruleId: rule.id, ruleName: rule.name };
  }
  return null;
}
