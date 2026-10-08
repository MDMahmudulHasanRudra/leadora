import {
  aiAnalyses,
  conversations,
  type DbHandle,
  followups,
  leadSourceType,
  leadSources,
  leads,
  messages,
  pipelineStages,
  users,
} from '@leadora/database';
import { escapeLike } from '@leadora/domain';
import { aliasedTable, and, asc, desc, eq, exists, gte, ilike, inArray, isNull, lt, ne, notExists, or, type SQL, sql } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context';
import type { Permission } from '../../auth/permissions';
import type { LeadReader } from '../../leads/lead-reader.service';
import type { LeadFilters, Plan, ToolName } from './assistant.schemas';

type Db = DbHandle['db'];
const H = 3_600_000;
const LIMIT = 25;
const num = (v: unknown) => Number(v ?? 0);

/** Spec §39: every tool is READ_ONLY and names the permission it needs, checked before it runs. */
export const TOOL_ACCESS: Record<Exclude<ToolName, 'unsupported'>, { permission: Permission; label: string }> = {
  search_leads: { permission: 'lead.view', label: 'leads' },
  team_performance: { permission: 'analytics.view', label: 'team performance' },
  source_performance: { permission: 'analytics.view', label: 'lead source performance' },
  list_followups: { permission: 'followup.view', label: 'follow-ups' },
  conversations_needing_attention: { permission: 'conversation.view', label: 'conversations' },
};

export type ToolResult =
  | { kind: 'leads'; items: Record<string, unknown>[] }
  | { kind: 'team'; items: Record<string, unknown>[] }
  | { kind: 'sources'; items: Record<string, unknown>[] }
  | { kind: 'followups'; items: Record<string, unknown>[] }
  | { kind: 'conversations'; items: Record<string, unknown>[] };

const pendingFollowup = (cond?: SQL) =>
  and(eq(followups.leadId, leads.id), eq(followups.status, 'PENDING'), cond);

export async function searchLeads(db: Db, reader: LeadReader, auth: AuthContext, f: Partial<LeadFilters>): Promise<ToolResult> {
  const now = Date.now();
  const where: (SQL | undefined)[] = [isNull(leads.archivedAt)];
  if (f.temperatures?.length) where.push(inArray(leads.temperature, f.temperatures));
  if (f.stageKeys?.length) where.push(inArray(pipelineStages.key, f.stageKeys));
  if (f.outcome) where.push(eq(pipelineStages.outcome, f.outcome));
  if (f.owner === 'me') where.push(eq(leads.ownerUserId, auth.userId));
  if (f.owner === 'unassigned') where.push(isNull(leads.ownerUserId));
  // The model may name a source type that does not exist; an unknown enum value would be a database error.
  const types = (f.sourceTypes ?? []).filter((s): s is (typeof leadSourceType.enumValues)[number] => (leadSourceType.enumValues as readonly string[]).includes(s));
  if (f.sourceTypes?.length) where.push(types.length ? inArray(leadSources.type, types) : sql`false`);
  if (f.createdWithinDays) where.push(gte(leads.createdAt, new Date(now - f.createdWithinDays * 24 * H)));
  if (f.noFollowupWithinHours) {
    const h = f.noFollowupWithinHours * H;
    where.push(or(isNull(leads.lastContactedAt), lt(leads.lastContactedAt, new Date(now - h))));
    where.push(notExists(db.select({ one: sql`1` }).from(followups).where(pendingFollowup(lt(followups.scheduledAt, new Date(now + h))))));
  }
  if (f.hasOverdueFollowup !== null && f.hasOverdueFollowup !== undefined) {
    const overdue = db.select({ one: sql`1` }).from(followups).where(pendingFollowup(lt(followups.scheduledAt, new Date(now))));
    where.push(f.hasOverdueFollowup ? exists(overdue) : notExists(overdue));
  }
  if (f.minScore !== null && f.minScore !== undefined) where.push(gte(leads.score, f.minScore));
  if (f.mentions?.trim()) {
    const like = `%${escapeLike(f.mentions.trim())}%`;
    const said = db
      .select({ one: sql`1` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(conversations.leadId, leads.id), eq(messages.direction, 'INBOUND'), ilike(messages.content, like)));
    where.push(or(ilike(leads.notes, like), exists(said)));
  }
  if (f.text?.trim()) {
    const like = `%${escapeLike(f.text.trim())}%`;
    where.push(or(ilike(leads.fullName, like), ilike(leads.email, like), ilike(leads.phone, like), ilike(leads.companyName, like)));
  }
  const orderBy =
    f.sort === 'newest'
      ? [desc(leads.createdAt)]
      : f.sort === 'oldest_contact'
        ? [sql`${leads.lastContactedAt} asc nulls first`]
        : [sql`${leads.score} desc nulls last`, desc(leads.createdAt)];

  const rows = await reader.find(auth.organizationId, { where: and(...where), orderBy, limit: LIMIT });
  return {
    kind: 'leads',
    items: rows.map((l) => ({
      id: l.id,
      fullName: l.fullName,
      companyName: l.companyName,
      score: l.score,
      temperature: l.temperature,
      stage: l.stage.name,
      owner: l.owner?.fullName ?? null,
      lastContactedAt: l.lastContactedAt,
      nextFollowupAt: l.nextFollowupAt,
    })),
  };
}

export async function teamPerformance(db: Db, auth: AuthContext, periodDays: number): Promise<ToolResult> {
  const since = new Date(Date.now() - periodDays * 24 * H);
  const rows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      leads: sql<number>`count(${leads.id})`,
      won: sql<number>`count(${leads.id}) filter (where ${pipelineStages.outcome} = 'WON')`,
    })
    .from(users)
    .leftJoin(leads, and(eq(leads.ownerUserId, users.id), isNull(leads.archivedAt), gte(leads.createdAt, since)))
    .leftJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .where(and(eq(users.organizationId, auth.organizationId), eq(users.status, 'ACTIVE')))
    .groupBy(users.id)
    .orderBy(asc(users.fullName));
  return {
    kind: 'team',
    items: rows
      .map((r) => ({ ...r, leads: num(r.leads), won: num(r.won), conversionRate: num(r.leads) ? num(r.won) / num(r.leads) : 0, periodDays }))
      .sort((a, b) => b.conversionRate - a.conversionRate || b.won - a.won),
  };
}

export async function sourcePerformance(db: Db, auth: AuthContext, periodDays: number | null): Promise<ToolResult> {
  const won = sql`${pipelineStages.outcome} = 'WON'`;
  const rows = await db
    .select({
      name: leadSources.name,
      type: leadSources.type,
      leads: sql<number>`count(*)`,
      won: sql<number>`count(*) filter (where ${won})`,
      // Revenue is the sum of won leads' budgets (no currency conversion, spec §135).
      wonValue: sql<number>`coalesce(sum(${leads.budget}) filter (where ${won}), 0)`,
    })
    .from(leads)
    .innerJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .where(
      and(
        eq(leads.organizationId, auth.organizationId),
        isNull(leads.archivedAt),
        periodDays ? gte(leads.createdAt, new Date(Date.now() - periodDays * 24 * H)) : undefined,
      ),
    )
    .groupBy(leadSources.id)
    .orderBy(sql`coalesce(sum(${leads.budget}) filter (where ${won}), 0) desc`, sql`count(*) desc`);
  return {
    kind: 'sources',
    items: rows.map((r) => ({ ...r, leads: num(r.leads), won: num(r.won), wonValue: num(r.wonValue), conversionRate: num(r.leads) ? num(r.won) / num(r.leads) : 0 })),
  };
}

export async function listFollowups(db: Db, auth: AuthContext, scope: NonNullable<Plan['followups']>, mineOnly: boolean): Promise<ToolResult> {
  const now = new Date();
  const window =
    scope === 'overdue'
      ? lt(followups.scheduledAt, now)
      : scope === 'due_today'
        ? and(gte(followups.scheduledAt, now), lt(followups.scheduledAt, new Date(now.getTime() + 24 * H)))
        : gte(followups.scheduledAt, now);
  const assignee = aliasedTable(users, 'assignee');
  const rows = await db
    .select({
      id: followups.id,
      type: followups.type,
      scheduledAt: followups.scheduledAt,
      notes: followups.notes,
      leadId: leads.id,
      leadName: leads.fullName,
      assignee: assignee.fullName,
    })
    .from(followups)
    .innerJoin(leads, eq(leads.id, followups.leadId))
    .leftJoin(assignee, eq(assignee.id, followups.assignedUserId))
    .where(
      and(
        eq(followups.organizationId, auth.organizationId),
        eq(followups.status, 'PENDING'),
        window,
        // Without lead.assign a user only sees their own follow-ups, whatever the question asked for.
        mineOnly || !auth.permissions.has('lead.assign') ? eq(followups.assignedUserId, auth.userId) : undefined,
      ),
    )
    .orderBy(asc(followups.scheduledAt))
    .limit(LIMIT);
  return { kind: 'followups', items: rows };
}

export async function conversationsNeedingAttention(db: Db, auth: AuthContext): Promise<ToolResult> {
  const flagged = db
    .select({ one: sql`1` })
    .from(aiAnalyses)
    .where(
      and(
        eq(aiAnalyses.entityId, conversations.id),
        eq(aiAnalyses.purpose, 'conversation_analysis'),
        sql`(${aiAnalyses.result}->>'sentiment' = 'NEGATIVE' or jsonb_array_length(coalesce(${aiAnalyses.result}->'riskFlags', '[]'::jsonb)) > 0)`,
      ),
    );
  const rows = await db
    .select({
      id: conversations.id,
      subject: conversations.subject,
      leadId: leads.id,
      leadName: leads.fullName,
      lastMessageAt: conversations.lastMessageAt,
      waitingOnUs: sql<boolean>`${conversations.lastDirection} = 'INBOUND'`,
      flagged: sql<boolean>`exists(${flagged})`,
    })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .where(
      and(
        eq(conversations.organizationId, auth.organizationId),
        ne(conversations.status, 'RESOLVED'),
        or(eq(conversations.lastDirection, 'INBOUND'), exists(flagged)),
      ),
    )
    .orderBy(asc(conversations.lastMessageAt))
    .limit(LIMIT);
  return {
    kind: 'conversations',
    items: rows.map((r) => ({ ...r, reason: [r.waitingOnUs && 'waiting for our reply', r.flagged && 'AI flagged a risk or unhappy customer'].filter(Boolean).join('; ') })),
  };
}
