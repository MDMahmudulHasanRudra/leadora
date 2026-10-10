# Operations and disaster recovery runbook

For a single-host Docker Compose deployment (`docker-compose.yml`, project name `leadora`). Run commands from the
repository root on the host. Secrets come from `.env` and are never committed.

## 1. What runs where

| Service | Role | State |
|---|---|---|
| `proxy` (Caddy) | TLS, security headers, routes `/api` → api, the rest → web | `caddydata` (certificates) |
| `web` (Next.js) | UI | none |
| `api` (NestJS) | REST, WebSocket, public endpoints | none (stateless) |
| `worker` (BullMQ) | messages, automations, webhooks, embeddings, exports, schedulers | none (stateless) |
| `postgres` (pgvector, PG 17) | **source of truth** for everything, including the event outbox | `pgdata` |
| `valkey` | queues, rate limits, realtime fan-out (AOF on, `noeviction`) | `valkeydata` |
| `backup` (profile `backup`) | encrypted dumps + automatic restore test | `backups` |
| `clamav` (profile `clamav`, optional) | upload scanning | none |

Uploaded files (knowledge base, exports) live in the `uploads` volume, or in S3 when `STORAGE_DRIVER=s3`.

**Valkey is not a system of record.** Domain events live in Postgres (`domain_events`) and are re-dispatched from
there. Losing Valkey loses only queued jobs in flight and rate-limit windows (see §5.3).

### Health and signals

- `GET /health/live`: the process is up. `GET /health/ready`: Postgres and Valkey are reachable (api on 3001, worker
  on 3002). Docker healthchecks use these.
- `GET /metrics` (api and worker): Prometheus text format. Set `METRICS_TOKEN` and scrape with
  `Authorization: Bearer <token>`; never expose it publicly. Series: `http_requests_total` and
  `http_request_duration_seconds` (api), `worker_jobs_total` and `worker_job_duration_seconds` (worker),
  `leadora_queue_jobs` (jobs per queue and state) and `leadora_db_pool_connections`.
- Logs: JSON on stdout (`docker compose logs -f api worker`). Each request log carries `requestId`,
  `organizationId`, `userId` and `apiKeyId`. Backup events: `backup.completed`, `restore_test.verified`,
  `backup.cycle_failed`.

- Error tracking: set `ERROR_TRACKING_DSN` (Sentry, or self-hosted GlitchTip) and `APP_RELEASE`. The api reports
  unexpected errors (not 4xx or domain errors), and the worker reports jobs that failed their last attempt and
  unhandled rejections. Reports carry ids and the request path only, capped at 30 per minute per process.

Alert on: `/health/ready` failing, 5xx rate, p95 latency above the §68 targets, growing `leadora_queue_jobs`
(waiting or failed), and **no `restore_test.verified` in 26 hours**.

## 2. Recovery objectives

| | Default | How to improve |
|---|---|---|
| **RPO** (data you can lose) | ≤ `BACKUP_INTERVAL_HOURS` (24 h) | Shorter interval, or Postgres WAL archiving / managed Postgres with point-in-time recovery |
| **RTO** (time to restore service) | ~1 h on a prepared host | Keep a standby host with images pulled and `.env` in place |

The restore drill on 2026-10-10 (§4.3) took seconds for a small database, so RTO is dominated by provisioning and
download time, not by `pg_restore`. Re-measure with production-sized data when it exists.

## 3. Backups

### 3.1 Enable

In `.env`, set `BACKUP_PASSPHRASE` (long and random; **store it in your password manager, not only on this
host**). Optionally set `BACKUP_RETENTION_DAYS` (default 14) and `BACKUP_INTERVAL_HOURS` (default 24). Then:

```bash
docker compose --profile backup up -d backup
```

Each cycle dumps the database (`pg_dump -Fc`) and tars the uploads volume. Both are encrypted with AES-256 and
PBKDF2 (200k iterations), then **restored into a scratch database and checked**: migrations present, pgvector
installed, organizations > 0. Files older than the retention period are pruned.

### 3.2 Take one now

```bash
docker compose --profile backup run --rm backup backup.sh
docker compose --profile backup run --rm backup restore-test.sh
```

### 3.3 Copy off the host

A backup on the same disk is not a backup. Sync the `backups` volume to other storage at least daily, for example
with rclone or `aws s3 sync` from a host cron job. The files are already encrypted.

## 4. Restore (disaster recovery)

Use this after data loss or corruption, or to move to a new host. **This replaces the database.**

### 4.1 Prepare

1. On the target host, check out the same release (or newer) and put the `.env` in place. You need the same
   `DATA_ENCRYPTION_KEY`, or stored channel and AI secrets cannot be decrypted, and the `BACKUP_PASSPHRASE` that
   was in use when the backup was taken.
2. Put the backup files in the `backups` volume:
   ```bash
   docker compose --profile backup run --rm -v "$PWD/restore-from:/in:ro" backup sh -c 'cp /in/leadora-*.enc /backups/ && ls -l /backups'
   ```

### 4.2 Restore

```bash
# 1. Stop everything that writes.
docker compose stop api worker web

# 2. Recreate an empty database (the backup contains the schema, migrations table and extensions).
docker compose exec postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'

# 3. Restore the database, and the uploads with the second argument. The backup service mounts uploads
#    read-only, so files are restored in a one-off container with a writable mount.
docker compose --profile backup run --rm -e CONFIRM_RESTORE=yes \
  -v leadora_uploads:/restore-uploads -e UPLOADS_DIR=/restore-uploads \
  backup restore.sh /backups/leadora-db-<STAMP>.dump.enc /backups/leadora-files-<STAMP>.tar.gz.enc

# 4. Apply any migrations newer than the backup, then start.
docker compose up -d
```

`restore.sh` refuses to run without `CONFIRM_RESTORE=yes`.

### 4.3 Verify

- `curl -fsS localhost:8080/health/ready` (through the proxy) or check `docker compose ps` health.
- Sign in, open a recent lead, and open a knowledge-base document.
- Send a test message on each connected channel. If channel secrets fail to decrypt, the `DATA_ENCRYPTION_KEY` is
  wrong.
- Last drill (2026-10-10, scratch database and volumes): the backup was made by `backup.sh`, restored with
  `restore.sh`, and organizations, inboxes, all 26 migrations, pgvector 0.8.7 and an uploaded file matched the
  source. Without `CONFIRM_RESTORE=yes` it refused (exit 2). **Repeat this drill quarterly**, restoring into a
  scratch database (`PGDATABASE=<scratch>`) so production is untouched.

## 5. Incidents

### 5.1 API or web down

1. `docker compose ps`, then `docker compose logs --tail=200 api`.
2. If `/health/ready` fails, check Postgres and Valkey (§5.2, §5.3). The API refuses to start on invalid config
   and names the variable.
3. `docker compose up -d api web` restarts them. Restarts are safe because the services hold no state.

### 5.2 Postgres down or full

- `docker compose logs postgres`. On "No space left on device", free disk space first. Do **not** delete files
  inside `pgdata`.
- Corruption or loss: restore (§4).
- Exports and processed outbox events are purged by the worker (hourly and daily), so steady growth beyond that
  points at leads, messages or knowledge-base chunks.

### 5.3 Valkey down or data lost

- The API cannot rate-limit or fan out realtime events, so it reports not ready. Restart it with
  `docker compose up -d valkey`.
- If its data is lost, scheduled jobs are recreated when the worker restarts (`docker compose restart worker`).
  Domain events still in `domain_events` are dispatched again. Messages that were queued for sending at that
  moment may not go out. Check recent conversations, and send again where needed.

### 5.4 Worker backlog or failed jobs

- Watch `leadora_queue_jobs` on `/metrics`. Failed automation runs can be retried from the Automations page.
  Webhook endpoints are disabled after 20 consecutive failures and their owner is notified.
- More throughput: `docker compose up -d --scale worker=2`. BullMQ hands each job to one worker, and outbox
  dispatch claims events with `SKIP LOCKED`.

### 5.5 AI provider outage or budget exhausted

- AI features return `AI_NOT_CONFIGURED` or `AI_BUDGET_EXCEEDED`. The CRM keeps working; no core flow waits on AI.
- Turn AI off platform-wide with `ENABLE_AI=false` and a restart, or per organization in Settings → AI.

### 5.6 Suspected account or key compromise

1. Disable the user on the Users page, which revokes all of their sessions, or sign everyone out:
   `docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "update sessions set revoked_at = now() where revoked_at is null"`
2. Revoke API keys in Settings → API keys and rotate outbound webhook secrets in Settings → Webhooks.
3. Rotate the affected server secrets (§6).
4. Review the audit log (`/audit`) and the request logs (`organizationId`, `userId`, `apiKeyId`).

## 6. Secret rotation

| Secret | Effect of changing it | Procedure |
|---|---|---|
| `POSTGRES_PASSWORD` | DB connections | `ALTER USER … PASSWORD …` in psql, update `.env`, then `docker compose up -d` |
| `JWT_SECRET` | Signs website-chat visitor tokens only; open chat widgets start a new session | Update `.env`, restart api |
| `DATA_ENCRYPTION_KEY` | Seals channel, AI, CAPTCHA and webhook secrets at rest | **§6.1**; never change it in `.env` alone |
| `BACKUP_PASSPHRASE` | New backups only | Update `.env`, restart backup. **Keep the old passphrase** until every backup made with it has expired |
| `METRICS_TOKEN` | Scrapers | Update `.env` and the scraper config, restart api and worker |
| Meta app secret / access token, CAPTCHA secret, AI provider key | One integration | Re-enter it in Settings; it is sealed with the current key |

### 6.1 Rotate `DATA_ENCRYPTION_KEY`

```bash
docker compose stop api worker
NEW_DATA_ENCRYPTION_KEY='<new 32+ char random value>' \
  docker compose run --rm --no-deps -e NEW_DATA_ENCRYPTION_KEY worker node dist/rotate-secrets.js
# then set DATA_ENCRYPTION_KEY=<new value> in .env
docker compose up -d
```

The command re-encrypts every `*_enc` column and the sealed keys in inbox configuration in **one transaction**. If
any value does not open with the current key, it changes nothing and names the column. Take a backup first. Old
backups still contain values sealed with the old key, so keep the old key with them.

## 7. Scaling

- **API:** stateless. Sessions are in Postgres; rate limits and realtime fan-out go through Valkey. Measured
  capacity for one process is in [PERFORMANCE.md](PERFORMANCE.md). Running several replicas needs the proxy to
  balance across them; put each replica in Caddy's `reverse_proxy` upstream list or use a `dynamic` upstream.
  This repository has not yet been tested with more than one API replica.
- **Worker:** scale with `--scale worker=N` (§5.4).
- **Uploads across hosts:** switch to `STORAGE_DRIVER=s3`. The local driver only works when all api and worker
  containers share one volume.
- **Postgres:** vertical first (CPU, RAM, fast disk). Then managed Postgres with point-in-time recovery, which also
  improves RPO (§2).
