<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Cli\Backup;
use NotionAlt\Cli\Console;
use NotionAlt\Config\ConfigLoader;
use NotionAlt\Database\Database;
use NotionAlt\Database\DatabaseCopy;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use NotionAlt\Search\SearchIndex;
use NotionAlt\Support\Ids;
use NotionAlt\Tests\TempDir;
use NotionAlt\Tests\TestDatabase;
use PHPUnit\Framework\TestCase;

/** Moving data between SQLite and MariaDB/MySQL: `db:copy`, backup and restore (ADR 0024). */
final class DatabaseCopyTest extends TestCase
{
    use TempDir;

    private const USER = '00000000-0000-4000-8000-000000000001';
    private const WS = '00000000-0000-4000-8000-000000000002';
    private const DOC = '00000000-0000-4000-8000-000000000003';
    private const DELETED = '00000000-0000-4000-8000-000000000004';

    public function testCopiesEveryTableAndMarksPagesForReindexing(): void
    {
        $from = $this->sqlite('from');
        self::fill($from);
        $to = $this->sqlite('to');

        $counts = DatabaseCopy::copy($from, $to);

        self::assertSame(2, $counts['documents']);
        self::assertSame(self::dump($from), self::dump($to));
        // Insertion order survives: metrics are rendered in it.
        self::assertSame(['z_total', 'a_total'], array_column(Sql::rows($to, 'select name from metrics order by rowid'), 'name'));
        self::assertSame([self::DOC], array_column(Sql::rows($to, 'select document_id from search_dirty'), 'document_id'));
        self::assertSame(['Reiseplanung'], array_column(SearchIndex::searchWorkspace($to, self::USER, self::WS, 'alpen') ?? [], 'title'));
    }

    public function testRefusesATargetWithData(): void
    {
        $from = $this->sqlite('from');
        self::fill($from);
        $to = $this->sqlite('to');
        Sql::run($to, "insert into settings (\"key\", value) values ('x', 'y')");

        $this->expectExceptionMessage('The target database is not empty (table settings)');
        DatabaseCopy::copy($from, $to);
    }

    public function testRefusesDatabasesAtDifferentMigrations(): void
    {
        $from = Database::open($this->tempDir() . '/old.sqlite');
        (new Migrator($from, \array_slice(Migrator::all(), 0, 16, true)))->migrateToLatest();

        $this->expectExceptionMessage('Source and target are not at the same migration');
        DatabaseCopy::copy($from, $this->sqlite('to'));
    }

    public function testMovesBetweenSqliteAndMysql(): void
    {
        self::requireMysql();
        $sqlite = $this->sqlite('from');
        self::fill($sqlite);
        $mysql = TestDatabase::open();

        DatabaseCopy::copy($sqlite, $mysql);
        self::assertSame(self::dump($sqlite), self::dump($mysql));
        self::assertSame(['z_total', 'a_total'], array_column(Sql::rows($mysql, 'select name from metrics order by id'), 'name'));
        self::assertSame(['Reiseplanung'], array_column(SearchIndex::searchWorkspace($mysql, self::USER, self::WS, 'alpen') ?? [], 'title'));

        $back = $this->sqlite('back');
        DatabaseCopy::copy($mysql, $back);
        self::assertSame(self::dump($sqlite), self::dump($back));
    }

    public function testConsoleCopiesASqliteFileIntoTheConfiguredDatabase(): void
    {
        $source = $this->tempDir() . '/old.sqlite';
        self::fill($this->sqlite('old'));
        $config = ConfigLoader::load(['DATA_DIR' => $this->tempDir() . '/data'], '/');
        $stdout = fopen('php://memory', 'r+');
        $stderr = fopen('php://memory', 'r+');
        self::assertNotFalse($stdout);
        self::assertNotFalse($stderr);
        $console = new Console($config, $stdout, $stderr);

        self::assertSame(0, $console->run(['db:copy', $source]));
        rewind($stdout);
        self::assertStringStartsWith('{"copied":', (string) stream_get_contents($stdout));
        self::assertSame(self::dump(Database::open($source)), self::dump(Database::open($config->databasePath)));
        // A second copy would mix two installations.
        self::assertSame(1, $console->run(['db:copy', $source]));
        self::assertSame(1, $console->run(['db:copy', $this->tempDir() . '/missing.sqlite']));
        self::assertSame(2, $console->run(['db:copy']));
    }

    public function testBackupOfMysqlRestoresIntoSqliteAndBack(): void
    {
        self::requireMysql();
        $mysql = TestDatabase::open();
        self::fill($mysql);
        $expected = self::dump($mysql);
        $url = (string) getenv('TEST_DATABASE_URL');
        $mysqlConfig = ConfigLoader::load(['DATA_DIR' => $this->tempDir() . '/mysql-data', 'DATABASE_URL' => $url], '/');
        $sqliteConfig = ConfigLoader::load(['DATA_DIR' => $this->tempDir() . '/sqlite-data'], '/');

        ['dir' => $dir, 'manifest' => $manifest] = Backup::create($mysqlConfig, $this->tempDir() . '/backups');
        // One database file, no WAL beside it: a restore copies only app.sqlite.
        self::assertSame(['app.sqlite'], array_column($manifest['files'], 'path'));
        Backup::restore($sqliteConfig, $dir);
        $sqlite = Database::open($sqliteConfig->databasePath);
        self::assertSame(self::lifted($expected), self::dump($sqlite));

        // The filled MariaDB/MySQL database is only replaced with --force.
        try {
            Backup::restore($mysqlConfig, $dir);
            self::fail('restore replaced a filled database');
        } catch (\RuntimeException $error) {
            self::assertStringContainsString('is not empty', $error->getMessage());
        }
        Backup::restore($mysqlConfig, $dir, force: true);
        // Restored from the backup, whose sequence numbers were lifted once more.
        self::assertSame(self::lifted($expected), self::dump($mysql));
    }

    public function testForcedRestoreOfAnUnusableBackupKeepsTheData(): void
    {
        self::requireMysql();
        $mysql = TestDatabase::open();
        self::fill($mysql);
        $expected = self::dump($mysql);
        $config = ConfigLoader::load(['DATA_DIR' => $this->tempDir() . '/data', 'DATABASE_URL' => (string) getenv('TEST_DATABASE_URL')], '/');
        ['dir' => $dir, 'manifest' => $manifest] = Backup::create($config, $this->tempDir() . '/backups');
        // A backup of a newer version: this server cannot migrate it.
        $file = "{$dir}/app.sqlite";
        $backup = new \PDO("sqlite:{$file}");
        $backup->exec("insert into kysely_migration (name, timestamp) values ('9999_future', '2099-01-01T00:00:00.000Z')");
        unset($backup);
        $manifest['files'][0] = ['path' => 'app.sqlite', 'size' => (int) filesize($file), 'sha256' => (string) hash_file('sha256', $file)];
        file_put_contents("{$dir}/manifest.json", Backup::prettyJson($manifest));

        try {
            Backup::restore($config, $dir, force: true);
            self::fail('restored a backup of a newer version');
        } catch (\RuntimeException $error) {
            self::assertStringContainsString('9999_future', $error->getMessage());
        }
        self::assertSame($expected, self::dump($mysql));
    }

    public function testConsoleTakesTheSourceFromTheEnvironment(): void
    {
        $source = $this->tempDir() . '/old.sqlite';
        self::fill($this->sqlite('old'));
        $config = ConfigLoader::load(['DATA_DIR' => $this->tempDir() . '/data'], '/');
        $stdout = fopen('php://memory', 'r+');
        self::assertNotFalse($stdout);
        putenv("DB_COPY_SOURCE={$source}");
        try {
            self::assertSame(0, (new Console($config, $stdout))->run(['db:copy']));
        } finally {
            putenv('DB_COPY_SOURCE');
        }
        self::assertSame(self::dump(Database::open($source)), self::dump(Database::open($config->databasePath)));
    }

    private function sqlite(string $name): \PDO
    {
        $db = Database::open($this->tempDir() . "/{$name}.sqlite");
        (new Migrator($db))->migrateToLatest();

        return $db;
    }

    private static function requireMysql(): void
    {
        if (TestDatabase::mysqlConfig() === null) {
            self::markTestSkipped('needs TEST_DATABASE_URL (MariaDB/MySQL)');
        }
    }

    private static function fill(\PDO $db): void
    {
        $now = Ids::iso(1_700_000_000_000);
        Sql::run($db, 'insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)', [self::USER, 'alice@example.com', 'h', $now]);
        Sql::run($db, 'insert into workspaces (id, name, owner_id, created_at, compacted_seq) values (?, ?, ?, ?, 3)', [self::WS, 'Wörkspace 😀', self::USER, $now]);
        foreach ([[self::DOC, 'Reiseplanung', null], [self::DELETED, 'Weg', $now]] as [$id, $title, $deleted]) {
            Sql::run(
                $db,
                'insert into documents (id, workspace_id, parent_id, title, sort_key, favorite, created_at, updated_at, revision, deleted_at, icon, cover) values (?, ?, null, ?, ?, 0, ?, ?, 1, ?, null, null)',
                [$id, self::WS, $title, 'a', $now, $now, $deleted],
            );
        }
        Sql::run(
            $db,
            'insert into blocks (id, workspace_id, document_id, type, content, attrs, sort_key, revision, deleted_at) values (?, ?, ?, ?, ?, ?, ?, 1, null)',
            [Ids::uuid(), self::WS, self::DOC, 'paragraph', 'Über die **Alpen**', '{"indent":0}', 'a'],
        );
        Sql::run(
            $db,
            'insert into changes (workspace_id, seq, op_id, device_id, entity, entity_id, kind, revision, payload, applied_at) values (?, 7, ?, ?, ?, ?, ?, 1, ?, ?)',
            [self::WS, Ids::uuid(), Ids::uuid(), 'document', self::DOC, 'create', '{"title":"Reiseplanung"}', $now],
        );
        Sql::run($db, 'insert into settings ("key", value) values (?, ?)', ['installation', 'abc']);
        foreach (['z_total', 'a_total'] as $name) {
            Sql::run($db, 'insert into metrics (name, labels, value) values (?, ?, 1.5)', [$name, '{}']);
        }
    }

    /**
     * Every copied table, rows in a fixed order, without MariaDB/MySQL's `metrics.id`.
     *
     * @return array<string, list<array<string, mixed>>>
     */
    private static function dump(\PDO $db): array
    {
        $dump = [];
        foreach (DatabaseCopy::tables($db) as $table) {
            $rows = Sql::rows($db, "select * from \"{$table}\"");
            foreach ($rows as &$row) {
                unset($row[$table === 'metrics' ? 'id' : '']);
                ksort($row);
            }
            unset($row);
            usort($rows, static fn(array $a, array $b): int => strcmp(serialize($a), serialize($b)));
            $dump[$table] = $rows;
        }

        return $dump;
    }

    /**
     * @param array<string, list<array<string, mixed>>> $dump
     *
     * @return array<string, list<array<string, mixed>>>
     */
    private static function lifted(array $dump): array
    {
        $dump['workspaces'][0]['compacted_seq'] = 7 + Backup::RESTORE_SEQ_GAP;

        return $dump;
    }
}
