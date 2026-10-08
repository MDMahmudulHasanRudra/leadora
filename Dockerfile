# syntax=docker/dockerfile:1.7
# Multi-stage build for all Node services. Targets: api, worker, web.

ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@11.9.0 && npm cache clean --force
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/ai/package.json packages/ai/
COPY packages/storage/package.json packages/storage/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

FROM deps AS build
COPY . .
RUN pnpm build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm --filter @leadora/api deploy --prod --frozen-lockfile --store-dir /pnpm-store /out/api && \
    pnpm --filter @leadora/worker deploy --prod --frozen-lockfile --store-dir /pnpm-store /out/worker

FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini && mkdir -p /data/uploads && chown node:node /data/uploads
ENV NODE_ENV=production
WORKDIR /app
USER node
ENTRYPOINT ["/sbin/tini", "--"]

FROM runtime AS api
COPY --from=build --chown=node:node /out/api /app
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/health/live >/dev/null || exit 1
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker /app
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3002/health/live >/dev/null || exit 1
CMD ["node", "dist/main.js"]

FROM runtime AS web
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
