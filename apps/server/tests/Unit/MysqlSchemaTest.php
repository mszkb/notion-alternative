<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Database\Database;
use NotionAlt\Database\MigrationException;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Tests\TestDatabase;
use PHPUnit\Framework\TestCase;

/**
 * The schema on MariaDB/MySQL (ADR 0024): one base migration standing for 0001–0017, with the
 * same tables, columns, keys and references as on SQLite. Runs with TEST_DATABASE_URL only.
 */
final class MysqlSchemaTest extends TestCase
{
    public function testTheBaseSchemaCountsAsMigrations0001To0017(): void
    {
        $db = TestDatabase::emptyMysql();

        $applied = (new Migrator($db))->migrateToLatest();

        self::assertSame(array_keys(Migrator::all()), $applied);
        self::assertSame($applied, array_column(Sql::rows($db, 'select "name" from "kysely_migration" order by "name"'), 'name'));
        self::assertSame([], (new Migrator($db))->migrateToLatest());
        self::assertSame([['is_locked' => 0]], Sql::rows($db, 'select is_locked from kysely_migration_lock'));
    }

    public function testHasTheStructureOfTheSqliteSchema(): void
    {
        $mysql = TestDatabase::emptyMysql();
        (new Migrator($mysql))->migrateToLatest();
        $sqlite = Database::open(':memory:');
        (new Migrator($sqlite))->migrateToLatest();

        $expected = self::structure($sqlite);
        $actual = [];
        foreach (self::structure($mysql) as $table => $shape) {
            if ($table === 'metrics') {
                // SQLite keeps the insertion order of metrics in the rowid, MariaDB/MySQL in `id`.
                self::assertArrayHasKey('id', $shape['columns']);
                unset($shape['columns']['id']);
                $shape['unique'] = array_values(array_filter($shape['unique'], static fn(array $key): bool => $key !== ['id']));
            }
            // InnoDB needs an index on every foreign key; SQLite does without.
            $referencing = array_column($shape['foreignKeys'], 0);
            $wanted = $expected[$table]['indexes'] ?? [];
            $shape['indexes'] = array_values(array_filter(
                $shape['indexes'],
                static fn(array $index): bool => \in_array($index, $wanted, true) || !\in_array($index, $referencing, true),
            ));
            $actual[$table] = $shape;
        }
        self::assertSame($expected, $actual);
    }

    public function testRefusesADatabaseWithOnlySomeOfTheBaseMigrations(): void
    {
        $db = TestDatabase::emptyMysql();
        $db->exec('create table "kysely_migration" ("name" varchar(255) not null primary key, "timestamp" varchar(255) not null)');
        Sql::run($db, 'insert into "kysely_migration" values (?, ?)', ['0001_initial', Migrator::isoTimestamp()]);

        $this->expectException(MigrationException::class);
        $this->expectExceptionMessage('only some of them were executed');
        (new Migrator($db))->migrateToLatest();
    }

    public function testCreatesTheMissingTablesAfterAnInterruptedAttempt(): void
    {
        $db = TestDatabase::emptyMysql();
        (new Migrator($db))->migrateToLatest();
        // DDL commits at once: a crash can leave tables without bookkeeping rows.
        $db->exec('drop table "share_links"');
        $db->exec('delete from "kysely_migration"');

        self::assertSame(array_keys(Migrator::all()), (new Migrator($db))->migrateToLatest());
        self::assertSame([], Sql::rows($db, 'select * from share_links'));
    }

    /**
     * Tables (without the search tables, which differ by design) with their columns (nullable or
     * not), unique keys including the primary key, other indexes and foreign keys.
     *
     * @return array<string, array{columns: array<string, bool>, unique: list<list<string>>, indexes: list<list<string>>, foreignKeys: list<array{list<string>, string, list<string>, string}>}>
     */
    private static function structure(\PDO $db): array
    {
        $mysql = Database::isMysql($db);
        $structure = [];
        $tables = $mysql
            ? Sql::run($db, 'select table_name from information_schema.tables where table_schema = database()')->fetchAll(\PDO::FETCH_COLUMN)
            : Sql::run($db, "select name from sqlite_master where type = 'table'")->fetchAll(\PDO::FETCH_COLUMN);
        foreach ($tables as $table) {
            \assert(\is_string($table));
            if (preg_match('/^(search_|sqlite_|kysely_)/', $table) === 1) {
                continue;
            }
            $shape = $mysql ? self::mysqlTable($db, $table) : self::sqliteTable($db, $table);
            ksort($shape['columns']);
            sort($shape['unique']);
            sort($shape['indexes']);
            sort($shape['foreignKeys']);
            $structure[$table] = $shape;
        }
        ksort($structure);

        return $structure;
    }

    /**
     * @return array{columns: array<string, bool>, unique: list<list<string>>, indexes: list<list<string>>, foreignKeys: list<array{list<string>, string, list<string>, string}>}
     */
    private static function sqliteTable(\PDO $db, string $table): array
    {
        $columns = [];
        $primary = [];
        foreach (Sql::rows($db, "pragma table_info(\"{$table}\")") as $column) {
            $columns[Row::string($column, 'name')] = Row::int($column, 'notnull') === 0 && Row::int($column, 'pk') === 0;
            if (Row::int($column, 'pk') > 0) {
                $primary[Row::int($column, 'pk')] = Row::string($column, 'name');
            }
        }
        ksort($primary);
        $unique = [array_values($primary)];
        $indexes = [];
        foreach (Sql::rows($db, "pragma index_list(\"{$table}\")") as $index) {
            if ($index['origin'] === 'pk') {
                continue;
            }
            $names = array_map(static fn(array $row): string => Row::string($row, 'name'), Sql::rows($db, 'pragma index_info("' . Row::string($index, 'name') . '")'));
            if (Row::int($index, 'unique') === 1) {
                $unique[] = $names;
            } else {
                $indexes[] = $names;
            }
        }
        $foreignKeys = [];
        foreach (Sql::rows($db, "pragma foreign_key_list(\"{$table}\")") as $key) {
            $foreignKeys[] = [[Row::string($key, 'from')], Row::string($key, 'table'), [Row::string($key, 'to')], strtolower(Row::string($key, 'on_delete'))];
        }

        return ['columns' => $columns, 'unique' => $unique, 'indexes' => $indexes, 'foreignKeys' => $foreignKeys];
    }

    /**
     * @return array{columns: array<string, bool>, unique: list<list<string>>, indexes: list<list<string>>, foreignKeys: list<array{list<string>, string, list<string>, string}>}
     */
    private static function mysqlTable(\PDO $db, string $table): array
    {
        $columns = [];
        foreach (Sql::rows($db, 'select column_name as name, is_nullable as nullable from information_schema.columns where table_schema = database() and table_name = ?', [$table]) as $column) {
            $columns[Row::string($column, 'name')] = $column['nullable'] === 'YES';
        }
        $byIndex = [];
        foreach (Sql::rows($db, 'select index_name as name, non_unique as non_unique, column_name as col from information_schema.statistics where table_schema = database() and table_name = ? order by index_name, seq_in_index', [$table]) as $row) {
            $byIndex[Row::string($row, 'name')]['unique'] = Row::int($row, 'non_unique') === 0;
            $byIndex[Row::string($row, 'name')]['columns'][] = Row::string($row, 'col');
        }
        $unique = [];
        $indexes = [];
        foreach ($byIndex as $index) {
            if ($index['unique']) {
                $unique[] = $index['columns'];
            } else {
                $indexes[] = $index['columns'];
            }
        }
        $foreignKeys = [];
        foreach (Sql::rows($db, 'select k.column_name as col, k.referenced_table_name as ref, k.referenced_column_name as refcol, r.delete_rule as rule
            from information_schema.key_column_usage k join information_schema.referential_constraints r
              on r.constraint_schema = k.constraint_schema and r.constraint_name = k.constraint_name
            where k.table_schema = database() and k.table_name = ? and k.referenced_table_name is not null', [$table]) as $key) {
            $foreignKeys[] = [[Row::string($key, 'col')], Row::string($key, 'ref'), [Row::string($key, 'refcol')], strtolower(Row::string($key, 'rule'))];
        }

        return ['columns' => $columns, 'unique' => $unique, 'indexes' => $indexes, 'foreignKeys' => $foreignKeys];
    }
}
