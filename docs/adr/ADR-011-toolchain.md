# ADR-011: Toolchain versions and test runners

**Context (2026-10).** TypeScript 7 (native compiler) is `latest`, but typescript-eslint supports `<6.1`. NestJS 12 ships ESM-only. Jest 30 can't `require` ESM without experimental VM flags.

**Decision.**
- TypeScript pinned to `~6.0` with `module`/`moduleResolution: NodeNext` and explicit `types: ["node"]`. Revisit when typescript-eslint supports TS 7.
- Node 24 LTS, pnpm 11. Build scripts are allow-listed in `pnpm-workspace.yaml` (`@scarf/scarf` telemetry denied).
- API tests: Vitest + `unplugin-swc` (decorator metadata). Packages and worker: `node:test` + `tsx`.
- Services compile to CommonJS and load ESM dependencies through Node's native `require(esm)`.

**Consequences.** Upgrading TS 7 is a single coordinated change. ESLint is configured with `emitDecoratorMetadata` for `apps/api`, so `consistent-type-imports` never turns DI-injected classes into type-only imports.
