<?php

declare(strict_types=1);

namespace NotionAlt\Auth;

use NotionAlt\Database\Sql;
use NotionAlt\Database\Transaction;

/**
 * Attempt counter with a fixed window per key (login and registration limits). PHP keeps no
 * memory between requests, so the counters live in the table `auth_attempts` (migration 0013),
 * keyed by limiter name and key. Each limiter holds at most {@see self::MAX_ENTRIES} keys: new keys
 * (e.g. a flood of made-up email addresses) push out the oldest instead of growing the table.
 */
final class AttemptLimiter
{
    public const MAX_ENTRIES = 10_000;

    /** @var \Closure(): int */
    private readonly \Closure $now;

    /**
     * @param string               $name     prefix of the keys, e.g. `login_ip`
     * @param (\Closure(): int)|null $now    current time in milliseconds
     */
    public function __construct(
        private readonly \PDO $db,
        private readonly string $name,
        private readonly int $max,
        private readonly int $windowMs,
        ?\Closure $now = null,
        private readonly int $maxEntries = self::MAX_ENTRIES,
    ) {
        $this->now = $now ?? static fn(): int => (int) floor(microtime(true) * 1000);
    }

    /** Seconds until the key may try again, or 0 if it is not blocked. */
    public function retryAfter(string $key): int
    {
        $rows = Sql::rows($this->db, 'select count, reset_at from auth_attempts where key = ?', [$this->key($key)]);
        if ($rows === []) {
            return 0;
        }
        $remaining = self::int($rows[0]['reset_at']) - ($this->now)();
        if ($remaining <= 0) {
            return 0;
        }

        return self::int($rows[0]['count']) >= $this->max ? (int) ceil($remaining / 1000) : 0;
    }

    public function record(string $key): void
    {
        // One write transaction: concurrent requests must not both count below the cap.
        Transaction::run($this->db, function () use ($key): void {
            $now = ($this->now)();
            // Expired windows are pruned on every write, so the table only holds live keys.
            Sql::run($this->db, 'delete from auth_attempts where reset_at <= ?', [$now]);
            $key = $this->key($key);
            if (Sql::rows($this->db, 'select 1 from auth_attempts where key = ?', [$key]) === []) {
                // Keys of this limiter sort between `<name>:` and `<name>;` (the next character).
                $range = [$this->name . ':', $this->name . ';'];
                $count = Sql::run($this->db, 'select count(*) from auth_attempts where key >= ? and key < ?', $range)->fetchColumn();
                $excess = self::int($count) - $this->maxEntries + 1;
                if ($excess > 0) {
                    Sql::run(
                        $this->db,
                        'delete from auth_attempts where key in (
                           select key from auth_attempts where key >= ? and key < ? order by reset_at limit ?)',
                        [...$range, $excess],
                    );
                }
            }
            Sql::run(
                $this->db,
                'insert into auth_attempts (key, count, reset_at) values (?, 1, ?)
                 on conflict (key) do update set count = count + 1',
                [$key, $now + $this->windowMs],
            );
        });
    }

    public function reset(string $key): void
    {
        Sql::run($this->db, 'delete from auth_attempts where key = ?', [$this->key($key)]);
    }

    private function key(string $key): string
    {
        return $this->name . ':' . $key;
    }

    private static function int(mixed $value): int
    {
        return \is_int($value) ? $value : (\is_numeric($value) ? (int) $value : 0);
    }
}
