# Implementation Plan

Follows spec §103–§114 and the sprint backlog in §148. Each phase is done only when its acceptance criteria pass and the Definition of Done (spec §0) is met.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation: monorepo, Docker, CI, config, Postgres, Valkey, migrations, logging, health, basic web/API | **Done** (verified locally 2026-10-08; CI not yet run on GitHub) |
| 1 | CRM MVP: auth, organizations, users, teams, RBAC, leads, contacts, companies, pipeline, assignment, follow-ups, tasks, notes, activities, dashboard | **Done** (2026-10-08) |
| 2 | Communication: inbox, conversations, messages, realtime, email adapter, webhooks | Not started |
| 3 | AI foundation: provider abstraction, OpenAI Responses API, settings, usage logging, prompt versioning, structured outputs | Done |
| 4 | AI intelligence: scoring, conversation analysis, summaries, reply assistant, next action, NL search | Done |
| 5 | Knowledge base / RAG with pgvector and citations | Not started |
| 6 | Automation engine | Not started |
| 7 | Integrations: WhatsApp, Facebook, Instagram, web chat, API keys | Not started |
| 8 | Analytics & forecasting | Not started |
| 9 | Production hardening | Not started |
| 10 | SaaS | Not started |

## Phase 0 checklist

- [x] pnpm monorepo (`apps/api`, `apps/worker`, `apps/web`, `packages/config`, `packages/database`)
- [x] Env validation (`@leadora/config`) with tests
- [x] Drizzle migrations: `organizations`, `users`, `citext` + `vector` extensions
- [x] NestJS API: `/health`, `/health/live`, `/health/ready`, error contract, request IDs, JSON logs, Swagger in non-prod
- [x] Worker: BullMQ queues per spec §119, retry schedule §120, health server, graceful shutdown
- [x] Next.js web shell with spec §96 navigation and live system status
- [x] Multi-stage Dockerfile (non-root, tini), Compose with healthchecks, one-shot migrations, Caddy proxy
- [x] CI: lint, typecheck, tests, migration check, drift check, build, Docker smoke test
- [x] ADRs 001–011
- [x] `docker compose up -d --build --wait` from empty volumes: all 7 services healthy, migrations idempotent, seed works, a worker job round-trips, UI shows live status through Caddy
- [ ] CI green on GitHub (no remote configured yet)
- [ ] `THIRD_PARTY_NOTICES.md` generated from `pnpm licenses list --prod` (Phase 0 follow-up)

## Phase 1 / Sprint 2 — Auth, tenancy, RBAC

### Threat model (STRIDE over the auth boundary)

Trust boundaries: HTTP body/cookies/headers (incl. `Origin`, `X-Forwarded-For` from Caddy), the first-run registration endpoint.

| Threat | Abuse case | Mitigation | Test |
| --- | --- | --- | --- |
| Spoofing | Credential stuffing / brute force | Argon2id; Valkey-backed limiter: 10 failed attempts / 15 min per IP+email | 11th attempt → 429 |
| Spoofing | User enumeration via login | Same `INVALID_CREDENTIALS` for unknown email and wrong password; dummy hash verify | unknown vs wrong pw identical |
| Spoofing | Stolen session token | 32-byte random token, only SHA-256 stored; `httpOnly`, `SameSite=Lax`, `Secure` (configurable); 7-day expiry; logout revokes | logout → `/me` 401 |
| Tampering | CSRF on state-changing routes | `SameSite=Lax` + `Origin` allowlist (`APP_ORIGINS`) on non-GET | bad Origin → 403 |
| Repudiation | Denying an admin action | `audit_logs` row written in the same transaction | audit entries exist |
| Info disclosure | Password hash or other tenant data in responses | Response DTO allowlists; org id only from session | cross-org → 404 |
| DoS | Huge passwords to burn CPU | Password 12–128 chars, body limit 100 kB | 129 chars → 422 |
| Elevation | Agent creates admins / open org registration | Permission guard on every route (deny by default); registration only on first run or `ALLOW_SIGNUP=true` (advisory lock) | agent → 403; 2nd register → 403 |
| Elevation | Disabled user keeps access | Disabling revokes all sessions; login refused | disabled → 401 |

Deferred to Phase 2 (needs the email adapter): email verification, password reset, invitations.

**Status (2026-10-08):** slices 1–9 are done and committed. There are 50 API integration tests against real Postgres and Valkey, covering every row of the threat model above, plus a mutation check proving the cross-tenant test catches a missing organization filter. The UI was verified in a browser: setup, validation errors, user and team management, audit log, agent permissions, sign-out redirect, mobile width, and a clean console.

Follow-ups noted, not done:
- Mobile navigation is a horizontal scroller; a collapsible menu would be better once the lead pages exist.
- Audit entries show raw user ids for membership changes; resolve them to names.
- Users can't yet change their own password or timezone (needs a profile page).

### Slices (each: failing test → code → green suite → commit)

1. Integration test harness (real Postgres `leadora_test` + Valkey db 15)
2. Schema: `roles`, `role_permissions`, `user_roles`, `sessions`, `audit_logs`; global unique email (ADR-012)
3. First-run registration → org + default roles + admin + session
4. Login / logout / me, with rate limiting and Origin check
5. Auth guard (deny by default) + `@RequirePermission` + tenant context
6. Users admin API: list, create, update role/status (disable revokes sessions)
7. Teams API: CRUD + members
8. Audit log API
9. Web: login, first-run setup, authenticated shell, users & teams pages

## Phase 1 / Sprint 3 — Leads

### Decisions

- Every organization gets a **default pipeline** (spec §16 stages) and **default lead sources** at creation. A migration backfills existing organizations.
- A lead's lifecycle status *is* its pipeline stage. There's no separate `status` column to drift out of sync.
- Every ingestion path (manual form now; CSV, webhook and API later) goes through one `ingestLead` function: **normalize → validate → deduplicate → insert → activity** (spec §12).
- **Dedup** for now matches exact normalized email and exact normalized phone within the organization. A duplicate is never silently dropped: manual create returns 409 with the existing lead id. Fuzzy matching and merge come later.
- **Phones** are normalized to E.164 with `libphonenumber-js`, using the organization's default country (`BD` unless changed).
- **Ownership:** a new lead is owned by its creator unless `ownerUserId` is given. Giving the lead to someone else needs `lead.assign`.
- **Visibility:** anyone with `lead.view` sees all of the organization's leads; "My leads" is a filter. Row-level visibility (agents see only their own) is a product decision to confirm before Phase 2.
- **Delete = archive** (`archived_at`). Leads are never hard-deleted from the API (spec §9, §13).
- **Company** stays free text on the lead (`company_name`) until lead conversion creates Company and Contact records in Sprint 4.

### Threat model additions

| Threat | Abuse case | Mitigation | Test |
| --- | --- | --- | --- |
| Elevation | Agent assigns leads to others | `lead.assign` required for any owner other than self | agent → 403 |
| Info disclosure | Reading or editing another org's lead, stage, tag or owner by id | every lookup scoped by `organization_id`; owner, stage and source ids validated in the same org | cross-org → 404 / 422 |
| Tampering | Moving a lead to a stage of another pipeline | stage must belong to the lead's pipeline | 422 |
| DoS | Huge search strings or page sizes | `q` ≤ 100 chars, `limit` ≤ 100 | 422 |
| Injection | Search text with SQL wildcards or quotes | parameterized `ILIKE` with `%`/`_` escaped | search for `%` matches literally |
| DoS | Huge CSV or row flood | ≤ 5 MB per file, ≤ 20,000 rows, ≤ 100 columns, checked on upload | 6 MB → 413 |
| Tampering | Malformed CSV (bad quotes, binary data) | strict parser; upload rejected with `INVALID_CSV` | garbage → 422 |
| Integrity | Worker crash mid-import re-imports rows | each row and its progress checkpoint commit in one transaction; retries resume from the checkpoint | process twice → same counts |
| Injection | Spreadsheet formula in the error report (`=HYPERLINK(…)`) | cells starting `= + - @` are prefixed with `'` | report cell escaped |
| Elevation | Import as another tenant or with a foreign owner | import rows bound to the uploader's organization; owner validated in the same org | cross-org → 404 / 422 |

### Slices

1. Schema + organization initialization: pipelines, stages, sources (with backfill)
2. Create lead via `ingestLead`, plus get lead, with a `lead.created` activity
3. List leads: filters (stage, owner incl. `me`/`unassigned`, source, tag, temperature, search) + cursor pagination
4. Update lead: fields, stage, owner, tags; archive; activities for each change
5. Web: leads list with filters, create form, lead detail with timeline
6. CSV import with a per-row report: upload → column mapping → queued job → worker runs `processLeadImport` from `@leadora/domain`, row by row through `ingestLead`
7. Custom fields

**Status (2026-10-08):** Sprint 3 is complete (slices 1–7, including custom fields with a settings UI). Verified with 94 API integration, 17 domain and 4 worker tests, plus mutation checks on LIKE escaping and formula escaping. In the browser: create, duplicate warning, edit, clear a field, stage and owner changes, archive, filters, and a full CSV import through the real worker.

Follow-ups noted, not done:
- Uploaded CSV content is stored in Postgres (≤ 5 MB); move it to object storage when the storage provider lands, and purge it after the import finishes.
- Import retries are safe, but the stale-job case (worker killed mid-row with no retry left) leaves status `PROCESSING`; a periodic sweeper should mark old ones `FAILED`.

## Phase 4 — AI sales intelligence

Slices: (1) hybrid scoring ✅ · (2) conversation analysis + summary ✅ · (3) reply assistant ✅ · (4) next action ✅ · (5) natural-language CRM search ✅.

### Decisions

- **Hybrid scoring** (spec §14–15): pure rule engine in `packages/domain/scoring` (business email, phone, budget, inbound message, pricing/demo intent in English and Bangla, reply within 24h, no response after 2+ touches). Points, the rule/AI blend and the temperature thresholds are org settings; only overrides are stored, so new rules reach existing orgs. Leads keep `rule_score`, `ai_score` and a `score_breakdown`, so every score is explainable in the UI.
- **When scores move:** `rescoreLeads` runs in the same transaction as every change that can affect it (create/import/inbound lead, edit, message sent or received, follow-up completed, AI analysis). It is cheap and idempotent. A settings change queues one `scoring.rescore_org` job (deduped by jobId). On boot the worker queues any org with unscored leads, which backfills leads that predate scoring.
- **AI never sets the score directly:** an analysis writes `ai_score`, and the blend decides. Setting the AI weight to 0 gives rules-only scoring. The latest AI view wins, whether it came from a lead or a conversation analysis.
- **Conversation analysis** (spec §31) stores the structured result in `ai_analyses` and shows the summary in the inbox. Internal notes are included as context.
- **Reply assistant** (spec §32): suggest, rewrite, translate (English/Bangla). It only fills the composer and nothing is stored or sent. Internal notes are excluded so they can never leak into a customer reply. Missing facts become `[placeholders]`, and the UI warns before a reply with placeholders is sent. Messages sent from an AI draft are flagged `aiGenerated` and shown as "AI-assisted". Auto-reply (sending without a human) stays off; it needs the policy engine in Phase 6.
- **Next action:** lead analysis proposes one concrete follow-up (type, hours from now, note). "Schedule it" turns it into an ordinary follow-up through the normal API with the user's permissions. AI never writes it on its own (spec §39: reversible writes need approval).
- **AI Assistant** (spec §38–39) works in three steps: question → plan → permission check → read-only tool → summary. The planner fills a strict, typed plan (one of five tools, with nullable filters). The server checks the tool's permission and builds the tenant-scoped query, so the model never writes SQL or sees data the user can't. The summary call sees only the returned rows, and is skipped when nothing matched. Writes and anything else come back as `unsupported`. Every question, plan and outcome is stored in `ai_assistant_queries`, which is both the audit trail and the user's history.

### Threat model additions

| Threat | Abuse case | Mitigation | Test |
| --- | --- | --- | --- |
| Elevation | Agent games scoring to jump the queue | scoring settings need `settings.manage` | agent → 403 |
| Tampering | Customer writes "price" to inflate a score | rules are capped and explainable; managers see the breakdown | breakdown lists every rule applied |
| Tampering | Customer message tells the model to "mark me HOT" | thread passed as a data block; output schema-validated; AI score is only half the blend | injection text in the test thread |
| Info disclosure | Internal note leaks into an AI-drafted customer reply | reply input excludes INTERNAL messages | — (by construction) |
| Elevation | Agent asks the assistant for team or revenue data | tool permission checked before it runs; the model is not called again | agent → DENIED, no tool run |
| Tampering | Question asks the assistant to delete or change data | only read-only tools exist; anything else is `unsupported` | delete request → UNSUPPORTED |
| Info disclosure | Assistant returns another tenant's leads | every tool scopes by organization in code | rival's hot lead absent |

## Phase 3 — AI foundation

### Decisions

- **`packages/ai`** holds the `AiProvider` interface (`generateStructured`, `generateText`, `embed`) and an `OpenAiProvider` that calls the Responses and Embeddings HTTP APIs directly with `fetch`. That gives timeouts, retries on 429/5xx, and no SDK version drift. Business code never imports a provider (spec §2.3, rule 3).
- **One gateway, `runStructured`** (`packages/domain`), for every structured call: platform `ENABLE_AI`, then org settings (enabled and feature on), then monthly budget (block at 100%, spec §75), then the active prompt version, then provider, then Zod validation with one corrective retry (spec §30), then an `ai_runs` row (tokens, cached tokens, estimated cost, latency, status, error code, prompt version). A failed, blocked or invalid call never writes business data.
- **Models** are logical profiles (`fast`, `balanced`, `reasoning`, `embedding`) mapped to model IDs in org settings (spec §123). Nothing is hard-coded. Prices per model are also org settings; if a price is missing, the cost is recorded as unknown rather than guessed.
- **API key** is AES-GCM encrypted (`DATA_ENCRYPTION_KEY`). GET returns only `hasApiKey` and the last 4 characters (spec §74).
- **Prompts** are versioned in `ai_prompt_versions` (one active per org and key). The built-in prompt ships in code as version 0 and is used until a version is activated; activating 0 reverts to it (spec §29).
- **Lead analysis runs synchronously** on request (one call, typically a few seconds), so the UI shows the result immediately. Bulk and automatic analysis go through the `ai` queue in Phase 4.
- **Connection test** makes one tiny `fast`-profile text call and logs it as `connection_test`, so admins can check the key before switching AI on.
- **Prompt injection** (spec §56–57): CRM data and messages go into the input as delimited, labelled data blocks. The system prompt says that content is data, not instructions. Tools and authorization stay in code.
- **AI is optional:** every AI endpoint fails fast with `AI_PLATFORM_DISABLED` (ENABLE_AI off) / `AI_DISABLED` (org switch) / `AI_NOT_CONFIGURED`, and the CRM never depends on it (spec §121).

### Threat model additions

| Threat | Abuse case | Mitigation | Test |
| --- | --- | --- | --- |
| Info disclosure | API key leaked through settings API or logs | encrypted at rest, masked on read, never logged | key absent from responses and DB column |
| Elevation | Agent changes AI provider or budget | `ai.configure` required | agent → 403 |
| Tampering | Prompt injection inside lead/message text | data blocks + instruction hierarchy; output schema-validated; no tool execution in Phase 3 | injected text cannot change stored fields outside the schema |
| DoS / cost | Runaway spend | monthly budget block, `ai` queue concurrency, max output tokens per purpose | over budget → 409 `AI_BUDGET_EXCEEDED` |

## Phase 2 — Communication

### Decisions

- **Model** (spec §21–23): `inboxes` (one per channel account) → `conversations` (thread with one lead) → `messages` (`INBOUND` / `OUTBOUND` / `INTERNAL`). Core code talks to a `ChannelProvider` interface only.
- **Outbound** messages are persisted as `QUEUED` first, then sent by the worker (`messages` queue). Their status moves to `SENT` or `FAILED`, so the UI never waits on SMTP.
- **Email** uses SMTP via nodemailer (MIT). Locally, mail goes to a Mailpit container (MIT) so sending can be verified. Inbound email arrives as a signed JSON webhook from whatever mail relay is used.
- **Webhooks** (spec §53): verify the HMAC signature, then an idempotency check on (inbox, provider message id), then persist the raw event, then queue it. No heavy work happens inside the HTTP handler.
- **Unknown inbound senders** become leads through `ingestLead` (source `EMAIL`, auto-assigned by rules). Replies thread by `In-Reply-To`/`References`, falling back to the lead's open conversation in that inbox.
- **Channel secrets** (webhook signing secrets, later provider tokens) are encrypted at rest with AES-256-GCM, using a key from `DATA_ENCRYPTION_KEY`.
- **Realtime** uses WebSockets authenticated by the session cookie. API and worker publish events on Valkey pub/sub, and each API instance fans them out to its sockets. State is always persisted first (spec §24).

### Threat model additions

| Threat | Abuse case | Mitigation | Test |
| --- | --- | --- | --- |
| Spoofing | Forged inbound webhook | HMAC-SHA256 over the raw body plus a timestamp (5 min window), compared in constant time | bad signature → 401 |
| Tampering | Replayed webhook | timestamp window plus unique (inbox, message id) | same delivery twice → one message |
| Info disclosure | Reading another org's conversation, or subscribing to its socket room | every query org-scoped; socket rooms derived from the session, never from client input | cross-org → 404 |
| Injection | HTML email with scripts | stored as text; HTML is never rendered unsanitized (text view only for now) | — |
| Elevation | Agent replies on conversations they can't see | `conversation.reply` required, conversation scoped to org | viewer → 403 |
| DoS | Webhook flood | per-inbox rate limit; body ≤ 1 MB | — |

**Status (2026-10-08): done.** Verified end to end through Caddy: a signed inbound email created a lead and an unread conversation (a bad signature got 401), an agent replied from the inbox, the worker delivered a threaded email (`Re:` plus `In-Reply-To`) to Mailpit, and the page updated live over the WebSocket.

Follow-ups noted, not done:
- Inbound HTML-only emails need an HTML→text step in the relay or the API (we store text).
- Attachments wait for object storage (Phase 5).
- Notifications created inside API transactions reach the browser on the next poll (≤ 60 s) or socket event; a transactional outbox (spec §118) would make them instant.

## Phase 1 / Sprint 4 — Pipeline, assignment, follow-ups

Pipeline Kanban, assignment rules, follow-ups, tasks, notes, lead conversion to Contact + Company, dashboard metrics.

**Status (2026-10-08): done.** Acceptance met and verified in the browser. A lead was created, moved on the Kanban by drag-and-drop, given a note and a follow-up, the follow-up completed with an outcome, then the lead was converted to a contact, all without database intervention.

Decisions:
- Notes are immutable timeline activities (
ote.added), not a separate editable table.
- Tasks and contacts/companies reuse existing permission keys (ollowup.*, lead.*); the spec defines no 	ask.* or contact.* keys.
- Opportunities are not a separate entity yet. Forecasting uses lead budget × stage probability (spec §46).
- Assignment rules apply to automatic intake (CSV with auto-assign; webhooks/API later) and on demand; manual entry keeps the creator as owner.
- The dashboard's follow-up metric is "due in the next 24 hours" plus "overdue", which avoids timezone edge cases around "today".

Acceptance (Phase 1): a user can take a lead from creation to conversion without manual database intervention.
