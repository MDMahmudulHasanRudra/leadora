# Architecture

Source of truth for requirements: [AI-LEAD-PLATFORM-SPEC.md](../AI-LEAD-PLATFORM-SPEC.md). This document describes what is **built**.

## Runtime topology

```text
Browser ──► proxy (Caddy :80)
              ├── /api/*  ──► api (NestJS :3001) ──┬──► postgres (pgvector, pg17)
              └── /*      ──► web (Next.js :3000)  │
                               │                   └──► valkey
                               └─ server-side fetch ─► api (internal network)

worker (BullMQ) ──► valkey (queues) ──► postgres (as features land)
migrate (one-shot) ──► postgres     # runs before api/worker start
```

Only `proxy` publishes a port. Postgres and Valkey are internal unless `docker-compose.dev.yml` is layered on, which binds them to `127.0.0.1` for host development.

## Services

| Service | Image target | Health | Notes |
| --- | --- | --- | --- |
| postgres | `pgvector/pgvector:pg17` | `pg_isready` | Extensions `citext`, `vector` created by migration `0000` |
| valkey | `valkey/valkey:8-alpine` | `valkey-cli ping` | AOF on, `noeviction` (queues must not be evicted) |
| migrate | `api` | exits 0 | `node node_modules/@leadora/database/dist/migrate.js` |
| api | `api` | `/health/live` | Non-root, tini PID 1 |
| worker | `worker` | `:3002/health/live` | One BullMQ `Worker` per queue (spec §119) |
| web | `web` | `GET /` | Next.js standalone output |
| proxy | `caddy:2-alpine` | `:8081/healthz` (internal only) | Security headers, compression |

## Monorepo packages

- `@leadora/config`: one Zod schema for all env vars. Services fail fast at boot with variable names only (never values).
- `@leadora/database`: Drizzle schema (`src/schema`), generated SQL migrations (`migrations/`), the `migrate` entry point (demo data: `pnpm db:seed`, see `apps/api/src/seed-demo.ts`). Columns use `snake_case` in SQL and `camelCase` in TS.

Packages compile to CommonJS `dist/`. Apps consume them through `workspace:*`. Run `pnpm build:packages` after changing a package.

## Cross-cutting conventions

- **API prefix**: `/api/v1`. Health routes are excluded from the prefix.
- **Errors** (spec §51): `HttpExceptionFilter` returns `{ error: { code, message, requestId, details? } }` for every error. Throw `new NotFoundException({ code: 'LEAD_NOT_FOUND', message: '...' })` to set a domain code. Unhandled errors return `INTERNAL_ERROR` with no internal detail.
- **Request IDs**: accepted from `x-request-id` if it matches `[A-Za-z0-9._-]{1,128}`, otherwise generated. Echoed in the response header and attached to every log line as `requestId`.
- **Logging**: pino JSON with `timestamp`, `level`, `service`, `requestId`. `authorization`, `cookie` and `set-cookie` are redacted. Health probes are not access-logged.
- **Tenancy** (spec §6): every tenant-scoped table carries `organization_id`. Organization context will come from the authenticated session (Phase 1), never from client input.
- **Queues** (spec §119–120): producers must enqueue with `{ attempts: 4, backoff: { type: 'custom' } }` to get the 1m → 5m → 15m retry schedule. Unknown job names fail loudly.
- **Swagger**: `/api/docs`, disabled when `NODE_ENV=production`.

## Testing

- `packages/config`, `apps/worker`: `node:test` via `tsx`.
- `apps/api`: Vitest with `unplugin-swc`, because esbuild cannot emit the decorator metadata Nest DI needs and NestJS 12 is ESM-only (Jest cannot load it without experimental flags).
- CI runs migrations twice against an empty pgvector database (idempotency) and fails if the schema changed without a committed migration.
