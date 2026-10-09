#!/bin/sh
# Tests the shared-hosting package (release ZIP, #128) the way a web host runs it: Apache with
# .htaccess and mod_php (php:8.3-apache), data directory outside the web root. From outside it runs
# the setup check, the contract tests, the cron entry point and the PWA end-to-end tests.
# Needs Docker, pnpm install and Playwright's Chromium (PW_CHROMIUM_PATH).
# Usage: scripts/webspace-test.sh [release.zip]   (default: builds one with build-php-release.sh)
#   PORT=8081                  port Apache listens on
#   E2E_ARGS='--project=pwa'   arguments for Playwright, e.g. '' for all end-to-end tests
#   DOCKER_NETWORK=host        Linux with a local Docker daemon. Anything else (e.g. bridge, for a
#                              remote Docker host such as the nightly on the NAS) publishes PORT;
#                              then set BASE=http://<docker host>:PORT. The push contract tests
#                              are skipped there: Apache cannot reach the fake push service.
set -eu
cd "$(dirname "$0")/.."

PORT=${PORT:-8081}
E2E_ARGS=${E2E_ARGS---project=pwa}
DOCKER_NETWORK=${DOCKER_NETWORK:-host}
BASE=${BASE:-http://localhost:$PORT}
ZIP=${1:-}
if [ -z "$ZIP" ]; then
  ZIP=$(scripts/build-php-release.sh webspace-test | tail -n 1)
fi

WORK=$(mktemp -d)
NAME=notion-alt-webspace-$$
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

if [ "$DOCKER_NETWORK" = host ]; then
  NETWORK_ARGS='--network host'
  CONTRACT_ARGS=''
else
  NETWORK_ARGS="--network $DOCKER_NETWORK --publish $PORT:$PORT"
  CONTRACT_ARGS='--exclude test/push.test.ts'
fi

# Files are copied in, not bind-mounted, so that a remote Docker host works too.
# shellcheck disable=SC2086 # NETWORK_ARGS is a list of arguments
docker create --name "$NAME" $NETWORK_ARGS -e PORT="$PORT" php:8.3-apache sh -c '
  a2enmod rewrite headers >/dev/null
  # The contract tests fake the push service with this certificate.
  echo "curl.cainfo=/etc/push-receiver.crt" > "$PHP_INI_DIR/conf.d/zz-webspace-test.ini"
  echo "Listen $PORT" > /etc/apache2/ports.conf
  # Outside the web root and writable for Apache, like a folder created over FTP.
  mkdir -p /var/www/notion-data && chown www-data /var/www/notion-data
  exec apache2-foreground' >/dev/null
unzip -q "$ZIP" -d "$WORK"
cp scripts/webspace-test/config.contract.php "$WORK/notion-alt/api/app/config.php"
docker cp -q "$WORK/notion-alt/." "$NAME:/var/www/html/"
docker cp -q scripts/webspace-test/apache.conf "$NAME:/etc/apache2/sites-enabled/000-default.conf"
docker cp -q packages/contract-tests/fixtures/push-receiver.crt "$NAME:/etc/push-receiver.crt"
docker start "$NAME" >/dev/null

i=0
until curl -fsS --max-time 5 "$BASE/api/health" >/dev/null 2>&1; do
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
# Fetched first: a failing request must not look like an empty list of failures.
CHECK=$(curl -fsS --max-time 30 "$BASE/api/check.php")
FAILED=$(printf '%s\n' "$CHECK" | grep '❌' | grep -v COOKIE_SECURE || true)
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
# shellcheck disable=SC2086 # CONTRACT_ARGS is a list of arguments
SERVER_URL=$BASE pnpm --filter @notion-alt/contract-tests test $CONTRACT_ARGS

echo '--- cron'
docker exec -u www-data "$NAME" php /var/www/html/api/app/bin/cron.php

echo '--- end-to-end tests'
docker cp -q scripts/webspace-test/config.e2e.php "$NAME:/var/www/html/api/app/config.php"
# OPcache would keep the old config.php for up to opcache.revalidate_freq (2 s).
sleep 3
# shellcheck disable=SC2086 # E2E_ARGS is a list of arguments
BASE_URL=$BASE pnpm --filter @notion-alt/web exec playwright test $E2E_ARGS

echo 'webspace test passed'
