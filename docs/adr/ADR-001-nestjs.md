# ADR-001: NestJS backend

**Context.** The backend spans many modules (CRM, communication, AI, automation) and needs DI, guards, WebSockets and queue integration. The team wants one language across web and API.

**Decision.** NestJS (MIT) on TypeScript with the Express adapter. A Python service (FastAPI) may be added later for specialised ML work. It would sit behind a queue/API boundary and never own business state.

**Consequences.** Shared types and Zod schemas between web, API and worker. NestJS 12 is ESM-only, which shapes the test tooling (ADR-011). Decorator metadata must be emitted (`tsc` / SWC), so esbuild-based runners can't be used for API tests.
