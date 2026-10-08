#!/bin/sh
# Migrates the database, runs the periodic tasks every 5 minutes in the background (there is no
# cron daemon in the container), then hands over to the command (php-fpm).
set -e
php /app/bin/console migrate
(
  while sleep 300; do
    php /app/bin/cron.php || true
  done
) &
exec "$@"
