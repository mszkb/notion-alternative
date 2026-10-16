<?php

declare(strict_types=1);

namespace NotionAlt\Database;

/**
 * Copies all data from one database into another, SQLite and MariaDB/MySQL in any direction
 * (ADR 0024): backups of MariaDB/MySQL, restoring them, `bin/console db:copy`. Both databases
 * must be migrated to the same version; the target must be empty. The search index is not copied
 * but rebuilt: every page is marked for reindexing.
 */
final class DatabaseCopy
{
    /** Rows per insert transaction on the target. */
    private const CHUNK = 1000;

    /**
     * @return array<string, int> rows copied per table
     */
    public static function copy(\PDO $from, \PDO $to): array
    {
        $fromVersion = self::lastMigration($from);
        if ($fromVersion !== self::lastMigration($to)) {
            throw new \RuntimeException('Source and target are not at the same migration');
        }
        $tables = self::tables($to);
        foreach ($tables as $table) {
            if (Sql::rows($to, "select 1 from \"{$table}\" limit 1") !== []) {
                throw new \RuntimeException("The target database is not empty (table {$table})");
            }
        }

        $counts = [];
        self::beginSnapshot($from);
        self::foreignKeys($to, false);
        if (Database::isMysql($from)) {
            // Rows are streamed instead of loading each table into memory.
            $from->setAttribute(Database::mysqlAttribute('USE_BUFFERED_QUERY'), false);
        }
        try {
            foreach ($tables as $table) {
                $columns = array_values(array_intersect(self::columns($to, $table), self::columns($from, $table)));
                $counts[$table] = self::copyTable($from, $to, $table, $columns);
            }
            Transaction::begin($to);
            Sql::run($to, 'insert into search_dirty (document_id) select id from documents where deleted_at is null');
            $to->exec('commit');
        } finally {
            if (Database::isMysql($from)) {
                $from->setAttribute(Database::mysqlAttribute('USE_BUFFERED_QUERY'), true);
            }
            self::foreignKeys($to, true);
            $from->exec('rollback');
        }

        return $counts;
    }

    /**
     * Data tables to copy: everything but the migration bookkeeping and the search tables (FTS5
     * on SQLite, `FULLTEXT` on MariaDB/MySQL), which are rebuilt.
     *
     * @return list<string>
     */
    public static function tables(\PDO $db): array
    {
        /** @var list<string> $names */
        $names = Database::isMysql($db)
            ? Sql::run($db, 'select table_name from information_schema.tables where table_schema = database() order by table_name')->fetchAll(\PDO::FETCH_COLUMN)
            : Sql::run($db, "select name from sqlite_master where type = 'table' and name not like 'sqlite\\_%' escape '\\' order by name")->fetchAll(\PDO::FETCH_COLUMN);

        $names = array_values(array_filter(
            $names,
            static fn(string $name): bool => !str_starts_with($name, 'kysely_') && !str_starts_with($name, 'search_'),
        ));
        // The same order on both databases (their collations sort `_` differently).
        sort($names, SORT_STRING);

        return $names;
    }

    /**
     * @param list<string> $columns
     */
    private static function copyTable(\PDO $from, \PDO $to, string $table, array $columns): int
    {
        $list = implode(', ', array_map(static fn(string $column): string => "\"{$column}\"", $columns));
        $placeholders = implode(', ', array_fill(0, \count($columns), '?'));
        $insert = Sql::prepare($to, "insert into \"{$table}\" ({$list}) values ({$placeholders})");
        // Insertion order: the rowid on SQLite, `id` of metrics on MariaDB/MySQL (rendered in it).
        $order = Database::isMysql($from) ? ($table === 'metrics' ? ' order by "id"' : '') : ' order by rowid';
        $rows = Sql::run($from, "select {$list} from \"{$table}\"{$order}");
        $count = 0;
        Transaction::begin($to);
        try {
            while (($row = $rows->fetch(\PDO::FETCH_NUM)) !== false) {
                /** @var list<mixed> $row */
                $insert->execute($row);
                if (++$count % self::CHUNK === 0) {
                    $to->exec('commit');
                    Transaction::begin($to);
                }
            }
            $to->exec('commit');
        } catch (\Throwable $error) {
            // An open unbuffered result would hide this error behind "unbuffered queries are active".
            $rows->closeCursor();
            $to->exec('rollback');

            throw $error;
        }

        return $count;
    }

    /** One consistent state of the source, also while the server writes to it. */
    private static function beginSnapshot(\PDO $db): void
    {
        if (Database::isMysql($db)) {
            $db->exec('set session transaction isolation level repeatable read');
            $db->exec('start transaction with consistent snapshot, read only');
            $db->exec('set session transaction isolation level read committed');
        } else {
            // A read transaction sees one state of the WAL until it ends.
            $db->exec('begin');
        }
    }

    /** Off while copying: tables are copied in name order, not in the order of their references. */
    private static function foreignKeys(\PDO $db, bool $on): void
    {
        $db->exec(Database::isMysql($db) ? 'set foreign_key_checks = ' . ($on ? '1' : '0') : 'pragma foreign_keys = ' . ($on ? 'on' : 'off'));
    }

    /**
     * @return list<string>
     */
    private static function columns(\PDO $db, string $table): array
    {
        if (Database::isMysql($db)) {
            /** @var list<string> */
            return Sql::run(
                $db,
                'select column_name from information_schema.columns where table_schema = database() and table_name = ? order by ordinal_position',
                [$table],
            )->fetchAll(\PDO::FETCH_COLUMN);
        }

        return array_map(static fn(array $column): string => Row::string($column, 'name'), Sql::rows($db, "pragma table_info(\"{$table}\")"));
    }

    private static function lastMigration(\PDO $db): ?string
    {
        $rows = Sql::rows($db, 'select "name" from "kysely_migration" order by "name" desc limit 1');

        return $rows === [] ? null : Row::string($rows[0], 'name');
    }
}
