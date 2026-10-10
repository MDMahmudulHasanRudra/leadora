import { Inject, Injectable } from '@nestjs/common';
import { type DbHandle, salesInsights } from '@leadora/database';
import { refreshInsights } from '@leadora/domain';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../infra/tokens';

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const maybe = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const rate = (a: number, b: number) => (b ? a / b : 0);

/**
 * Spec §45–46. Definitions (shared by every view so numbers agree):
 * - the period's cohort is the leads created in it (archived leads excluded);
 * - qualified = won, or open at/after the pipeline's QUALIFIED stage;
 * - response time = creation → first message sent or follow-up completed;
 * - revenue and sales cycle use leads won within the period (lead budget as value, no currency conversion).
 * All values are computed in SQL from CRM data; nothing here is AI-generated.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private exec<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
    return this.handle.db.execute<T>(query).then((r) => r.rows);
  }

  /** Leads with their stage facts, qualification and first-contact time, for one organization. */
  private leadFacts(organizationId: string) {
    return sql`
      with qual as (
        select s.pipeline_id, min(s.position) as position from pipeline_stages s
        where s.organization_id = ${organizationId} and s.key = 'QUALIFIED' group by s.pipeline_id
      ),
      first_contact as (
        select a.lead_id, min(a.created_at) as at from activities a
        where a.organization_id = ${organizationId} and a.type in ('message.sent', 'followup.completed') group by a.lead_id
      )
      select l.id, l.owner_user_id, l.source_id, l.created_at, l.converted_at, l.last_contacted_at,
        coalesce(l.budget, 0)::float8 as value, s.outcome,
        (s.outcome = 'WON' or (s.outcome = 'OPEN' and s.position >= coalesce(q.position, 2))) as qualified,
        extract(epoch from (fc.at - l.created_at)) / 3600.0 as response_hours
      from leads l
      join pipeline_stages s on s.id = l.stage_id
      left join qual q on q.pipeline_id = l.pipeline_id
      left join first_contact fc on fc.lead_id = l.id
      where l.organization_id = ${organizationId} and l.archived_at is null`;
  }

  async overview(organizationId: string, days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const [t] = await this.exec<Record<string, unknown>>(sql`
      with f as (${this.leadFacts(organizationId)})
      select
        count(*) filter (where created_at >= ${since}) as new_leads,
        count(*) filter (where created_at >= ${since} and last_contacted_at is not null) as contacted,
        count(*) filter (where created_at >= ${since} and qualified) as qualified,
        count(*) filter (where created_at >= ${since} and outcome = 'WON') as converted,
        count(*) filter (where created_at >= ${since} and outcome = 'LOST') as lost,
        count(*) as total_leads,
        count(*) filter (where outcome = 'OPEN') as open_leads,
        avg(response_hours) filter (where created_at >= ${since} and response_hours >= 0) as avg_response_hours,
        avg(extract(epoch from (converted_at - created_at)) / 86400.0) filter (where outcome = 'WON' and converted_at >= ${since}) as avg_sales_cycle_days,
        coalesce(sum(value) filter (where outcome = 'WON' and converted_at >= ${since}), 0) as revenue,
        count(*) filter (where outcome = 'WON' and converted_at >= ${since}) as won_in_period
      from f`);
    const [fu] = await this.exec<Record<string, unknown>>(sql`
      select count(*) filter (where status = 'PENDING' and scheduled_at < now()) as overdue,
             count(*) filter (where status = 'PENDING' and scheduled_at >= now() and scheduled_at < now() + interval '1 day') as due_today
      from followups where organization_id = ${organizationId}`);
    // One grouped pass per measure (a per-day subquery would scan the leads table twice for every day).
    const series = await this.exec<{ day: string; new_leads: number; conversions: number }>(sql`
      with bounds as (select (now() at time zone 'utc')::date - ${days - 1}::int as first_day),
      days as (select generate_series(b.first_day, (now() at time zone 'utc')::date, interval '1 day')::date as day from bounds b),
      created as (
        select (l.created_at at time zone 'utc')::date as day, count(*) as n from leads l, bounds b
        where l.organization_id = ${organizationId} and l.archived_at is null and l.created_at >= b.first_day::timestamp at time zone 'utc'
        group by 1
      ),
      converted as (
        select (l.converted_at at time zone 'utc')::date as day, count(*) as n from leads l, bounds b
        where l.organization_id = ${organizationId} and l.archived_at is null and l.converted_at >= b.first_day::timestamp at time zone 'utc'
        group by 1
      )
      select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(c.n, 0) as new_leads, coalesce(v.n, 0) as conversions
      from days d left join created c on c.day = d.day left join converted v on v.day = d.day
      order by d.day`);
    const newLeads = num(t?.new_leads);
    return {
      periodDays: days,
      totals: {
        totalLeads: num(t?.total_leads),
        openLeads: num(t?.open_leads),
        newLeads,
        contacted: num(t?.contacted),
        qualified: num(t?.qualified),
        converted: num(t?.converted),
        lost: num(t?.lost),
        conversionRate: rate(num(t?.converted), newLeads),
        avgResponseHours: maybe(t?.avg_response_hours),
        avgSalesCycleDays: maybe(t?.avg_sales_cycle_days),
        revenue: num(t?.revenue),
        wonInPeriod: num(t?.won_in_period),
        followupsOverdue: num(fu?.overdue),
        followupsDueToday: num(fu?.due_today),
      },
      series: series.map((s) => ({ date: s.day, newLeads: num(s.new_leads), conversions: num(s.conversions) })),
    };
  }

  async sources(organizationId: string, days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.exec<Record<string, unknown>>(sql`
      with f as (${this.leadFacts(organizationId)})
      select src.id, src.name, src.type,
        count(f.id) as leads,
        count(f.id) filter (where f.qualified) as qualified,
        count(f.id) filter (where f.outcome = 'WON') as converted,
        coalesce(sum(f.value) filter (where f.outcome = 'WON'), 0) as revenue
      from lead_sources src
      left join f on f.source_id = src.id and f.created_at >= ${since}
      where src.organization_id = ${organizationId}
      group by src.id
      having count(f.id) > 0
      order by count(f.id) desc`);
    return {
      periodDays: days,
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        leads: num(r.leads),
        qualified: num(r.qualified),
        converted: num(r.converted),
        conversionRate: rate(num(r.converted), num(r.leads)),
        revenue: num(r.revenue),
      })),
    };
  }

  async team(organizationId: string, days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.exec<Record<string, unknown>>(sql`
      with f as (${this.leadFacts(organizationId)}),
      fu as (
        select assigned_user_id,
          count(*) filter (where status = 'COMPLETED') as completed,
          count(*) filter (where status = 'COMPLETED' or (status = 'PENDING' and scheduled_at < now())) as due
        from followups where organization_id = ${organizationId} and scheduled_at >= ${since} group by assigned_user_id
      )
      select u.id, u.full_name,
        count(f.id) as assigned,
        count(f.id) filter (where f.last_contacted_at is not null) as contacted,
        count(f.id) filter (where f.qualified) as qualified,
        count(f.id) filter (where f.outcome = 'WON') as converted,
        avg(f.response_hours) filter (where f.response_hours >= 0) as response_hours,
        max(fu.completed) as fu_completed, max(fu.due) as fu_due
      from users u
      left join f on f.owner_user_id = u.id and f.created_at >= ${since}
      left join fu on fu.assigned_user_id = u.id
      where u.organization_id = ${organizationId} and u.status = 'ACTIVE'
      group by u.id
      order by count(f.id) filter (where f.outcome = 'WON') desc, u.full_name`);
    return {
      periodDays: days,
      items: rows.map((r) => ({
        userId: r.id,
        fullName: r.full_name,
        assigned: num(r.assigned),
        contacted: num(r.contacted),
        qualified: num(r.qualified),
        converted: num(r.converted),
        conversionRate: rate(num(r.converted), num(r.assigned)),
        avgResponseHours: maybe(r.response_hours),
        followupCompletion: num(r.fu_due) ? num(r.fu_completed) / num(r.fu_due) : null,
      })),
    };
  }

  /** Spec §46: weighted = value × stage probability. Only CRM numbers; AI may explain, never adjust. */
  async forecast(organizationId: string) {
    const stages = await this.exec<Record<string, unknown>>(sql`
      select s.id, s.key, s.name, s.color, s.outcome, s.probability, s.position,
        count(l.id) as count, coalesce(sum(l.budget), 0)::float8 as value
      from pipeline_stages s
      join pipelines p on p.id = s.pipeline_id and p.is_default
      left join leads l on l.stage_id = s.id and l.archived_at is null
      where s.organization_id = ${organizationId}
      group by s.id order by s.position`);
    const items = stages.map((s) => {
      const value = num(s.value);
      const probability = num(s.probability);
      return { id: s.id, key: s.key, name: s.name, color: s.color, outcome: s.outcome, probability, count: num(s.count), value, weighted: s.outcome === 'OPEN' ? (value * probability) / 100 : 0 };
    });
    const open = items.filter((s) => s.outcome === 'OPEN');
    return {
      stages: items,
      totals: {
        pipelineValue: open.reduce((a, s) => a + s.value, 0),
        weightedPipeline: Math.round(open.reduce((a, s) => a + s.weighted, 0) * 100) / 100,
        wonValue: items.filter((s) => s.outcome === 'WON').reduce((a, s) => a + s.value, 0),
        lostValue: items.filter((s) => s.outcome === 'LOST').reduce((a, s) => a + s.value, 0),
        openDeals: open.reduce((a, s) => a + s.count, 0),
      },
    };
  }
  /** Spec §47. Generated by the worker every few hours; computed on first view so a new org isn't empty. */
  async insights(organizationId: string) {
    const order = sql`case ${salesInsights.severity} when 'CRITICAL' then 0 when 'WARNING' then 1 else 2 end`;
    let rows = await this.handle.db.select().from(salesInsights).where(eq(salesInsights.organizationId, organizationId)).orderBy(order, asc(salesInsights.key));
    if (rows.length === 0) {
      await refreshInsights(this.handle.db, organizationId);
      rows = await this.handle.db.select().from(salesInsights).where(eq(salesInsights.organizationId, organizationId)).orderBy(order, asc(salesInsights.key));
    }
    return { items: rows.map(({ organizationId: _o, ...r }) => r) };
  }

  async refreshInsights(organizationId: string) {
    await refreshInsights(this.handle.db, organizationId);
    return this.insights(organizationId);
  }
}