<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Auth\AttemptLimiter;
use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use PHPUnit\Framework\TestCase;

/** Same cases as apps/server/test/rate-limit.test.ts, plus persistence across instances. */
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

    private function limiter(int $max, string $name = 'login_ip'): AttemptLimiter
    {
        return new AttemptLimiter($this->db, $name, $max, 60_000, fn(): int => $this->now);
    }
}
