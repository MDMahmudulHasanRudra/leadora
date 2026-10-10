import { type Database, type InsightEvidence, organizations, salesInsights } from '@leadora/database';
import { eq, sql } from 'drizzle-orm';

export interface Insight {
  key: string;
  title: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  evidence: InsightEvidence;
  recommendedAction: string;
}

const STALE_DAYS = 7;
const BOTTLENECK_DAYS = 14;
const MIN_SAMPLE = 5;

const n = (v: unknown) => Number(v ?? 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const money = (x: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(x);

/**
 * Spec §47 insights, computed deterministically from CRM data so every number is traceable. Each generator
 * returns null when there is nothing worth saying.
 */
export async function computeInsights(db: Database, organizationId: string): Promise<Insight[]> {
  const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) => db.execute<T>(query).then((r) => r.rows);
  const open = sql`l.organization_id = ${organizationId} and l.archived_at is null and s.outcome = 'OPEN'`;
  const out: Insight[] = [];

  // Top opportunities: hot open leads with the largest budgets.
  const top = await q<{ id: string; full_name: string; budget: string | null; score: number | null }>(sql`
    select l.id, l.full_name, l.budget, l.score from leads l join pipeline_stages s on s.id = l.stage_id
    where ${open} and l.temperature = 'HOT' order by l.budget desc nulls last, l.score desc nulls last limit 5`);
  if (top.length) {
    out.push({
      key: 'top_opportunities',
      title: `${top.length} hot ${top.length === 1 ? 'lead is' : 'leads are'} ready to close`,
      severity: 'INFO',
      evidence: {
        summary: 'Open leads scored hot, largest budgets first.',
        items: top.map((l) => ({ label: l.full_name, value: l.budget ? money(n(l.budget)) : `score ${l.score ?? '—'}`, link: `/leads/${l.id}` })),
      },
      recommendedAction: 'Call these leads today and send pricing to anyone who asked for it.',
    });
  }

  // Stale leads: open, no contact for a week.
  const [stale] = await q<{ count: string }>(sql`
    select count(*) from leads l join pipeline_stages s on s.id = l.stage_id
    where ${open} and coalesce(l.last_contacted_at, l.created_at) < now() - make_interval(days => ${STALE_DAYS})`);
  if (n(stale?.count) > 0) {
    const count = n(stale?.count);
    out.push({
      key: 'stale_leads',
      title: `${count} open ${count === 1 ? 'lead has' : 'leads have'} gone quiet for ${STALE_DAYS}+ days`,
      severity: count >= 20 ? 'CRITICAL' : 'WARNING',
      evidence: { summary: `Open leads with no contact in the last ${STALE_DAYS} days.`, items: [{ label: 'View leads', link: '/leads' }] },
      recommendedAction: 'Schedule follow-ups for them, or add an automation on “A lead has had no contact for a while”.',
    });
  }

  // Unassigned open leads.
  const [unassigned] = await q<{ count: string }>(sql`
    select count(*) from leads l join pipeline_stages s on s.id = l.stage_id where ${open} and l.owner_user_id is null`);
  if (n(unassigned?.count) > 0) {
    out.push({
      key: 'unassigned_leads',
      title: `${n(unassigned?.count)} open ${n(unassigned?.count) === 1 ? 'lead has' : 'leads have'} no owner`,
      severity: 'WARNING',
      evidence: { summary: 'Nobody is responsible for these leads.', items: [{ label: 'View unassigned', link: '/leads?owner=unassigned' }] },
      recommendedAction: 'Assign them, or set up assignment rules so new leads always get an owner.',
    });
  }

  // Follow-up risk: overdue follow-ups, by person.
  const overdue = await q<{ name: string | null; count: string }>(sql`
    select u.full_name as name, count(*) from followups f left join users u on u.id = f.assigned_user_id
    where f.organization_id = ${organizationId} and f.status = 'PENDING' and f.scheduled_at < now()
    group by u.full_name order by count(*) desc`);
  const overdueTotal = overdue.reduce((a, r) => a + n(r.count), 0);
  if (overdueTotal > 0) {
    out.push({
      key: 'followup_risk',
      title: `${overdueTotal} follow-up${overdueTotal === 1 ? ' is' : 's are'} overdue`,
      severity: overdueTotal >= 10 ? 'CRITICAL' : 'WARNING',
      evidence: { summary: 'Pending follow-ups past their scheduled time.', items: overdue.slice(0, 5).map((r) => ({ label: r.name ?? 'Unassigned', value: n(r.count), link: '/followups' })) },
      recommendedAction: 'Clear overdue follow-ups first; reassign them if someone is overloaded.',
    });
  }

  // Conversion trend: last 30 days vs the 30 before.
  const [trend] = await q<{ recent: string; previous: string }>(sql`
    select count(*) filter (where converted_at >= now() - interval '30 days') as recent,
           count(*) filter (where converted_at >= now() - interval '60 days' and converted_at < now() - interval '30 days') as previous
    from leads where organization_id = ${organizationId} and archived_at is null`);
  const recent = n(trend?.recent);
  const previous = n(trend?.previous);
  if (recent + previous > 0) {
    const change = previous ? (recent - previous) / previous : 1;
    out.push({
      key: 'conversion_trend',
      title: previous === 0 ? `${recent} conversion${recent === 1 ? '' : 's'} in the last 30 days` : `Conversions ${change >= 0 ? 'up' : 'down'} ${pct(Math.abs(change))} on the previous 30 days`,
      severity: change <= -0.2 ? 'WARNING' : 'INFO',
      evidence: { summary: 'Leads won per 30-day period.', items: [{ label: 'Last 30 days', value: recent }, { label: 'Previous 30 days', value: previous }] },
      recommendedAction: change <= -0.2 ? 'Review lost and stalled deals with the team to find what changed.' : 'Keep doing what works — note which sources and people drove the wins.',
    });
  }

  // Source performance: best and worst converting sources with enough volume.
  const sources = await q<{ name: string; leads: string; won: string }>(sql`
    select src.name, count(*) as leads, count(*) filter (where s.outcome = 'WON') as won
    from leads l join lead_sources src on src.id = l.source_id join pipeline_stages s on s.id = l.stage_id
    where l.organization_id = ${organizationId} and l.archived_at is null and l.created_at >= now() - interval '90 days'
    group by src.name having count(*) >= ${MIN_SAMPLE}`);
  if (sources.length >= 2) {
    const ranked = sources.map((s) => ({ name: s.name, leads: n(s.leads), rate: n(s.won) / n(s.leads) })).sort((a, b) => b.rate - a.rate);
    const best = ranked[0]!;
    const worst = ranked.at(-1)!;
    if (best.rate > worst.rate) {
      out.push({
        key: 'source_performance',
        title: `${best.name} converts best (${pct(best.rate)}); ${worst.name} converts worst (${pct(worst.rate)})`,
        severity: 'INFO',
        evidence: { summary: `Conversion by lead source over 90 days (sources with ${MIN_SAMPLE}+ leads).`, items: ranked.map((s) => ({ label: s.name, value: `${pct(s.rate)} of ${s.leads}` })) },
        recommendedAction: `Put more budget behind ${best.name}; review lead quality from ${worst.name}.`,
      });
    }
  }

  // Agent performance: people converting at under half the team rate.
  const agents = await q<{ name: string; leads: string; won: string }>(sql`
    select u.full_name as name, count(*) as leads, count(*) filter (where s.outcome = 'WON') as won
    from leads l join users u on u.id = l.owner_user_id join pipeline_stages s on s.id = l.stage_id
    where l.organization_id = ${organizationId} and l.archived_at is null and l.created_at >= now() - interval '90 days'
    group by u.full_name having count(*) >= ${MIN_SAMPLE}`);
  if (agents.length >= 2) {
    const totalLeads = agents.reduce((a, r) => a + n(r.leads), 0);
    const teamRate = agents.reduce((a, r) => a + n(r.won), 0) / totalLeads;
    const behind = agents.filter((a) => teamRate > 0 && n(a.won) / n(a.leads) < teamRate / 2);
    if (behind.length) {
      out.push({
        key: 'agent_performance',
        title: `${behind.length} ${behind.length === 1 ? 'person converts' : 'people convert'} at under half the team rate`,
        severity: 'WARNING',
        evidence: { summary: `Team conversion over 90 days is ${pct(teamRate)}.`, items: behind.map((a) => ({ label: a.name, value: `${pct(n(a.won) / n(a.leads))} of ${n(a.leads)}` })) },
        recommendedAction: 'Pair them with a top performer and review a few of their lost leads together.',
      });
    }
  }

  // Pipeline bottleneck: the open stage holding the most leads that haven't moved for two weeks.
  const [stuck] = await q<{ name: string; count: string }>(sql`
    select s.name, count(*) from leads l join pipeline_stages s on s.id = l.stage_id
    where ${open} and coalesce(
      (select max(a.created_at) from activities a where a.lead_id = l.id and a.type = 'lead.stage_changed'), l.created_at
    ) < now() - make_interval(days => ${BOTTLENECK_DAYS})
    group by s.name, s.position order by count(*) desc, s.position limit 1`);
  if (n(stuck?.count) >= MIN_SAMPLE) {
    out.push({
      key: 'pipeline_bottleneck',
      title: `${n(stuck?.count)} leads are stuck in “${stuck!.name}”`,
      severity: 'WARNING',
      evidence: { summary: `Leads that have not changed stage for ${BOTTLENECK_DAYS}+ days, by stage.`, items: [{ label: stuck!.name, value: n(stuck?.count), link: '/pipeline' }] },
      recommendedAction: `Decide the next step for each lead in ${stuck!.name}: move it forward, or mark it lost.`,
    });
  }

  return out;
}

/** Replaces an organization's insight set in one transaction. */
export async function refreshInsights(db: Database, organizationId: string) {
  const insights = await computeInsights(db, organizationId);
  await db.transaction(async (tx) => {
    await tx.delete(salesInsights).where(eq(salesInsights.organizationId, organizationId));
    if (insights.length) await tx.insert(salesInsights).values(insights.map((i) => ({ ...i, organizationId })));
  });
  return insights;
}

export async function refreshAllInsights(db: Database) {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  for (const o of orgs) await refreshInsights(db, o.id);
  return orgs.length;
}
