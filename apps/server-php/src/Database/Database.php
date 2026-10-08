<?php

declare(strict_types=1);

namespace NotionAlt\Database;

final class Database
{
    /** Opens the SQLite database (":memory:" for tests) with the pragmas of the Node server. */
    public static function open(string $path): \PDO
    {
        if ($path !== ':memory:') {
            $dir = \dirname($path);
            if (!is_dir($dir) && !@mkdir($dir, 0o777, true) && !is_dir($dir)) {
                throw new \RuntimeException("Cannot create the database directory {$dir}");
            }
        }
        $pdo = new \PDO('sqlite:' . $path, null, null, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
        // Before WAL: switching the journal mode has to wait for other writers as well.
        $pdo->exec('pragma busy_timeout = 5000');
        $pdo->exec('pragma journal_mode = WAL');
        $pdo->exec('pragma foreign_keys = ON');

        return $pdo;
    }

    /**
     * The search (migration 0005) needs SQLite with FTS5. Fails with a clear message instead of
     * a migration error deep inside the first request.
     */
    public static function assertFts5(): void
    {
        try {
            $probe = new \PDO('sqlite::memory:', null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
            $probe->exec('create virtual table fts5_probe using fts5(content)');
        } catch (\PDOException $error) {
            throw new \RuntimeException(
                'SQLite of this PHP installation has no FTS5 (full-text search); pdo_sqlite with FTS5 is required',
                0,
                $error,
            );
        }
    }
}
