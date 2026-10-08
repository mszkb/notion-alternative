<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Auth\AttemptLimiter;
use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use PHPUnit\Framework\TestCase;

/** Fixed-window limits, also across instances (= PHP processes). */
final class AttemptLimiterTest extends TestCase
{
    private \PDO $db;

    private int $now = 1_000_000;

    protected function setUp(): void
    {
        $this->db = Database::open(':memory:');
        (new Migrator($this->db))->migrateToLatest();
    }

    public function testBlocksAfterMaxAttemptsUntilTheWindowEnds(): void
    {
        $limiter = $this->limiter(3);
        self::assertSame(0, $limiter->retryAfter('a'));
        $limiter->record('a');
        $limiter->record('a');
        self::assertSame(0, $limiter->retryAfter('a'));
        $limiter->record('a');
        self::assertSame(60, $limiter->retryAfter('a'));

        $this->now += 30_500;
        self::assertSame(30, $limiter->retryAfter('a'));
        $this->now += 29_500;
        self::assertSame(0, $limiter->retryAfter('a'));
    }

    public function testKeysAndLimitersAreIndependent(): void
    {
        $limiter = $this->limiter(1);
        $limiter->record('a');
        self::assertGreaterThan(0, $limiter->retryAfter('a'));
        self::assertSame(0, $limiter->retryAfter('b'));
        self::assertSame(0, $this->limiter(1, 'other')->retryAfter('a'));
    }

    public function testResetClearsTheKey(): void
    {
        $limiter = $this->limiter(1);
        $limiter->record('a');
        $limiter->reset('a');
        self::assertSame(0, $limiter->retryAfter('a'));
    }

    public function testStartsANewWindowAfterExpiry(): void
    {
        $limiter = $this->limiter(2);
        $limiter->record('a');
        $this->now += 60_000;
        $limiter->record('a');
        self::assertSame(0, $limiter->retryAfter('a'));
        $limiter->record('a');
        self::assertSame(60, $limiter->retryAfter('a'));
    }

    public function testCountersSurviveTheRequest(): void
    {
        $this->limiter(2)->record('a');
        $this->limiter(2)->record('a');
        self::assertSame(60, $this->limiter(2)->retryAfter('a'));
    }

    public function testPrunesExpiredRowsOnWrite(): void
    {
        $limiter = $this->limiter(5);
        $limiter->record('old');
        $this->now += 60_000;
        $limiter->record('new');
        self::assertSame(
            [['key' => 'login_ip:new', 'count' => 1, 'reset_at' => $this->now + 60_000]],
            Sql::rows($this->db, 'select * from auth_attempts'),
        );
    }

    /** A flood of new keys pushes out the oldest, per limiter (security review L3). */
    public function testHoldsAtMostMaxEntriesPerLimiter(): void
    {
        $emails = new AttemptLimiter($this->db, 'login_email', 3, 60_000, fn(): int => $this->now, 5);
        $ips = $this->limiter(3);
        $ips->record('10.0.0.1');
        for ($i = 0; $i < 12; ++$i) {
            ++$this->now;
            $emails->record("user{$i}@example.com");
        }
        $emails->record('user11@example.com');

        $keys = array_column(Sql::rows($this->db, 'select key from auth_attempts order by key'), 'key');
        self::assertSame(
            ['login_email:user10@example.com', 'login_email:user11@example.com', 'login_email:user7@example.com', 'login_email:user8@example.com', 'login_email:user9@example.com', 'login_ip:10.0.0.1'],
            $keys,
        );
    }

    private function limiter(int $max, string $name = 'login_ip'): AttemptLimiter
    {
        return new AttemptLimiter($this->db, $name, $max, 60_000, fn(): int => $this->now);
    }
}
