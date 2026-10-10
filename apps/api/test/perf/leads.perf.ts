import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type autocannon from 'autocannon';
import { sql } from 'drizzle-orm';
import { createTestApp, type TestApp } from '../support/app';
import { ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';

// Spec §68: "Targets must be measured, not assumed." Run with `pnpm --filter @leadora/api test:perf`.
// What is measured is the production build (`node dist/main.js`, NODE_ENV=production) in its own process, against
// the test database; the load generator runs in another process. The in-process test app only seeds data.
//
// Two kinds of run (see docs/PERFORMANCE.md):
// - targets: each endpoint at a fixed "normal load" rate, p95 asserted against §68 (coordinated omission corrected,
//   so time spent queueing counts);
// - capacity: each endpoint unthrottled with CONNECTIONS concurrent clients; throughput recorded, not asserted.
const SEED_LEADS = Number(process.env.PERF_SEED_LEADS ?? 5000);
const DURATION_S = Number(process.env.PERF_DURATION_S ?? 10);
const CONNECTIONS = Number(process.env.PERF_CONNECTIONS ?? 10);
/** Multiplies every normal-load rate, e.g. PERF_RATE_SCALE=2 to check headroom. */
const RATE_SCALE = Number(process.env.PERF_RATE_SCALE ?? 1);
const CRUD_P95_MS = 500;
const LIST_P95_MS = 800;
const RUNNER = path.join(__dirname, 'load-runner.mjs');
const API_MAIN = path.join(__dirname, '../../dist/main.js');
/** Set to a directory to write a CPU profile of the API process (open it in Chrome DevTools). */
const PROFILE_DIR = process.env.PERF_PROFILE;

interface Scenario {
  name: string;
  target: number;
  /** Requests per second per API instance under normal load. */
  rate: number;
  path?: string;
  method?: string;
  body?: string;
  /** Request paths used round-robin (filled in once leads are seeded). */
  paths?: 'seeded';
}

// Normal load: a 100-agent organization at a busy moment is roughly one action per agent every few seconds, i.e.
// ~20-30 requests per second across all endpoints. Each scenario below gets that much on its own, so the asserted
// numbers are conservative.
const SCENARIOS: Scenario[] = [
  { name: 'GET /leads', target: LIST_P95_MS, rate: 20, path: '/api/v1/leads' },
  { name: 'GET /leads?q&temperature', target: LIST_P95_MS, rate: 20, path: '/api/v1/leads?q=Company%2012&temperature=HOT' },
  { name: 'GET /leads/:id', target: CRUD_P95_MS, rate: 30, paths: 'seeded' },
  {
    name: 'POST /leads',
    target: CRUD_P95_MS,
    rate: 10,
    method: 'POST',
    path: '/api/v1/leads',
    body: JSON.stringify({ fullName: 'Load Lead', email: 'load-{run}-{n}@perf.test' }),
  },
  // Different leads per request: concurrent writes to one row would only measure row-lock queueing.
  { name: 'PATCH /leads/:id', target: CRUD_P95_MS, rate: 10, method: 'PATCH', paths: 'seeded', body: JSON.stringify({ notes: 'note {n}' }) },
  { name: 'GET /analytics/overview', target: LIST_P95_MS, rate: 5, path: '/api/v1/analytics/overview' },
];

interface Result {
  run: 'target' | 'capacity';
  name: string;
  p50: number;
  p95: number;
  p99: number;
  rps: number;
  errors: number;
}
const results: Result[] = [];

describe('performance (spec §68)', () => {
  let t: TestApp;
  let api: ChildProcess;
  let base: string;
  let cookie: string;
  let seededPaths: string[];

  beforeAll(async () => {
    t = await createTestApp();
    await t.reset();
    const { agent } = await registerAdmin(t);
    const created = await createLead(agent).expect(201);

    // Clone the API-created lead so every seeded row has valid source, pipeline and stage references.
    await t.db.execute(sql`
      insert into leads (organization_id, full_name, email, phone, company_name, source_id, pipeline_id, stage_id,
                         owner_user_id, score, temperature, priority, created_by_user_id, created_at, updated_at)
      select l.organization_id, 'Seed Lead ' || g, 'seed' || g || '@perf.test', null, 'Company ' || (g % 400),
             l.source_id, l.pipeline_id, l.stage_id, l.owner_user_id, g % 101,
             (array['COLD','WARM','HOT'])[1 + g % 3]::lead_temperature,
             (array['LOW','MEDIUM','HIGH','URGENT'])[1 + g % 4]::lead_priority,
             l.created_by_user_id, now() - (g || ' minutes')::interval, now()
      from leads l, generate_series(1, ${SEED_LEADS}) g
      where l.id = ${created.body.id}
    `);
    await t.db.execute(sql`analyze leads`);
    const { rows } = await t.db.execute<{ id: string }>(sql`select id from leads where email like 'seed%' limit 2000`);
    seededPaths = rows.map((r) => `/api/v1/leads/${r.id}`);
    cookie = agentCookie(agent);

    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const profile = PROFILE_DIR ? ['--cpu-prof', `--cpu-prof-dir=${PROFILE_DIR}`, '-r', path.join(__dirname, 'exit-on-message.cjs')] : [];
    api = spawn(process.execPath, [...profile, API_MAIN], {
      env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info', PORT: String(port), RATE_LIMIT_API_PER_MIN: '100000' },
      stdio: ['ignore', 'ignore', 'inherit', ...(PROFILE_DIR ? (['ipc'] as const) : [])],
    });
    await waitForReady(`${base}/health/ready`);
  }, 300_000);

  afterAll(async () => {
    if (results.length) console.table(results);
    if (api && PROFILE_DIR) {
      const exited = new Promise((resolve) => api.once('exit', resolve));
      api.send('exit');
      await exited;
    } else api?.kill();
    await t?.close();
  });

  /** Runs the load generator for one scenario; overallRate undefined = as fast as CONNECTIONS clients can go. */
  async function drive(s: Scenario, duration: number, overallRate: number | undefined): Promise<autocannon.Result> {
    const headers: Record<string, string> = { cookie, origin: ORIGIN };
    if (s.body) headers['content-type'] = 'application/json';
    const specFile = path.join(mkdtempSync(path.join(tmpdir(), 'leadora-perf-')), 'spec.json');
    writeFileSync(
      specFile,
      JSON.stringify({
        url: base + (s.path ?? ''),
        connections: CONNECTIONS,
        duration,
        overallRate,
        headers,
        method: s.method,
        // Unique per run, so created leads never collide with an earlier run's (which would be a 409).
        body: s.body?.replaceAll('{run}', randomUUID().slice(0, 8)),
        paths: s.paths === 'seeded' ? seededPaths : undefined,
      }),
    );
    const { stdout } = await promisify(execFile)(process.execPath, [RUNNER, specFile], { maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(stdout) as autocannon.Result;
  }

  async function load(run: Result['run'], s: Scenario): Promise<Result> {
    // Warm up first (unmeasured): a long-running API process has its hot paths compiled already.
    await drive(s, 3, run === 'target' ? s.rate : undefined);
    const out = await drive(s, DURATION_S, run === 'target' ? Math.max(1, Math.round(s.rate * RATE_SCALE)) : undefined);
    const r = {
      run,
      name: s.name,
      p50: out.latency.p50,
      p95: percentile95(out),
      p99: out.latency.p99,
      rps: Math.round(out.requests.average),
      errors: out.errors + out.non2xx,
    };
    results.push(r);
    if (r.errors) console.error(s.name, JSON.stringify({ errors: out.errors, timeouts: out.timeouts, statusCodes: out.statusCodeStats }));
    return r;
  }

  it.each(SCENARIOS)('$name meets its p95 target under normal load', async (s) => {
    const r = await load('target', s);
    expect(r.errors).toBe(0);
    expect(r.p95).toBeLessThan(s.target);
  });

  it.each(SCENARIOS)('$name: saturation throughput (recorded)', async (s) => {
    const r = await load('capacity', s);
    expect(r.errors).toBe(0);
  });
});

/** autocannon reports p90 and p97.5 but not p95; interpolate between them. */
function percentile95(out: autocannon.Result): number {
  const { p90, p97_5 } = out.latency;
  return Math.round(p90 + ((p97_5 - p90) * (95 - 90)) / (97.5 - 90));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForReady(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const ok = await fetch(url).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`API did not become ready at ${url}`);
}

function agentCookie(agent: unknown): string {
  // supertest agents keep cookies in a cookiejar; serialize them for the load generator.
  const jar = (agent as { jar: { getCookies(opts: unknown): { name: string; value: string }[] } }).jar;
  return jar
    .getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}
