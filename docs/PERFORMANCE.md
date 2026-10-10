# Performance

Spec §68: API p95 < 500 ms for normal CRUD, list endpoints p95 < 800 ms, "measured, not assumed".

## How it is measured

```bash
pnpm --filter @leadora/api test:perf
```

[`apps/api/test/perf/leads.perf.ts`](../apps/api/test/perf/leads.perf.ts) builds the API and seeds the test database:
one organization with 5,000 leads (`PERF_SEED_LEADS`). It then starts the **production build** (`node dist/main.js`,
`NODE_ENV=production`, info-level logging) as its own process. The load comes from [autocannon](https://github.com/mcollina/autocannon)
(MIT), run in a third process so the load generator never shares the API's event loop. Every scenario first gets
3 s of unmeasured warm-up, because a long-running server has its hot paths compiled already.

Two kinds of run:

| Run | Load | Asserted |
|---|---|---|
| **target** | Fixed rate ("normal load"): 20 req/s per list endpoint, 30 req/s single-lead reads, 10 req/s writes, 5 req/s analytics. Coordinated omission is corrected, so time spent queueing counts. | p95 under the §68 target, no errors |
| **capacity** | Unthrottled, 10 concurrent clients | No errors; throughput is recorded |

"Normal load" assumes a 100-agent organization at a busy moment, which is about one action per agent every few
seconds, or 20–30 req/s across *all* endpoints. Each scenario gets roughly that much on its own, so the asserted
numbers are conservative. Use `PERF_RATE_SCALE=2` to test with double the rates. `PERF_DURATION_S` and
`PERF_CONNECTIONS` change the run length and the capacity-run concurrency. `PERF_PROFILE=<dir>` writes a CPU
profile of the API process.

## Results (2026-10-10)

Measured on the development machine: a Windows 11 laptop, with Postgres and Valkey in Docker Desktop (about 3 ms per
database round trip). The rest of the stack was running at the same time. A CPU micro-benchmark (10M square roots) took 96 ms
here; by our estimate that is several times slower than a current server CPU. Treat these numbers as a pessimistic
bound for one API process.

| Run | Endpoint | p50 ms | p95 ms | p99 ms | req/s | Target |
|---|---|---:|---:|---:|---:|---|
| target | `GET /leads` (page 1) | 40 | 90 | 107 | 20 | < 800 ✅ |
| target | `GET /leads?q=…&temperature=HOT` | 37 | 74 | 83 | 20 | < 800 ✅ |
| target | `GET /leads/:id` | 25 | 52 | 60 | 30 | < 500 ✅ |
| target | `POST /leads` | 59 | 125 | 151 | 10 | < 500 ✅ |
| target | `PATCH /leads/:id` | 42 | 92 | 99 | 10 | < 500 ✅ |
| target | `GET /analytics/overview` | 17 | 37 | 45 | 5 | < 800 ✅ |
| capacity | `GET /leads` | 107 | 142 | 154 | 90 | — |
| capacity | `GET /leads?q=…&temperature=HOT` | 86 | 113 | 125 | 112 | — |
| capacity | `GET /leads/:id` | 53 | 73 | 85 | 179 | — |
| capacity | `POST /leads` | 140 | 187 | 198 | 68 | — |
| capacity | `PATCH /leads/:id` | 114 | 155 | 170 | 92 | — |
| capacity | `GET /analytics/overview` | 75 | 106 | 121 | 128 | — |

Each request makes few queries: 5 for a lead read (session, identity, lead, tags, custom fields) and 20 for a lead
creation inside one transaction (validation, dedupe lock, insert, timeline, scoring, outbox event, response). At
saturation the API process is CPU-bound, and about 40% of its CPU goes to building SQL in Drizzle.

## What the measurement changed

- **Analytics overview:** the daily series ran two correlated subqueries per day, which meant 60 scans of `leads`
  for a 30-day view. Under 10 concurrent clients that took about 10 s per request. It is now one grouped pass per
  measure, which brings the query from 219 ms to 11.5 ms on 5k leads. Overview saturation throughput went from
  timing out to 128 req/s.
- **Auth guard:** it built an `UnauthorizedException` on every request, capturing a stack trace, in case one was
  needed. It is now built only when thrown.

## Known limits and next steps

- One API process tops out around 70–180 req/s on this machine, depending on the endpoint. The API is stateless:
  sessions live in Postgres, and rate limits and realtime fan-out go through Valkey. Scaling out means more API
  replicas (see [RUNBOOK.md](RUNBOOK.md#scaling)).
- If CPU per request becomes the limit, the next steps are prepared statements for the per-request auth queries
  (session and identity) and the lead read, which skip SQL building entirely.
- `GET /leads` pages with a keyset cursor, so deep pages cost about the same as page 1. The `q` text search has not
  been profiled beyond 5k leads per organization. For much larger organizations, rerun with a larger
  `PERF_SEED_LEADS` and check its plan.
