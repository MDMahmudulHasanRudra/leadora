# ADR-009: Open-source reuse policy

**Decision.** Follow spec §85–87. Permissive dependencies (MIT, BSD, Apache-2.0, PostgreSQL) may be used with notices kept in `THIRD_PARTY_NOTICES.md`. AGPL, BSL, Commons Clause, Sustainable Use License and enterprise-directory code from Frappe CRM, Twenty, EspoCRM, Chatwoot `enterprise/`, Dify, n8n, Outline and NocoBase is reference-only: concepts may be studied, code is not copied. Re-check the LICENSE file before any reuse.

**Consequences.** We build our own core platform. Choosing a new dependency includes a license check, and `pnpm licenses list` is reviewed before each release. This is a technical policy, not legal advice.
