#!/bin/sh
# For the server (php-fpm): migrates the database and runs the periodic tasks every 5 minutes in
# the background (there is no cron daemon in the container). Other commands, e.g.
# `php bin/console restore …`, run as they are, without touching the database first.
set -e
if [ "$1" = php-fpm ]; then
  php /app/bin/console migrate >/dev/null
  (
    while sleep 300; do
      php /app/bin/cron.php || true
    done
  ) &
fi
exec "$@"
