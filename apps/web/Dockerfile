# Build-Kontext: Repository-Wurzel (docker build -f apps/web/Dockerfile .)
FROM node:24-alpine AS base
RUN npm install -g pnpm@9.15.9
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/collector/package.json apps/collector/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/

FROM base AS build
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm --filter @hd/web exec svelte-kit sync && pnpm --filter @hd/web build

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@hd/web..." \
    && npm uninstall -g pnpm && rm -rf /root/.cache /root/.local/share/pnpm
COPY packages/db packages/db
COPY packages/domain packages/domain
COPY apps/web/scripts apps/web/scripts
COPY apps/web/src/lib/server apps/web/src/lib/server
COPY --from=build /app/apps/web/build apps/web/build
USER node
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "build/index.js"]
