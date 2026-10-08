# Build context: repository root (see docker-compose.php.yml).
# PHP backend (ADR 0018, #128): PHP-FPM on port 9000. The frontend container (nginx with the SPA)
# talks FastCGI to it, so the stack stays at two containers (ADR 0010). Official PHP images have
# pdo_sqlite (with FTS5), curl, openssl, mbstring and sodium built in, also for linux/arm64.
FROM composer:2 AS vendor
WORKDIR /app
COPY apps/server-php/composer.json apps/server-php/composer.lock ./
COPY apps/server-php/src ./src
RUN composer install --no-dev --no-interaction --no-progress --prefer-dist --optimize-autoloader --ignore-platform-reqs

FROM php:8.3-fpm-bookworm
RUN docker-php-ext-enable opcache \
  && mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"
COPY apps/server-php/docker/php.ini "$PHP_INI_DIR/conf.d/zz-notion-alt.ini"
COPY apps/server-php/docker/fpm-pool.conf /usr/local/etc/php-fpm.d/zz-notion-alt.conf
COPY apps/server-php/docker/entrypoint.sh /usr/local/bin/notion-alt-entrypoint
ENV DATA_DIR=/data
WORKDIR /app
COPY apps/server-php/public ./public
COPY apps/server-php/src ./src
COPY apps/server-php/bin ./bin
COPY --from=vendor /app/vendor ./vendor
RUN mkdir -p /data && chown www-data:www-data /data
USER www-data
VOLUME ["/data"]
EXPOSE 9000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["php", "bin/fpm-healthcheck.php"]
ENTRYPOINT ["notion-alt-entrypoint"]
CMD ["php-fpm", "--nodaemonize"]
