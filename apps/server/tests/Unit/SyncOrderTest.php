<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Database\Database;
use NotionAlt\Database\Sql;
use NotionAlt\Database\Transaction;
use NotionAlt\Support\Ids;
use NotionAlt\Tests\TempDir;
use NotionAlt\Tests\TestDatabase;
use PHPUnit\Framework\TestCase;

/**
 * Sync numbers under parallel pushes into one workspace (ADR 0024, B1): several processes push
 * while another one pulls with a cursor. The numbers have no gaps, and the puller sees every
 * change: none becomes visible after one with a larger number. On SQLite `begin immediate`
 * guarantees it, on MariaDB/MySQL the lock on the workspace row.
 */
final class SyncOrderTest extends TestCase
{
    use TempDir;

    private const WRITERS = 4;
    private const BATCHES = 25;
    private const OPS = 4;

    public function testParallelPushesKeepTheChangeLogInOrder(): void
    {
        $sqlite = $this->tempDir() . '/app.sqlite';
        $db = TestDatabase::open($sqlite);
        $database = TestDatabase::mysqlConfig() !== null ? (string) getenv('TEST_DATABASE_URL') : $sqlite;
        $user = Ids::uuid();
        $ws = Ids::uuid();
        Sql::run($db, "insert into users (id, email, password_hash, created_at) values (?, 'a@example.com', 'h', 'now')", [$user]);
        Sql::run($db, "insert into workspaces (id, name, owner_id, created_at) values (?, 'Personal', ?, 'now')", [$ws, $user]);
        $devices = [];
        for ($i = 0; $i < self::WRITERS; ++$i) {
            $devices[] = $device = Ids::uuid();
            Sql::run($db, "insert into devices (id, user_id, name, created_at, last_seen_at) values (?, ?, 'd', 'now', 'now')", [$device, $user]);
        }
        $total = self::WRITERS * self::BATCHES * self::OPS;

        $reader = self::start('sync-reader.php', [$database, $user, $ws, (string) $total]);
        $writers = array_map(
            static fn(string $device) => self::start('sync-writer.php', [$database, $user, $ws, $device, (string) self::BATCHES, (string) self::OPS]),
            $devices,
        );
        foreach ($writers as $writer) {
            self::assertSame(array_fill(0, self::BATCHES * self::OPS, 'applied'), self::finish($writer));
        }
        $seen = self::finish($reader);

        self::assertSame(range(1, $total), array_column(Sql::rows($db, 'select seq from changes where workspace_id = ? order by seq', [$ws]), 'seq'));
        self::assertSame(range(1, $total), $seen);
    }

    public function testWithoutTheLockTwoWritersWouldTakeTheSameNumber(): void
    {
        $mysql = TestDatabase::mysqlConfig();
        if ($mysql === null) {
            self::markTestSkipped('MariaDB/MySQL only; SQLite has one writer at a time');
        }
        $a = TestDatabase::open();
        $b = Database::openMysql($mysql);
        $user = Ids::uuid();
        $ws = Ids::uuid();
        Sql::run($a, "insert into users (id, email, password_hash, created_at) values (?, 'a@example.com', 'h', 'now')", [$user]);
        Sql::run($a, "insert into workspaces (id, name, owner_id, created_at) values (?, 'Personal', ?, 'now')", [$ws, $user]);
        $next = static fn(\PDO $db): int => (int) Sql::run($db, 'select coalesce(max(seq), 0) + 1 from changes where workspace_id = ?', [$ws])->fetchColumn();
        $insert = 'insert into changes (workspace_id, seq, op_id, device_id, entity, entity_id, kind, revision, payload, applied_at) values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)';

        // A takes number 1 and has not committed yet: B, reading what is committed, picks 1 as well.
        Transaction::begin($a);
        Sql::run($a, $insert, [$ws, $next($a), Ids::uuid(), Ids::uuid(), 'document', Ids::uuid(), 'create', '{}', 'now']);
        Transaction::begin($b);
        self::assertSame(1, $next($b));
        $b->exec('rollback');

        // With the lock that Apply takes first, B has to wait for A instead.
        Sql::run($a, 'select id from workspaces where id = ? for update', [$ws]);
        Transaction::begin($b);
        try {
            Sql::run($b, 'select id from workspaces where id = ? for update nowait', [$ws]);
            self::fail('B got the lock while A held it');
        } catch (\PDOException $error) {
            self::assertContains($error->errorInfo[1] ?? null, [1205, 3572], $error->getMessage());
        } finally {
            $b->exec('rollback');
            $a->exec('rollback');
        }
    }

    /**
     * @param list<string> $args
     *
     * @return array{0: resource, 1: array<int, resource>}
     */
    private static function start(string $script, array $args): array
    {
        $command = [\PHP_BINARY, '-d', 'error_reporting=' . (E_ALL & ~E_DEPRECATED), __DIR__ . "/../workers/{$script}", ...$args];
        $process = proc_open($command, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        self::assertIsResource($process);

        return [$process, $pipes];
    }

    /**
     * @param array{0: resource, 1: array<int, resource>} $started
     *
     * @return list<mixed>
     */
    private static function finish(array $started): array
    {
        [$process, $pipes] = $started;
        $out = (string) stream_get_contents($pipes[1]);
        $err = (string) stream_get_contents($pipes[2]);
        proc_close($process);
        $decoded = json_decode($out, true);
        self::assertIsArray($decoded, "worker output: {$out}{$err}");

        /** @var list<mixed> */
        return $decoded;
    }
}
