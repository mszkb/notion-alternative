<?php

declare(strict_types=1);

namespace NotionAlt\Database;

final class Transaction
{
    /**
     * Runs `$work` in a write transaction (`begin immediate`: PHP requests run in parallel, and a
     * deferred transaction that later writes fails at once with SQLITE_BUSY instead of waiting).
     *
     * @template T
     *
     * @param \Closure(): T $work
     *
     * @return T
     */
    public static function run(\PDO $db, \Closure $work): mixed
    {
        $db->exec('begin immediate');
        try {
            $result = $work();
            $db->exec('commit');

            return $result;
        } catch (\Throwable $error) {
            $db->exec('rollback');

            throw $error;
        }
    }
}
