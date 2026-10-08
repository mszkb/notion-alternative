# Build context: repository root (see docker-compose.yml).
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @notion-alt/web...
RUN pnpm --filter @notion-alt/web build

FROM nginx:1.29-alpine
# nginx.php.conf talks FastCGI to the PHP backend (docker-compose.php.yml).
ARG NGINX_CONF=apps/web/nginx.conf
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
COPY apps/web/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1/healthz"]
