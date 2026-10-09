#!/bin/sh
# Tests the shared-hosting package (release ZIP, #128) the way a web host runs it: Apache with
# .htaccess and mod_php (php:8.3-apache), data directory outside the web root. From outside it runs
# the setup check, the contract tests, the cron entry point and the PWA end-to-end tests.
# Needs Linux (host network), Docker, pnpm install and Playwright's Chromium (PW_CHROMIUM_PATH).
# Usage: scripts/webspace-test.sh [release.zip]   (default: builds one with build-php-release.sh)
#   PORT=8081                  port of the Apache container (host network)
#   E2E_ARGS='--project=pwa'   arguments for Playwright, e.g. '' for all end-to-end tests
set -eu
cd "$(dirname "$0")/.."

PORT=${PORT:-8081}
E2E_ARGS=${E2E_ARGS---project=pwa}
ZIP=${1:-}
if [ -z "$ZIP" ]; then
  ZIP=$(scripts/build-php-release.sh webspace-test | tail -n 1)
fi

WORK=$(mktemp -d)
NAME=notion-alt-webspace-$$
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  # What Apache wrote belongs to its user; remove it inside a container.
  docker run --rm -v "$WORK:/w" php:8.3-apache rm -rf /w/data /w/htdocs >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

unzip -q "$ZIP" -d "$WORK"
mv "$WORK/notion-alt" "$WORK/htdocs"
# Outside the web root, writable for Apache's user like a folder created over FTP.
mkdir "$WORK/data"
chmod 777 "$WORK/data"
cp scripts/webspace-test/config.contract.php "$WORK/htdocs/api/app/config.php"

docker run -d --name "$NAME" --network host -e PORT="$PORT" \
  -v "$WORK/htdocs:/var/www/html" \
  -v "$WORK/data:/var/www/notion-data" \
  -v "$PWD/scripts/webspace-test/apache.conf:/etc/apache2/sites-enabled/000-default.conf:ro" \
  -v "$PWD/packages/contract-tests/fixtures/push-receiver.crt:/etc/push-receiver.crt:ro" \
  php:8.3-apache sh -c '
    a2enmod rewrite headers >/dev/null
    # The contract tests fake the push service with this certificate.
    echo "curl.cainfo=/etc/push-receiver.crt" > "$PHP_INI_DIR/conf.d/zz-webspace-test.ini"
    echo "Listen $PORT" > /etc/apache2/ports.conf
    exec apache2-foreground' >/dev/null

BASE=http://127.0.0.1:$PORT
i=0
until curl -fsS "$BASE/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    docker logs "$NAME"
    echo "Apache did not start" >&2
    exit 1
  fi
  sleep 1
done

echo '--- setup check (api/check.php)'
# Everything green except COOKIE_SECURE, which needs HTTPS.
FAILED=$(curl -fsS "$BASE/api/check.php" | grep '❌' | grep -v COOKIE_SECURE || true)
if [ -n "$FAILED" ]; then
  echo "$FAILED" >&2
  exit 1
fi

echo '--- code and configuration are never served'
for path in /api/app/config.php /api/app/vendor/autoload.php /api/app/bin/console /.htaccess; do
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")
  if [ "$status" != 403 ]; then
    echo "$path: $status instead of 403" >&2
    exit 1
  fi
done

echo '--- contract tests'
SERVER_URL=$BASE pnpm --filter @notion-alt/contract-tests test

echo '--- cron'
docker exec -u www-data "$NAME" php /var/www/html/api/app/bin/cron.php

echo '--- end-to-end tests'
cp scripts/webspace-test/config.e2e.php "$WORK/htdocs/api/app/config.php"
# OPcache would keep the old config.php for up to opcache.revalidate_freq (2 s).
sleep 3
# shellcheck disable=SC2086 # E2E_ARGS is a list of arguments
BASE_URL=http://localhost:$PORT pnpm --filter @notion-alt/web exec playwright test $E2E_ARGS

echo 'webspace test passed'
