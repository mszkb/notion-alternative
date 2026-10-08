<?php

declare(strict_types=1);

namespace NotionAlt\Import;

/**
 * One import at a time across all PHP workers (the Node server holds a flag in memory): an
 * exclusive, non-blocking `flock` on a file next to the database. The operating system releases
 * it when the request ends, also after a crash.
 */
final class ImportLock
{
    public function __construct(private readonly string $path) {}

    public static function forDatabase(string $databasePath): self
    {
        $dir = $databasePath === ':memory:' ? sys_get_temp_dir() : \dirname($databasePath);

        return new self($dir . '/import.lock');
    }

    /**
     * Runs `$work` while holding the lock; false if another import holds it.
     *
     * @template T
     *
     * @param \Closure(): T $work
     *
     * @return array{T}|false the result wrapped, so `false` stays distinguishable
     */
    public function run(\Closure $work): array|false
    {
        $handle = @fopen($this->path, 'c');
        if ($handle === false) {
            throw new \RuntimeException('Cannot open the import lock file');
        }
        try {
            if (!flock($handle, LOCK_EX | LOCK_NB)) {
                return false;
            }
            try {
                return [$work()];
            } finally {
                flock($handle, LOCK_UN);
            }
        } finally {
            fclose($handle);
        }
    }
}
