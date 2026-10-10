import { Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type DbHandle, followups, leadSources, leads, pipelineStages, pipelines, users } from '@leadora/database';
import { and, asc, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DB } from '../infra/tokens';
import { AnalyticsService } from './analytics.service';

const querySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
type DashboardQuery = z.infer<typeof querySchema>;

const num = (v: unknown) => Number(v ?? 0);
const countWhere = (cond: SQL) => sql<number>`count(*) filter (where ${cond})`;

/**
 * Spec §3.1 / §45 / §46. Users with analytics.view see the organization; everyone else sees
 * metrics for leads they own. Value metrics sum lead budgets (no currency conversion, spec §135).
 */
@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get('overview')
  @RequirePermission('analytics.view')
  overview(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(querySchema)) q: DashboardQuery) {
    return this.analytics.overview(auth.organizationId, q.days);
  }

  @Get('sources')
  @RequirePermission('analytics.view')
  sources(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(querySchema)) q: DashboardQuery) {
    return this.analytics.sources(auth.organizationId, q.days);
  }

  @Get('team')
  @RequirePermission('analytics.view')
  team(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(querySchema)) q: DashboardQuery) {
    return this.analytics.team(auth.organizationId, q.days);
  }

  @Get('insights')
  @RequirePermission('analytics.view')
  insights(@CurrentAuth() auth: AuthContext) {
    return this.analytics.insights(auth.organizationId);
  }

  @Post('insights/refresh')
  @HttpCode(200)
  @RequirePermission('analytics.view')
  refreshInsights(@CurrentAuth() auth: AuthContext) {
    return this.analytics.refreshInsights(auth.organizationId);
  }

  @Get('forecast')
  @RequirePermission('analytics.view')
  forecast(@CurrentAuth() auth: AuthContext) {
    return this.analytics.forecast(auth.organizationId);
  }

  @Get('dashboard')
  @RequirePermission('lead.view')
  async dashboard(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(querySchema)) q: DashboardQuery) {
    const db = this.handle.db;
    const orgWide = auth.permissions.has('analytics.view');
    const since = new Date(Date.now() - q.days * 86_400_000);
    const leadScope = and(
      eq(leads.organizationId, auth.organizationId),
      isNull(leads.archivedAt),
      orgWide ? undefined : eq(leads.ownerUserId, auth.userId),
    );
    const budget = sql<number>`coalesce(${leads.budget}, 0)`;

    const [totals] = await db
      .select({
        leads: sql<number>`count(*)`,
        open: countWhere(sql`${pipelineStages.outcome} = 'OPEN'`),
        won: countWhere(sql`${pipelineStages.outcome} = 'WON'`),
        lost: countWhere(sql`${pipelineStages.outcome} = 'LOST'`),
        hot: countWhere(sql`${leads.temperature} = 'HOT'`),
        unassigned: countWhere(sql`${leads.ownerUserId} is null`),
        newInPeriod: countWhere(sql`${leads.createdAt} >= ${since}`),
        convertedInPeriod: countWhere(sql`${leads.convertedAt} >= ${since}`),
        wonValue: sql<number>`coalesce(sum(${budget}) filter (where ${pipelineStages.outcome} = 'WON'), 0)`,
        pipelineValue: sql<number>`coalesce(sum(${budget}) filter (where ${pipelineStages.outcome} = 'OPEN'), 0)`,
        weighted: sql<number>`coalesce(sum(${budget} * ${pipelineStages.probability} / 100.0) filter (where ${pipelineStages.outcome} = 'OPEN'), 0)`,
      })
      .from(leads)
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .where(leadScope);

    const now = new Date();
    const [fu] = await db
      .select({
        dueNext24h: countWhere(sql`${followups.scheduledAt} >= ${now} and ${followups.scheduledAt} < ${new Date(now.getTime() + 86_400_000)}`),
        overdue: countWhere(sql`${followups.scheduledAt} < ${now}`),
      })
      .from(followups)
      .where(
        and(
          eq(followups.organizationId, auth.organizationId),
          eq(followups.status, 'PENDING'),
          orgWide ? undefined : eq(followups.assignedUserId, auth.userId),
        ),
      );

    const byStage = await db
      .select({
        id: pipelineStages.id,
        key: pipelineStages.key,
        name: pipelineStages.name,
        color: pipelineStages.color,
        outcome: pipelineStages.outcome,
        count: sql<number>`count(${leads.id})`,
        value: sql<number>`coalesce(sum(${leads.budget}), 0)`,
      })
      .from(pipelineStages)
      .innerJoin(pipelines, and(eq(pipelines.id, pipelineStages.pipelineId), eq(pipelines.isDefault, true)))
      .leftJoin(leads, and(eq(leads.stageId, pipelineStages.id), leadScope))
      .where(eq(pipelineStages.organizationId, auth.organizationId))
      .groupBy(pipelineStages.id)
      .orderBy(asc(pipelineStages.position));

    const bySource = await db
      .select({
        id: leadSources.id,
        name: leadSources.name,
        type: leadSources.type,
        leads: sql<number>`count(*)`,
        won: countWhere(sql`${pipelineStages.outcome} = 'WON'`),
      })
      .from(leads)
      .innerJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .where(leadScope)
      .groupBy(leadSources.id)
      .orderBy(sql`count(*) desc`);

    const result = {
      scope: orgWide ? ('organization' as const) : ('mine' as const),
      periodDays: q.days,
      totals: {
        leads: num(totals?.leads),
        open: num(totals?.open),
        won: num(totals?.won),
        lost: num(totals?.lost),
        hot: num(totals?.hot),
        unassigned: num(totals?.unassigned),
        newInPeriod: num(totals?.newInPeriod),
        convertedInPeriod: num(totals?.convertedInPeriod),
        conversionRate: num(totals?.leads) ? num(totals?.won) / num(totals?.leads) : 0,
        followupsDueNext24h: num(fu?.dueNext24h),
        overdueFollowups: num(fu?.overdue),
      },
      value: { won: num(totals?.wonValue), pipeline: num(totals?.pipelineValue), weightedPipeline: num(totals?.weighted) },
      byStage: byStage.map((s) => ({ ...s, count: num(s.count), value: num(s.value) })),
      bySource: bySource.map((s) => ({ ...s, leads: num(s.leads), won: num(s.won), conversionRate: num(s.leads) ? num(s.won) / num(s.leads) : 0 })),
    };
    if (!orgWide) return result;

    const team = await db
      .select({
        userId: users.id,
        fullName: users.fullName,
        leads: sql<number>`count(${leads.id})`,
        open: countWhere(sql`${pipelineStages.outcome} = 'OPEN'`),
        won: countWhere(sql`${pipelineStages.outcome} = 'WON'`),
      })
      .from(users)
      .leftJoin(leads, and(eq(leads.ownerUserId, users.id), isNull(leads.archivedAt)))
      .leftJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .where(and(eq(users.organizationId, auth.organizationId), eq(users.status, 'ACTIVE')))
      .groupBy(users.id)
      .orderBy(asc(users.fullName));

    return {
      ...result,
      team: team.map((m) => ({ ...m, leads: num(m.leads), open: num(m.open), won: num(m.won), conversionRate: num(m.leads) ? num(m.won) / num(m.leads) : 0 })),
    };
  }
}
