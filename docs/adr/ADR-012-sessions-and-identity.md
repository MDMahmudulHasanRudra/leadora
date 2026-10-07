# ADR-012: Opaque server sessions and platform-unique email

**Context.** The web app and API share an origin behind Caddy. We need instant revocation (logout, disabled users) and simple login without an organization picker.

**Decision.**
- **Sessions, not JWTs.** A 32-byte random token goes in an `httpOnly`, `SameSite=Lax` cookie (`Secure` unless `COOKIE_SECURE=false`). Only its SHA-256 lives in `sessions`. Default lifetime is 7 days (`SESSION_TTL_HOURS`). Revocation is a row update. `JWT_SECRET` is currently unused and kept for future signed tokens (e.g. webhooks).
- **Email is unique across the platform** (`users_email_unique`). A user belongs to exactly one organization for now. If people later need multiple organizations, we'll add a memberships table, which only relaxes this constraint.
- **Registration** creates an organization only on first run, or when `ALLOW_SIGNUP=true` (SaaS). It's serialized with a Postgres advisory lock so two concurrent first-run requests can't both succeed.
- **Permissions** are code constants (`apps/api/src/auth/permissions.ts`). `roles` and `role_permissions` grant them per organization, and the default roles are seeded on organization creation. There's no `permissions` table: the catalog changes with code, not data.

**Consequences.** Every authenticated request costs one indexed session lookup. Valkey caching can be added if that shows up in profiles. CSRF relies on `SameSite=Lax` plus an `Origin` allowlist on unsafe methods.
