<?php

declare(strict_types=1);

namespace NotionAlt\Database;

/** Small PDO helpers; PDO is used in exception mode, so `false` results only appear in its types. */
final class Sql
{
    public static function prepare(\PDO $db, string $sql): \PDOStatement
    {
        $statement = $db->prepare($sql);
        if ($statement === false) {
            throw new \RuntimeException('Cannot prepare statement');
        }

        return $statement;
    }

    /**
     * Prepares and executes a statement.
     *
     * @param list<mixed> $params
     */
    public static function run(\PDO $db, string $sql, array $params = []): \PDOStatement
    {
        $statement = self::prepare($db, $sql);
        // Integers as integers: with emulated prepares (MariaDB/MySQL) `limit ?` needs `10`, not '10'.
        foreach ($params as $index => $value) {
            $statement->bindValue($index + 1, $value, match (true) {
                \is_int($value) => \PDO::PARAM_INT,
                $value === null => \PDO::PARAM_NULL,
                default => \PDO::PARAM_STR,
            });
        }
        $statement->execute();

        return $statement;
    }

    /**
     * @param list<mixed> $params
     *
     * @return list<array<string, mixed>>
     */
    public static function rows(\PDO $db, string $sql, array $params = []): array
    {
        /** @var list<array<string, mixed>> */
        return self::run($db, $sql, $params)->fetchAll(\PDO::FETCH_ASSOC);
    }

    /** The larger of two values: `max(a, b)` on SQLite, `greatest(a, b)` on MariaDB/MySQL. */
    public static function greatest(\PDO $db, string $a, string $b): string
    {
        return (Database::isMysql($db) ? 'greatest' : 'max') . "({$a}, {$b})";
    }

    /**
     * The conflict clause of an upsert: `on conflict (…) do update set …` on SQLite, `on duplicate
     * key update …` on MariaDB/MySQL. `$set` refers to the new values as `excluded.<column>`.
     * MariaDB/MySQL check every unique key, not only `$keys`. The row count differs: MariaDB/MySQL
     * count an updated row twice.
     */
    public static function onConflict(\PDO $db, string $keys, string $set): string
    {
        if (!Database::isMysql($db)) {
            return " on conflict ({$keys}) do update set {$set}";
        }

        // `values()` is deprecated in MySQL 8 but the only form MariaDB knows as well.
        return ' on duplicate key update ' . preg_replace('/\bexcluded\.(\w+)/', 'values($1)', $set);
    }

    /**
     * Runs `insert into …` unless a row with the same `$keys` exists; rowCount() is 1 for a new
     * row and 0 otherwise. SQLite: `on conflict (…) do nothing`; MariaDB/MySQL: `insert ignore`,
     * which turns other errors into warnings as well, so only use it for rows whose values are
     * known to be valid.
     *
     * @param list<mixed> $params
     */
    public static function insertIfMissing(\PDO $db, string $insert, string $keys, array $params = []): \PDOStatement
    {
        $sql = Database::isMysql($db)
            ? (preg_replace('/^\s*insert into\b/i', 'insert ignore into', $insert) ?? $insert)
            : "{$insert} on conflict ({$keys}) do nothing";

        return self::run($db, $sql, $params);
    }
}
