<?php

declare(strict_types=1);

namespace NotionAlt\Database;

final class Transaction
{
    /**
     * Runs `$work` in a write transaction (`begin immediate`: PHP requests run in parallel, and a
     * deferred transaction that later writes fails at once with SQLITE_BUSY instead of waiting).
     * On MariaDB/MySQL a deadlock runs `$work` once more; `$work` must therefore only change the
     * database. There, transactions run in parallel: with `$exclusive` (a name) the transactions
     * of that name run one after the other, as every write transaction does on SQLite. For checks
     * that no row can be locked for, e.g. "no account exists yet".
     *
     * @template T
     *
     * @param \Closure(): T $work
     *
     * @return T
     */
    public static function run(\PDO $db, \Closure $work, ?string $exclusive = null): mixed
    {
        if ($exclusive !== null && Database::isMysql($db)) {
            // Named locks are server-wide: the name includes the database.
            $lock = 'select get_lock(sha1(concat(database(), ?)), 30)';
            if (Sql::run($db, $lock, [$exclusive])->fetchColumn() !== 1) {
                throw new \RuntimeException("Timeout waiting for the lock {$exclusive}");
            }
            try {
                return self::run($db, $work);
            } finally {
                Sql::run($db, 'select release_lock(sha1(concat(database(), ?)))', [$exclusive]);
            }
        }
        for ($attempt = 1; ; ++$attempt) {
            self::begin($db);
            try {
                $result = $work();
                $db->exec('commit');

                return $result;
            } catch (\Throwable $error) {
                $db->exec('rollback');
                if ($attempt === 1 && self::isDeadlock($error)) {
                    // InnoDB rolled the transaction back; the work only touches the database, so
                    // running it again is safe.
                    continue;
                }

                throw $error;
            }
        }
    }

    /** Starts a write transaction: `begin immediate` on SQLite, `start transaction` on MariaDB/MySQL. */
    public static function begin(\PDO $db): void
    {
        $db->exec(Database::isMysql($db) ? 'start transaction' : 'begin immediate');
    }

    /** MariaDB/MySQL error 1213: InnoDB chose this transaction as the victim of a deadlock. */
    public static function isDeadlock(\Throwable $error): bool
    {
        return $error instanceof \PDOException && ($error->errorInfo[1] ?? null) === 1213;
    }
}
