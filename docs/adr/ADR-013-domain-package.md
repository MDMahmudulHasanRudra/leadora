# ADR-013: Framework-free domain package for shared business rules

**Context.** CSV imports run in the worker, but lead ingestion (normalize → validate → dedupe → insert → activity) lived inside NestJS services in the API. Copying the logic into the worker would let the two paths drift apart, and spec §12 requires one ingestion path.

**Decision.** Business rules that more than one process needs live in `packages/domain` (`@leadora/domain`): plain functions over a Drizzle transaction, with no NestJS imports. They raise `DomainError(kind, code, message, details)`. The API's exception filter maps `kind` to HTTP (`invalid` → 422, `conflict` → 409, `not_found` → 404, `forbidden` → 403). The worker calls the same functions directly. Authorization (who may do what) stays in the API; the domain only checks data integrity rules such as same-organization references.

**Consequences.** Lead creation from the UI, CSV, and later webhooks or the public API behaves identically. The domain package is unit-tested with `node:test`; end-to-end behavior is tested through the API's integration suite. HTTP-only concerns (pagination, cursors, response shaping) stay in the API.
