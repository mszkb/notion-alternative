<?php

declare(strict_types=1);

// Periodic tasks (ADR 0018): run every 5 minutes from the hoster's cron, e.g.
//   */5 * * * * php /path/to/api/bin/cron.php
// Logs one JSON line; overlapping runs are skipped.

require __DIR__ . '/../vendor/autoload.php';

if (PHP_SAPI !== 'cli') {
    exit(1);
}

use NotionAlt\Cli\Cron;
use NotionAlt\Config\ConfigLoader;
use NotionAlt\Database\DatabaseProvider;
use NotionAlt\Logging\Logger;

$config = ConfigLoader::fromEnvironment(dirname(__DIR__));
$logger = new Logger($config->logLevel);
$lock = fopen(dirname($config->databasePath) . '/cron.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    $logger->warn('cron already running');
    exit(0);
}
try {
    $db = (new DatabaseProvider($config->databasePath, $logger))->get();
    $logger->info('cron finished', Cron::run($db, $config));
} catch (Throwable $error) {
    $logger->error('cron failed', ['err' => Logger::serializeError($error)]);
    exit(1);
}
