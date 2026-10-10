import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Inject, type OnModuleDestroy, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Env } from '@leadora/config';
import { type DbHandle } from '@leadora/database';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth-context';
import { DB, ENV } from '../infra/tokens';
import { registry } from './http-metrics';

const QUEUE_NAMES = ['default', 'ai', 'imports', 'exports', 'messages', 'notifications', 'automations', 'embeddings', 'analytics', 'webhooks'];

/**
 * Prometheus scrape endpoint (spec §70). Served outside /api, so Caddy never exposes it; scrape it on the
 * internal network. With METRICS_TOKEN set it also requires `Authorization: Bearer <token>`.
 */
@ApiExcludeController()
@Public()
@Controller('metrics')
export class MetricsController implements OnModuleDestroy {
  private readonly queues: Queue[];
  private readonly queueJobs = registry.gauge('leadora_queue_jobs', 'Jobs per queue and state');
  private readonly dbPool = registry.gauge('leadora_db_pool_connections', 'Postgres pool connections by state');
  private readonly ai = registry.gauge('leadora_ai_calls_24h', 'AI calls in the last 24h by status');
  private readonly aiCost = registry.gauge('leadora_ai_cost_usd_24h', 'Estimated AI cost in the last 24h (USD)');
  private readonly aiLatency = registry.gauge('leadora_ai_latency_p95_ms_24h', 'p95 AI call latency in the last 24h (ms)');
  private readonly failures = registry.gauge('leadora_failures_1h', 'Failed background work in the last hour');

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.queues = QUEUE_NAMES.map((name) => new Queue(name, { connection: { url: env.VALKEY_URL } }));
  }

  async onModuleDestroy() {
    await Promise.allSettled(this.queues.map((q) => q.close()));
  }

  private authorize(req: Request) {
    if (!this.env.METRICS_TOKEN) return;
    const expected = Buffer.from(`Bearer ${this.env.METRICS_TOKEN}`);
    const given = Buffer.from(req.get('authorization') ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Metrics token required' });
    }
  }

  private async collect() {
    await Promise.all(
      this.queues.map(async (q) => {
        const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed').catch(() => null);
        for (const [state, n] of Object.entries(counts ?? {})) this.queueJobs.set({ queue: q.name, state }, n);
      }),
    );
    const pool = this.handle.pool;
    this.dbPool.set({ state: 'total' }, pool.totalCount);
    this.dbPool.set({ state: 'idle' }, pool.idleCount);
    this.dbPool.set({ state: 'waiting' }, pool.waitingCount);

    const { rows } = await this.handle.db.execute<{ status: string; n: number; cost: string | null; p95: number | null }>(sql`
      select status, count(*)::int as n, sum(estimated_cost_usd) as cost,
        percentile_cont(0.95) within group (order by latency_ms) as p95
      from ai_runs where created_at > now() - interval '24 hours' group by status`);
    this.ai.reset();
    for (const r of rows) this.ai.set({ status: r.status }, r.n);
    this.aiCost.set({}, rows.reduce((a, r) => a + Number(r.cost ?? 0), 0));
    this.aiLatency.set({}, Math.max(0, ...rows.filter((r) => r.status === 'SUCCEEDED').map((r) => Number(r.p95 ?? 0))));

    const [f] = (
      await this.handle.db.execute<{ automations: number; webhooks: number; exports: number; kb: number }>(sql`
        select
          (select count(*)::int from automation_runs where status = 'FAILED' and created_at > now() - interval '1 hour') as automations,
          (select count(*)::int from webhook_deliveries where status = 'FAILED' and created_at > now() - interval '1 hour') as webhooks,
          (select count(*)::int from data_exports where status = 'FAILED' and created_at > now() - interval '1 hour') as exports,
          (select count(*)::int from kb_documents where status = 'FAILED' and updated_at > now() - interval '1 hour') as kb`)
    ).rows;
    for (const kind of ['automations', 'webhooks', 'exports', 'kb'] as const) this.failures.set({ kind }, Number(f?.[kind] ?? 0));
  }

  @Get()
  async metrics(@Req() req: Request, @Res() res: Response) {
    this.authorize(req);
    await this.collect().catch(() => undefined);
    res.set('content-type', registry.contentType).send(registry.render());
  }
}
