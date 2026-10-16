<?php

declare(strict_types=1);

namespace NotionAlt\Database;

use Doctrine\DBAL\Connection\StaticServerVersionProvider;
use Doctrine\DBAL\Driver\PDO\MySQL\Driver as MysqlDriver;
use Doctrine\DBAL\Platforms\AbstractPlatform;
use Doctrine\DBAL\Platforms\SQLitePlatform;
use NotionAlt\Config\Config;
use NotionAlt\Config\MysqlConfig;

final class Database
{
    /**
     * Session settings on MariaDB/MySQL, the same on every host whatever the server defaults are:
     * standard SQL quoting of identifiers ("name"), strict inserts, no zero dates.
     */
    private const MYSQL_SQL_MODE = 'ANSI_QUOTES,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

    /**
     * The configured database: MariaDB/MySQL if set, else the SQLite file (ADR 0024). With
     * MariaDB/MySQL the data directory still holds attachments, backups and lock files.
     */
    public static function connect(Config $config): \PDO
    {
        if ($config->mysql === null) {
            return self::open($config->databasePath);
        }
        self::createDirectory(\dirname($config->databasePath));

        return self::openMysql($config->mysql);
    }

    /**
     * Opens MariaDB or MySQL. Texts compare byte by byte (`utf8mb4_bin`) like SQLite's `=`, and
     * each statement sees what other transactions committed (`read committed`), which comes
     * closest to SQLite, where writers run one after the other.
     */
    public static function openMysql(MysqlConfig $config): \PDO
    {
        $dsn = "mysql:host={$config->host};port={$config->port};dbname={$config->database};charset=utf8mb4";
        $pdo = new \PDO($dsn, $config->user, $config->password, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_STRINGIFY_FETCHES => false,
            // Real prepared statements: `limit ?` gets an integer, and integers come back as int.
            \PDO::ATTR_EMULATE_PREPARES => false,
            // rowCount() counts matched rows like SQLite, not only changed ones (an update to the
            // same value is still a hit).
            self::mysqlAttribute('FOUND_ROWS') => true,
        ]);
        $pdo->exec('set names utf8mb4 collate utf8mb4_bin');
        $pdo->exec("set session sql_mode = '" . self::MYSQL_SQL_MODE . "'");
        $pdo->exec('set session transaction isolation level read committed');
        $pdo->exec("set time_zone = '+00:00'");

        return $pdo;
    }

    /**
     * `PDO::MYSQL_ATTR_<name>`, which PHP 8.5 deprecates for `Pdo\Mysql::ATTR_<name>` (PHP 8.4).
     *
     * @param 'FOUND_ROWS'|'USE_BUFFERED_QUERY' $name
     */
    public static function mysqlAttribute(string $name): int
    {
        /** @var int */
        return \constant(\PHP_VERSION_ID >= 80400 ? "Pdo\\Mysql::ATTR_{$name}" : "PDO::MYSQL_ATTR_{$name}");
    }

    /**
     * Which server a `version()` string names and whether it is supported (ADR 0024: MariaDB 10.11
     * or MySQL 8.4 and newer). Web hosts often call MariaDB "MySQL".
     *
     * @return array{name: string, version: string, supported: bool}
     */
    public static function mysqlServer(string $version): array
    {
        $mariadb = stripos($version, 'mariadb') !== false;
        // Older MariaDB versions report themselves as `5.5.5-10.6.12-MariaDB` to old clients.
        $number = preg_match('/^(?:5\.5\.5-)?(\d+\.\d+\.\d+)/', $version, $match) === 1 ? $match[1] : '0.0.0';

        return [
            'name' => $mariadb ? 'MariaDB' : 'MySQL',
            'version' => $number,
            'supported' => version_compare($number, $mariadb ? '10.11.0' : '8.4.0', '>='),
        ];
    }

    public static function isMysql(\PDO $db): bool
    {
        return $db->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'mysql';
    }

    /** The DBAL platform for schema changes; MariaDB and MySQL are told apart by the server version. */
    public static function platform(\PDO $db): AbstractPlatform
    {
        if (!self::isMysql($db)) {
            return new SQLitePlatform();
        }
        $version = $db->getAttribute(\PDO::ATTR_SERVER_VERSION);

        return (new MysqlDriver())->getDatabasePlatform(new StaticServerVersionProvider(\is_string($version) ? $version : ''));
    }

    /** Opens the SQLite database (":memory:" for tests): WAL, foreign keys, busy timeout. */
    public static function open(string $path): \PDO
    {
        if ($path !== ':memory:') {
            self::createDirectory(\dirname($path));
        }
        $pdo = new \PDO('sqlite:' . $path, null, null, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
        // Before WAL: switching the journal mode has to wait for other writers as well.
        $pdo->exec('pragma busy_timeout = 5000');
        $pdo->exec('pragma journal_mode = WAL');
        $pdo->exec('pragma foreign_keys = ON');

        return $pdo;
    }

    private static function createDirectory(string $dir): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0o777, true) && !is_dir($dir)) {
            throw new \RuntimeException("Cannot create the database directory {$dir}");
        }
    }

    /**
     * The search (migration 0005) needs SQLite with FTS5. Fails with a clear message instead of
     * a migration error deep inside the first request.
     */
    public static function assertFts5(): void
    {
        try {
            $probe = new \PDO('sqlite::memory:', null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
            $probe->exec('create virtual table fts5_probe using fts5(content)');
        } catch (\PDOException $error) {
            throw new \RuntimeException(
                'SQLite of this PHP installation has no FTS5 (full-text search); pdo_sqlite with FTS5 is required',
                0,
                $error,
            );
        }
    }
}
