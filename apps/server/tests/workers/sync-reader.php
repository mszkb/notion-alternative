<?php

declare(strict_types=1);

// Pulls the change log of a workspace with a cursor, like a device, while writers push
// (SyncOrderTest). Arguments: <database> <user> <workspace> <expected changes>. Prints every seq
// it saw as JSON. A change that becomes visible after one with a larger seq is never seen.

use NotionAlt\Config\ConfigLoader;
use NotionAlt\Database\Database;
use NotionAlt\Database\Row;
use NotionAlt\Sync\Changes;

require __DIR__ . '/../../vendor/autoload.php';

/** @var list<string> $args */
$args = $_SERVER['argv'];
[, $database, $user, $workspace, $expected] = $args;
$db = str_starts_with($database, 'mysql://')
    ? Database::openMysql(ConfigLoader::load(['DATABASE_URL' => $database], '/')->mysql ?? throw new RuntimeException('bad URL'))
    : Database::open($database);
$cursor = 0;
$seen = [];
$deadline = microtime(true) + 60;
while (\count($seen) < (int) $expected && microtime(true) < $deadline) {
    foreach (Changes::listSince($db, $user, $workspace, $cursor, 50) ?? [] as $change) {
        $cursor = Row::int($change, 'seq');
        $seen[] = $cursor;
    }
    usleep(2000);
}
echo json_encode($seen), "\n";
