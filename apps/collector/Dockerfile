# Build-Kontext: Repository-Wurzel (docker build -f apps/collector/Dockerfile .)
FROM node:26-alpine
RUN npm install -g pnpm@9.15.9
WORKDIR /app
ENV NODE_ENV=production \
    HEALTH_PORT=8081
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/collector/package.json apps/collector/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
# Paketmanager (npm, pnpm, yarn, corepack) werden zur Laufzeit nicht gebraucht und bringen eigene CVEs mit.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@hd/collector..." \
    && rm -rf /usr/local/lib/node_modules /opt/yarn-* /root/.cache /root/.npm /root/.local/share/pnpm \
    && find /usr/local/bin -maxdepth 1 \( -name 'np[mx]' -o -name 'pnp[mx]' -o -name 'yarn*' -o -name corepack \) -delete
COPY packages/db packages/db
COPY packages/domain packages/domain
COPY apps/collector/src apps/collector/src
USER node
WORKDIR /app/apps/collector
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8081/health || exit 1
# Node 24 führt TypeScript direkt aus (Type-Stripping), kein Build-Schritt nötig.
CMD ["node", "src/main.ts"]
