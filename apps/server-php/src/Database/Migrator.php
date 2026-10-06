<?php

declare(strict_types=1);

namespace NotionAlt\Database;

use NotionAlt\Database\Migrations\M0001Initial;
use NotionAlt\Database\Migrations\M0002Devices;
use NotionAlt\Database\Migrations\M0003Sync;
use NotionAlt\Database\Migrations\M0004ChangeLogFloor;
use NotionAlt\Database\Migrations\M0005Search;
use NotionAlt\Database\Migrations\M0006Conflicts;
use NotionAlt\Database\Migrations\M0007Push;
use NotionAlt\Database\Migrations\M0008Attachments;
use NotionAlt\Database\Migrations\M0009SearchRowids;
use NotionAlt\Database\Migrations\M0010SearchDirty;
use NotionAlt\Database\Migrations\M0011SnapshotPaging;

/**
 * Runs the migrations with Kysely's bookkeeping (`kysely_migration`, `kysely_migration_lock`,
 * same DDL, names and ISO timestamps), so a database created by the Node server is continued and
 * vice versa (ADR 0018).
 *
 * Unlike Kysely on SQLite (one process, no transaction), PHP serves requests in parallel
 * processes: the lock row is really taken, and each migration runs in its own transaction
 * together with its bookkeeping row.
 */
final class Migrator
{
    public const MIGRATION_TABLE = 'kysely_migration';

    public const LOCK_TABLE = 'kysely_migration_lock';

    public const LOCK_ID = 'migration_lock';

    private bool $locked = false;

    /** @var array<string, Migration> */
    private readonly array $migrations;

    /**
     * @param array<string, Migration>|null $migrations by name; default: all migrations
     * @param float                         $lockTimeout seconds to wait for another process's lock
     */
    public function __construct(
        private readonly \PDO $db,
        ?array $migrations = null,
        private readonly float $lockTimeout = 30.0,
    ) {
        $migrations ??= self::all();
        ksort($migrations, SORT_STRING);
        $this->migrations = $migrations;
    }

    /**
     * All migrations, in the order of apps/server/src/db/migrate.ts. A new migration must be added
     * to both servers while both exist (ADR 0018).
     *
     * @return array<string, Migration>
     */
    public static function all(): array
    {
        return [
            '0001_initial' => new M0001Initial(),
            '0002_devices' => new M0002Devices(),
            '0003_sync' => new M0003Sync(),
            '0004_change_log_floor' => new M0004ChangeLogFloor(),
            '0005_search' => new M0005Search(),
            '0006_conflicts' => new M0006Conflicts(),
            '0007_push' => new M0007Push(),
            '0008_attachments' => new M0008Attachments(),
            '0009_search_rowids' => new M0009SearchRowids(),
            '0010_search_dirty' => new M0010SearchDirty(),
            '0011_snapshot_paging' => new M0011SnapshotPaging(),
        ];
    }

    /**
     * Applies the missing migrations and returns their names. Cheap when nothing is pending (one
     * query), so it can run on every request.
     *
     * @return list<string>
     */
    public function migrateToLatest(): array
    {
        if ($this->pending() === []) {
            return [];
        }
        $this->ensureMigrationTables();
        $this->acquireLock();
        try {
            // Another process may have migrated while this one waited for the lock.
            $applied = [];
            foreach ($this->pending() as $name) {
                $this->apply($name);
                $applied[] = $name;
            }

            return $applied;
        } finally {
            $this->releaseLock();
        }
    }

    /**
     * Names of the migrations not yet applied. Fails like Kysely if the database contains a
     * migration this server does not know (e.g. from a newer version) or the order is broken.
     *
     * @return list<string>
     */
    public function pending(): array
    {
        $executed = $this->executed();
        $names = array_keys($this->migrations);
        foreach ($executed as $name) {
            if (!isset($this->migrations[$name])) {
                throw new MigrationException("corrupted migrations: previously executed migration {$name} is missing");
            }
        }
        foreach ($executed as $index => $name) {
            if ($names[$index] !== $name) {
                throw new MigrationException(
                    "corrupted migrations: expected previously executed migration {$name} to be at index {$index} but {$names[$index]} was found in its place. New migrations must always have a name that comes alphabetically after the last executed migration.",
                );
            }
        }

        return \array_slice($names, \count($executed));
    }

    /**
     * Executed migrations in the order Kysely uses: by timestamp, then by name.
     *
     * @return list<string>
     */
    private function executed(): array
    {
        if (!$this->tableExists(self::MIGRATION_TABLE)) {
            return [];
        }
        /** @var list<array{name: string, timestamp: string}> $rows */
        $rows = Sql::rows($this->db, 'select "name", "timestamp" from "kysely_migration"');
        usort($rows, self::compareExecuted(...));

        return array_column($rows, 'name');
    }

    /**
     * @param array{name: string, timestamp: string} $a
     * @param array{name: string, timestamp: string} $b
     */
    private static function compareExecuted(array $a, array $b): int
    {
        if ($a['timestamp'] === $b['timestamp']) {
            return strcmp($a['name'], $b['name']);
        }

        return self::time($a['timestamp']) <=> self::time($b['timestamp']);
    }

    private static function time(string $timestamp): float
    {
        try {
            return (float) (new \DateTimeImmutable($timestamp))->format('U.u');
        } catch (\Exception) {
            return NAN;
        }
    }

    /** Same DDL and lock row as Kysely's Migrator. */
    private function ensureMigrationTables(): void
    {
        $this->db->exec('create table if not exists "kysely_migration" ("name" varchar(255) not null primary key, "timestamp" varchar(255) not null)');
        $this->db->exec('create table if not exists "kysely_migration_lock" ("id" varchar(255) not null primary key, "is_locked" integer default 0 not null)');
        $this->db->exec('insert or ignore into "kysely_migration_lock" ("id", "is_locked") values (\'migration_lock\', 0)');
    }

    private function acquireLock(): void
    {
        $deadline = microtime(true) + $this->lockTimeout;
        $update = Sql::prepare($this->db, 'update "kysely_migration_lock" set "is_locked" = 1 where "id" = ? and "is_locked" = 0');
        while (true) {
            $this->db->exec('begin immediate');
            try {
                $update->execute([self::LOCK_ID]);
                $taken = $update->rowCount() === 1;
                $this->db->exec('commit');
            } catch (\Throwable $error) {
                $this->rollBackOpenTransaction();
                throw $error;
            }
            if ($taken) {
                $this->locked = true;
                // A fatal error (e.g. max_execution_time) skips `finally`; release the lock anyway.
                register_shutdown_function(fn() => $this->releaseLock());

                return;
            }
            if (microtime(true) >= $deadline) {
                throw new MigrationException(
                    'The migration lock is held by another process. If no migration is running (e.g. after a crash), '
                    . "release it with: update kysely_migration_lock set is_locked = 0 where id = 'migration_lock'",
                );
            }
            usleep(100_000);
        }
    }

    private function releaseLock(): void
    {
        if (!$this->locked) {
            return;
        }
        $this->rollBackOpenTransaction();
        Sql::run($this->db, 'update "kysely_migration_lock" set "is_locked" = 0 where "id" = ?', [self::LOCK_ID]);
        $this->locked = false;
    }

    private function apply(string $name): void
    {
        $this->db->exec('begin immediate');
        try {
            $this->migrations[$name]->up($this->db);
            Sql::run($this->db, 'insert into "kysely_migration" ("name", "timestamp") values (?, ?)', [$name, self::isoTimestamp()]);
            $this->db->exec('commit');
        } catch (\Throwable $error) {
            $this->rollBackOpenTransaction();
            throw new MigrationException("Migration {$name} failed: {$error->getMessage()}", 0, $error);
        }
    }

    /**
     * Transactions are started with `begin immediate` (take the write lock up front), which PDO
     * does not track, so `PDO::inTransaction()` cannot be used.
     */
    private function rollBackOpenTransaction(): void
    {
        try {
            $this->db->exec('rollback');
        } catch (\PDOException) {
            // No transaction open.
        }
    }

    /** `new Date().toISOString()`, e.g. `2026-10-06T19:32:18.142Z`. */
    public static function isoTimestamp(): string
    {
        return (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    }

    private function tableExists(string $name): bool
    {
        return Sql::rows($this->db, "select 1 from sqlite_master where type = 'table' and name = ?", [$name]) !== [];
    }
}
