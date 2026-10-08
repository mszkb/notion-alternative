#!/bin/sh
# Builds the shared-hosting package of the PHP backend (ADR 0018, #128):
#   dist/php-release/notion-alt-php-<version>.zip
#     notion-alt/              → upload the contents into the web root
#       index.html, assets/, … the web app (SPA)
#       .htaccess              SPA fallback, security headers
#       api/index.php          front controller, api/.htaccess routes /api/* to it
#       api/check.php          setup check in the browser (delete after setup)
#       api/app/               code, vendor/, bin/, config.example.php (never served)
# Usage: scripts/build-php-release.sh [version]
#   SKIP_WEB_BUILD=1   reuse apps/web/dist
#   VENDOR_DIR=<dir>   copy an existing vendor/ instead of running composer (offline builds)
set -eu
cd "$(dirname "$0")/.."

VERSION=${1:-$(git describe --tags --always 2>/dev/null || echo dev)}
OUT=dist/php-release
STAGE=$OUT/notion-alt
APP=$STAGE/api/app
SRC=apps/server

rm -rf "$OUT"
mkdir -p "$APP"

if [ "${SKIP_WEB_BUILD:-}" != 1 ]; then
  pnpm --filter @notion-alt/web build
fi
cp -R apps/web/dist/. "$STAGE/"
cp "$SRC/release/htaccess-root" "$STAGE/.htaccess"
cp "$SRC/release/htaccess-api" "$STAGE/api/.htaccess"
cp "$SRC/release/index.php" "$SRC/release/check.php" "$STAGE/api/"
cp -R "$SRC/src" "$SRC/bin" "$SRC/composer.json" "$SRC/composer.lock" "$APP/"
cp "$SRC/release/config.example.php" "$APP/"
cp "$SRC/release/htaccess-deny" "$APP/.htaccess"
rm -f "$APP/bin/fpm-healthcheck.php"

if [ -n "${VENDOR_DIR:-}" ]; then
  cp -R "$VENDOR_DIR" "$APP/vendor"
else
  composer install --working-dir="$APP" --no-dev --no-interaction --no-progress --prefer-dist \
    --optimize-autoloader --classmap-authoritative
fi
rm -f "$APP/composer.json" "$APP/composer.lock"

(cd "$OUT" && zip -qr "notion-alt-php-$VERSION.zip" notion-alt)
echo "$OUT/notion-alt-php-$VERSION.zip"
