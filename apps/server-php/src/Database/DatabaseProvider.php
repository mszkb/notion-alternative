<?php

declare(strict_types=1);

namespace NotionAlt\Database;

use NotionAlt\Logging\Logger;

/**
 * Opens the database on first use (requests that need none, like `/api/health`, stay cheap and
 * work without it): checks FTS5, applies the pragmas and the pending migrations.
 */
final class DatabaseProvider
{
    private ?\PDO $pdo = null;

    public function __construct(
        private readonly string $path,
        private readonly Logger $logger,
    ) {}

    public function get(): \PDO
    {
        if ($this->pdo === null) {
            Database::assertFts5();
            $pdo = Database::open($this->path);
            $applied = (new Migrator($pdo))->migrateToLatest();
            if ($applied !== []) {
                $this->logger->info('database migrated', ['databasePath' => $this->path, 'migrations' => $applied]);
            }
            $this->pdo = $pdo;
        }

        return $this->pdo;
    }
}
