# ADR-006: Shared-schema multi-tenancy

**Context.** The product may become SaaS (spec §6, §114). Retrofitting tenancy later is a large migration.

**Decision.** One database and one schema. Every tenant-scoped table has a non-null `organization_id` FK, and composite unique constraints lead with it (e.g. `users(organization_id, email)`). Organization context is resolved from the authenticated session, never from request input. Postgres Row-Level Security will be evaluated in Phase 1 as defense in depth on top of service-layer scoping.

**Consequences.** Tenant-scoped indexes should lead with `organization_id`. Cross-tenant admin queries must be explicit platform-level operations. Cache keys must include `organization_id` (spec §125).
