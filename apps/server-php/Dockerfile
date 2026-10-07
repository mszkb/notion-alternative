# Build context: repository root (see docker-compose.php.yml).
# Trial image for the PHP backend (ADR 0018): PHP's built-in server with several workers behind
# the existing nginx frontend. The shared-hosting package and final image follow in #128.
FROM composer:2 AS vendor
WORKDIR /app
COPY apps/server-php/composer.json apps/server-php/composer.lock ./
COPY apps/server-php/src ./src
RUN composer install --no-dev --no-interaction --no-progress --prefer-dist --optimize-autoloader --ignore-platform-reqs

FROM php:8.3-cli-bookworm
ENV DATA_DIR=/data \
  PHP_CLI_SERVER_WORKERS=4
WORKDIR /app
COPY apps/server-php/public ./public
COPY apps/server-php/src ./src
COPY --from=vendor /app/vendor ./vendor
RUN mkdir -p /data && chown www-data:www-data /data
USER www-data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["php", "-r", "exit(@file_get_contents('http://127.0.0.1:3000/api/health') === false ? 1 : 0);"]
CMD ["php", "-S", "0.0.0.0:3000", "-t", "public", "public/index.php"]
