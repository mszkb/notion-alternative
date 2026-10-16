<?php

declare(strict_types=1);

namespace NotionAlt\Tests;

use NotionAlt\Config\ConfigLoader;
use NotionAlt\Config\MysqlConfig;
use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use PHPUnit\Framework\Assert;

/**
 * The database of a test. With `TEST_DATABASE_URL` (`mysql://…`, ADR 0024) the tests run against
 * that MariaDB/MySQL database: migrated once, emptied before every test. Otherwise SQLite.
 */
final class TestDatabase
{
    private static bool $migrated = false;

    /** A migrated, empty database; `$sqlitePath` is used without TEST_DATABASE_URL. */
    public static function open(string $sqlitePath = ':memory:'): \PDO
    {
        $mysql = self::mysqlConfig();
        if ($mysql === null) {
            $db = Database::open($sqlitePath);
            (new Migrator($db))->migrateToLatest();

            return $db;
        }
        $db = Database::openMysql($mysql);
        if (!self::$migrated) {
            (new Migrator($db))->migrateToLatest();
            self::$migrated = true;
        }
        /** @var list<string> $tables */
        $tables = Sql::run($db, "select table_name from information_schema.tables where table_schema = database() and table_name not like 'kysely\\_%'")->fetchAll(\PDO::FETCH_COLUMN);
        $db->exec('set foreign_key_checks = 0');
        foreach ($tables as $table) {
            $db->exec("delete from \"{$table}\"");
        }
        $db->exec('set foreign_key_checks = 1');

        return $db;
    }

    /** The MariaDB/MySQL test database without any table (the next open() migrates again). */
    public static function emptyMysql(): \PDO
    {
        $mysql = self::mysqlConfig();
        if ($mysql === null) {
            Assert::markTestSkipped('needs TEST_DATABASE_URL (MariaDB/MySQL)');
        }
        $db = Database::openMysql($mysql);
        /** @var list<string> $tables */
        $tables = Sql::run($db, 'select table_name from information_schema.tables where table_schema = database()')->fetchAll(\PDO::FETCH_COLUMN);
        $db->exec('set foreign_key_checks = 0');
        foreach ($tables as $table) {
            $db->exec("drop table \"{$table}\"");
        }
        $db->exec('set foreign_key_checks = 1');
        self::$migrated = false;

        return $db;
    }

    public static function mysqlConfig(): ?MysqlConfig
    {
        $url = getenv('TEST_DATABASE_URL');

        return \is_string($url) && $url !== '' ? ConfigLoader::load(['DATABASE_URL' => $url], '/')->mysql : null;
    }

    /** For tests of what only SQLite has (FTS5, the database file, migrations of Node databases). */
    public static function skipOnMysql(): void
    {
        if (self::mysqlConfig() !== null) {
            Assert::markTestSkipped('SQLite only');
        }
    }
}
