<?php

declare(strict_types=1);

namespace NotionAlt\Database;

use NotionAlt\Config\Config;
use NotionAlt\Logging\Logger;

/**
 * Opens the database on first use (requests that need none, like `/api/health`, stay cheap and
 * work without it): checks FTS5 (SQLite), connects and applies the pending migrations.
 */
final class DatabaseProvider
{
    private ?\PDO $pdo = null;

    public function __construct(
        private readonly Config $config,
        private readonly Logger $logger,
    ) {}

    public function get(): \PDO
    {
        if ($this->pdo === null) {
            if ($this->config->mysql === null) {
                Database::assertFts5();
            }
            $pdo = Database::connect($this->config);
            $applied = (new Migrator($pdo))->migrateToLatest();
            if ($applied !== []) {
                $where = $this->config->mysql === null
                    ? ['databasePath' => $this->config->databasePath]
                    : ['database' => $this->config->mysql->database];
                $this->logger->info('database migrated', [...$where, 'migrations' => $applied]);
            }
            $this->pdo = $pdo;
        }

        return $this->pdo;
    }
}
