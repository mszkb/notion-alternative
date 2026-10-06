<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Database\Database;
use NotionAlt\Database\Migration;
use NotionAlt\Database\MigrationException;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use NotionAlt\Tests\TempDir;
use PHPUnit\Framework\TestCase;

/**
 * The PHP migrations must produce the schema of the Node server and continue its databases
 * (ADR 0018). Fixtures come from apps/server/scripts/dump-php-fixtures.ts.
 */
final class MigratorTest extends TestCase
{
    use TempDir;

    private const FIXTURES = __DIR__ . '/../fixtures';

    private const ALL = [
        '0001_initial',
        '0002_devices',
        '0003_sync',
        '0004_change_log_floor',
        '0005_search',
        '0006_conflicts',
        '0007_push',
        '0008_attachments',
        '0009_search_rowids',
        '0010_search_dirty',
        '0011_snapshot_paging',
    ];

    public function testFreshDatabaseHasTheSchemaOfTheNodeServer(): void
    {
        $db = Database::open($this->tempDir() . '/data/app.sqlite');

        self::assertSame(self::ALL, (new Migrator($db))->migrateToLatest());
        self::assertSame(self::nodeSchema(), self::schema($db));
        self::assertSame([['id' => 'migration_lock', 'is_locked' => 0]], self::rows($db, 'select * from kysely_migration_lock'));
        foreach (self::rows($db, 'select timestamp from kysely_migration') as $row) {
            self::assertIsString($row['timestamp']);
            self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/', $row['timestamp']);
        }
    }

    public function testPragmasMatchTheNodeServer(): void
    {
        $db = Database::open($this->tempDir() . '/app.sqlite');

        self::assertSame([['journal_mode' => 'wal']], self::rows($db, 'pragma journal_mode'));
        self::assertSame([['foreign_keys' => 1]], self::rows($db, 'pragma foreign_keys'));
        self::assertSame([['timeout' => 5000]], self::rows($db, 'pragma busy_timeout'));
    }

    public function testRunningAgainChangesNothing(): void
    {
        $db = Database::open(':memory:');
        (new Migrator($db))->migrateToLatest();

        self::assertSame([], (new Migrator($db))->migrateToLatest());
        self::assertSame(self::nodeSchema(), self::schema($db));
    }

    public function testOpensADatabaseOfTheNodeServerWithoutChange(): void
    {
        $file = $this->copyFixture('node-latest.sqlite');
        $before = self::snapshot(new \PDO('sqlite:' . $file));

        $db = Database::open($file);
        self::assertSame([], (new Migrator($db))->pending());
        self::assertSame([], (new Migrator($db))->migrateToLatest());

        self::assertSame($before, self::snapshot($db));
        self::assertSame(self::nodeSchema(), self::schema($db));
    }

    public function testContinuesADatabaseOfTheNodeServerAtAnIntermediateVersion(): void
    {
        $db = Database::open($this->copyFixture('node-0004.sqlite'));
        $node = new \PDO('sqlite:' . $this->copyFixture('node-latest.sqlite'));
        $kept = self::rows($db, 'select name, timestamp from kysely_migration order by name');

        self::assertSame(\array_slice(self::ALL, 4), (new Migrator($db))->migrateToLatest());

        self::assertSame(self::nodeSchema(), self::schema($db));
        $names = array_column(self::rows($db, 'select name from kysely_migration order by name'), 'name');
        self::assertSame(self::ALL, $names);
        self::assertSame($kept, \array_slice(self::rows($db, 'select name, timestamp from kysely_migration order by name'), 0, 4));
        // The search index filled by 0005 (plain text of the blocks) and renumbered by 0009.
        foreach ([
            'select rowid, document_id, workspace_id, title, body from search_index order by rowid',
            'select id, document_id from search_documents order by id',
            'select * from documents order by id',
            'select * from blocks order by id',
            'select * from workspaces order by id',
            'select * from sessions order by id',
        ] as $query) {
            self::assertSame(self::rows($node, $query), self::rows($db, $query), $query);
        }
        self::assertCount(3, self::rows($db, 'select * from search_index'));
        // FTS works on the migrated index.
        self::assertSame(
            [['document_id' => '3f2b8c1e-7d4a-4b6e-9c0f-1a2b3c4d5e6f']],
            self::rows($db, "select document_id from search_index where search_index match 'milch'"),
        );
    }

    public function testFailsOnAMigrationThisServerDoesNotKnow(): void
    {
        $db = Database::open(':memory:');
        (new Migrator($db))->migrateToLatest();
        $db->exec("insert into kysely_migration (name, timestamp) values ('0099_future', '2030-01-01T00:00:00.000Z')");

        $this->expectException(MigrationException::class);
        $this->expectExceptionMessage('corrupted migrations: previously executed migration 0099_future is missing');
        (new Migrator($db))->migrateToLatest();
    }

    public function testFailsWhenMigrationsWereAppliedOutOfOrder(): void
    {
        $db = Database::open(':memory:');
        (new Migrator($db))->migrateToLatest();
        $db->exec("delete from kysely_migration where name = '0002_devices'");

        $this->expectException(MigrationException::class);
        $this->expectExceptionMessage('corrupted migrations: expected previously executed migration 0003_sync to be at index 1');
        (new Migrator($db))->migrateToLatest();
    }

    public function testWaitsForTheLockOfAnotherProcess(): void
    {
        $db = Database::open(':memory:');
        $migrator = new Migrator($db, ['0001_initial' => new class implements Migration {
            public function up(\PDO $db): void
            {
                $db->exec('create table t (id integer)');
            }
        }], 0.2);
        $db->exec('create table "kysely_migration_lock" ("id" varchar(255) not null primary key, "is_locked" integer default 0 not null)');
        $db->exec("insert into kysely_migration_lock values ('migration_lock', 1)");

        try {
            $migrator->migrateToLatest();
            self::fail('expected a lock error');
        } catch (MigrationException $error) {
            self::assertStringContainsString('migration lock is held', $error->getMessage());
        }
        self::assertSame([], self::rows($db, "select name from sqlite_master where name = 't'"));

        $db->exec('update kysely_migration_lock set is_locked = 0');
        self::assertSame(['0001_initial'], $migrator->migrateToLatest());
        self::assertSame([['is_locked' => 0]], self::rows($db, 'select is_locked from kysely_migration_lock'));
    }

    public function testRollsBackAFailedMigrationAndReleasesTheLock(): void
    {
        $db = Database::open(':memory:');
        $migrator = new Migrator($db, [
            '0001_initial' => new class implements Migration {
                public function up(\PDO $db): void
                {
                    $db->exec('create table a (id integer)');
                }
            },
            '0002_broken' => new class implements Migration {
                public function up(\PDO $db): void
                {
                    $db->exec('create table b (id integer)');
                    $db->exec('this is not sql');
                }
            },
        ]);

        try {
            $migrator->migrateToLatest();
            self::fail('expected a migration error');
        } catch (MigrationException $error) {
            self::assertStringStartsWith('Migration 0002_broken failed', $error->getMessage());
        }
        self::assertSame([['name' => '0001_initial']], self::rows($db, 'select name from kysely_migration'));
        self::assertSame([], self::rows($db, "select name from sqlite_master where name = 'b'"));
        self::assertSame([['is_locked' => 0]], self::rows($db, 'select is_locked from kysely_migration_lock'));
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function nodeSchema(): array
    {
        $json = file_get_contents(self::FIXTURES . '/node-schema.json');
        self::assertIsString($json);
        $schema = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($schema);

        /** @var list<array<string, mixed>> $schema */
        return $schema;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function schema(\PDO $db): array
    {
        return self::rows($db, 'select type, name, tbl_name, sql from sqlite_master order by type, name');
    }

    /**
     * Schema, bookkeeping and content of all tables.
     *
     * @return array<string, mixed>
     */
    private static function snapshot(\PDO $db): array
    {
        $snapshot = ['schema' => self::schema($db)];
        foreach (self::rows($db, "select name from sqlite_master where type = 'table' order by name") as $table) {
            $name = $table['name'];
            self::assertIsString($name);
            // Some FTS5 shadow tables have no rowid: compare the rows as a sorted set.
            $rows = [];
            foreach (self::rows($db, "select * from \"{$name}\"") as $row) {
                $rows[] = json_encode(array_map(
                    static fn(mixed $value): mixed => \is_string($value) ? bin2hex($value) : $value,
                    $row,
                ), JSON_THROW_ON_ERROR);
            }
            sort($rows);
            $snapshot[$name] = $rows;
        }

        return $snapshot;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function rows(\PDO $db, string $query): array
    {
        return Sql::rows($db, $query);
    }

    private function copyFixture(string $name): string
    {
        $target = $this->tempDir() . '/' . $name;
        self::assertTrue(copy(self::FIXTURES . '/' . $name, $target));

        return $target;
    }
}
