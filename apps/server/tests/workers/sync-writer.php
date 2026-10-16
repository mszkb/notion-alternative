<?php

declare(strict_types=1);

// Pushes batches of new pages into one workspace, as one device, in parallel with other writers
// (SyncOrderTest). Arguments: <database> <user> <workspace> <device> <batches> <ops per batch>;
// <database> is a SQLite file or a mysql:// URL. Prints the results as JSON.

use NotionAlt\Config\ConfigLoader;
use NotionAlt\Database\Database;
use NotionAlt\Support\Ids;
use NotionAlt\Sync\Apply;
use NotionAlt\Sync\Operation;

require __DIR__ . '/../../vendor/autoload.php';

/** @var list<string> $args */
$args = $_SERVER['argv'];
[, $database, $user, $workspace, $device, $batches, $size] = $args;
$db = str_starts_with($database, 'mysql://')
    ? Database::openMysql(ConfigLoader::load(['DATABASE_URL' => $database], '/')->mysql ?? throw new RuntimeException('bad URL'))
    : Database::open($database);
$results = [];
for ($batch = 0; $batch < (int) $batches; ++$batch) {
    $operations = [];
    for ($i = 0; $i < (int) $size; ++$i) {
        $payload = (object) ['parentId' => null, 'title' => "{$device} {$batch}/{$i}", 'sortKey' => 'a0', 'favorite' => false, 'createdAt' => 'now'];
        $operations[] = new Operation(Ids::uuid(), $device, $workspace, 'document', Ids::uuid(), 'create', null, $payload, 'now');
    }
    try {
        foreach (Apply::batch($db, $user, $operations) as $result) {
            $results[] = $result['status'];
        }
    } catch (Throwable $error) {
        $results[] = 'error: ' . $error->getMessage();
    }
}
echo json_encode($results), "\n";
