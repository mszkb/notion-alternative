<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Config\ConfigLoader;
use NotionAlt\Database\Database;
use NotionAlt\Database\Sql;
use NotionAlt\Database\Transaction;
use NotionAlt\Devices\Devices;
use NotionAlt\Support\Ids;
use NotionAlt\Tests\TestDatabase;
use PHPUnit\Framework\TestCase;

/** The SQL that differs between SQLite and MariaDB/MySQL behaves the same on both (ADR 0024). */
final class DatabaseDialectTest extends TestCase
{
    private \PDO $db;

    protected function setUp(): void
    {
        $this->db = TestDatabase::open();
    }

    public function testInsertIfMissingKeepsTheExistingRow(): void
    {
        $insert = 'insert into settings ("key", value) values (?, ?)';

        self::assertSame(1, Sql::insertIfMissing($this->db, $insert, '"key"', ['k', 'first'])->rowCount());
        self::assertSame(0, Sql::insertIfMissing($this->db, $insert, '"key"', ['k', 'second'])->rowCount());
        self::assertSame([['value' => 'first']], Sql::rows($this->db, 'select value from settings'));
    }

    public function testOnConflictUpdatesWithTheNewValues(): void
    {
        $upsert = 'insert into metrics (name, labels, value) values (?, ?, ?)' . Sql::onConflict($this->db, 'name, labels', 'value = value + excluded.value');

        Sql::run($this->db, $upsert, ['n', '{}', 1.5]);
        Sql::run($this->db, $upsert, ['n', '{}', 2.0]);
        Sql::run($this->db, $upsert, ['m', '{}', 1.0]);

        self::assertSame([['name' => 'm', 'value' => 1.0], ['name' => 'n', 'value' => 3.5]], Sql::rows($this->db, 'select name, value from metrics order by name'));
        self::assertSame([['g' => 7]], Sql::rows($this->db, 'select ' . Sql::greatest($this->db, '3', '7') . ' as g'));
    }

    public function testBindsIntegersAsNumbersForLimitsComparisonsAndResults(): void
    {
        foreach (['a', 'b', 'c'] as $key) {
            Sql::run($this->db, 'insert into settings ("key", value) values (?, ?)', [$key, $key]);
        }

        // Emulated prepares (MariaDB/MySQL) wrote `limit '2'` with a string: a syntax error.
        self::assertSame([['key' => 'a'], ['key' => 'b']], Sql::rows($this->db, 'select "key" from settings order by "key" limit ? offset ?', [2, 0]));
        // Bound as text, SQLite ranked '10' above 20 and the compaction cursor went backwards.
        self::assertSame([['g' => 20]], Sql::rows($this->db, 'select ' . Sql::greatest($this->db, '20', '?') . ' as g', [10]));
        // Results stay typed: integers, not strings; null stays null.
        self::assertSame([['n' => 3, 'v' => null]], Sql::rows($this->db, 'select count(*) as n, ? as v from settings', [null]));
    }

    public function testRowCountCountsMatchedRowsNotOnlyChangedOnes(): void
    {
        $user = Ids::uuid();
        $device = Ids::uuid();
        Sql::run($this->db, 'insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)', [$user, 'a@example.com', 'h', 'now']);
        Sql::run($this->db, 'insert into devices (id, user_id, name, created_at, last_seen_at) values (?, ?, ?, ?, ?)', [$device, $user, 'Laptop', 'now', 'now']);

        // MariaDB/MySQL count only changed rows by default: renaming to the same name was a 404.
        self::assertTrue(Devices::rename($this->db, $user, $device, 'Laptop'));
        self::assertFalse(Devices::rename($this->db, $user, Ids::uuid(), 'Laptop'));
    }

    public function testRunsTheWorkAgainOnceAfterADeadlock(): void
    {
        $attempts = 0;
        $result = Transaction::run($this->db, function () use (&$attempts): string {
            Sql::run($this->db, 'insert into settings ("key", value) values (?, ?)', ['k', (string) ++$attempts]);
            if ($attempts === 1) {
                throw self::deadlock();
            }

            return 'done';
        });

        self::assertSame('done', $result);
        self::assertSame([['value' => '2']], Sql::rows($this->db, 'select value from settings'));
    }

    public function testGivesUpAfterASecondDeadlockAndKeepsNothing(): void
    {
        $attempts = 0;
        $insertAndFail = function (\PDOException $error) use (&$attempts): \Closure {
            return function () use (&$attempts, $error): void {
                Sql::run($this->db, 'insert into settings ("key", value) values (?, ?)', ['k', (string) ++$attempts]);
                if ($attempts < 10) {
                    throw $error;
                }
            };
        };
        try {
            Transaction::run($this->db, $insertAndFail(self::deadlock()));
            self::fail('no exception');
        } catch (\PDOException $error) {
            self::assertTrue(Transaction::isDeadlock($error));
        }
        self::assertSame(2, $attempts);
        self::assertSame([], Sql::rows($this->db, 'select value from settings'));

        // Other errors are not retried.
        $attempts = 0;
        try {
            Transaction::run($this->db, $insertAndFail(new \PDOException('other')));
            self::fail('no exception');
        } catch (\PDOException $error) {
            self::assertSame('other', $error->getMessage());
        }
        self::assertSame(1, $attempts);
    }

    public function testExclusiveTransactionsOfOneNameRunOneAfterTheOther(): void
    {
        $mysql = TestDatabase::mysqlConfig();
        if ($mysql === null) {
            self::markTestSkipped('MariaDB/MySQL only; on SQLite every write transaction is exclusive');
        }
        $other = Database::openMysql($mysql);
        $tryLock = static fn(): mixed => Sql::run($other, 'select get_lock(sha1(concat(database(), ?)), 0)', ['register'])->fetchColumn();

        $whileRunning = Transaction::run($this->db, static fn(): mixed => $tryLock(), exclusive: 'register');

        self::assertSame(0, $whileRunning);
        self::assertSame(1, $tryLock());
        // Held by the other connection now: a transaction of that name would wait.
        Sql::run($other, 'select release_lock(sha1(concat(database(), ?)))', ['register']);
    }

    public function testConnectingToMysqlCreatesTheDataDirectory(): void
    {
        if (TestDatabase::mysqlConfig() === null) {
            self::markTestSkipped('MariaDB/MySQL only; SQLite creates it for its file');
        }
        $dir = sys_get_temp_dir() . '/notion-alt-data-' . bin2hex(random_bytes(6));
        $config = ConfigLoader::load(['DATA_DIR' => $dir, 'DATABASE_URL' => (string) getenv('TEST_DATABASE_URL')], '/');

        try {
            Database::connect($config);
            // Import lock, cron lock and backups live there even without a SQLite file.
            self::assertDirectoryExists($dir);
            self::assertFileDoesNotExist("{$dir}/app.sqlite");
        } finally {
            @rmdir($dir);
        }
    }

    private static function deadlock(): \PDOException
    {
        $error = new \PDOException('SQLSTATE[40001]: Serialization failure: 1213 Deadlock found when trying to get lock');
        $error->errorInfo = ['40001', 1213, 'Deadlock found when trying to get lock'];

        return $error;
    }
}
