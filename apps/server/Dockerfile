# Build context: repository root (see docker-compose.yml).
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @notion-alt/server build
RUN pnpm --filter @notion-alt/server deploy --prod --legacy /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  DATA_DIR=/data
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/server/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
