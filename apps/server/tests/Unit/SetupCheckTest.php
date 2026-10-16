<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Database\Database;
use NotionAlt\Tests\TempDir;
use NotionAlt\Tests\TestDatabase;
use PHPUnit\Framework\TestCase;

/** The setup check of the web hosting package (`release/check.php`) for SQLite and MariaDB/MySQL. */
final class SetupCheckTest extends TestCase
{
    use TempDir;

    public function testChecksSqliteWithFullTextSearch(): void
    {
        $page = $this->check(['DATA_DIR' => $this->tempDir() . '/data']);

        self::assertStringContainsString('✅ PHP-Erweiterung pdo_sqlite', $page);
        self::assertStringContainsString('✅ SQLite mit Volltextsuche (FTS5)', $page);
        self::assertStringNotContainsString('pdo_mysql', $page);
        self::assertStringNotContainsString('Datenbank:', $page);
    }

    public function testNamesTheMysqlServerThatReallyRuns(): void
    {
        $mysql = TestDatabase::mysqlConfig();
        if ($mysql === null) {
            self::markTestSkipped('needs TEST_DATABASE_URL (MariaDB/MySQL)');
        }
        TestDatabase::open();

        $page = $this->check(['DATA_DIR' => $this->tempDir() . '/data', 'DB_HOST' => $mysql->host, 'DB_PORT' => $mysql->port, 'DB_NAME' => $mysql->database, 'DB_USER' => $mysql->user, 'DB_PASSWORD' => $mysql->password]);

        self::assertStringContainsString('✅ Verbindung zur Datenbank', $page);
        self::assertMatchesRegularExpression('/✅ Datenbank: (MariaDB|MySQL) \d+\.\d+\.\d+/', $page);
        self::assertStringNotContainsString('FTS5', $page);
        // Backups are SQLite files on every database.
        self::assertStringContainsString('✅ PHP-Erweiterung pdo_sqlite', $page);
    }

    public function testReportsAFailedConnectionWithoutDetails(): void
    {
        if (!\extension_loaded('pdo_mysql')) {
            self::markTestSkipped('needs pdo_mysql');
        }
        $page = $this->check(['DATA_DIR' => $this->tempDir() . '/data', 'DB_HOST' => '127.0.0.1', 'DB_PORT' => 1, 'DB_NAME' => 'notion', 'DB_USER' => 'web1', 'DB_PASSWORD' => 'geheim']);

        // An installed app whose database is down must not show its checks to anyone.
        self::assertSame("Keine Verbindung zur Datenbank. PHP-Erweiterung pdo_mysql sowie DB_HOST, DB_NAME, DB_USER und DB_PASSWORD in app/config.php prüfen.\n", $page);
    }

    public function testTellsSupportedServerVersions(): void
    {
        self::assertSame(['name' => 'MariaDB', 'version' => '10.11.19', 'supported' => true], Database::mysqlServer('10.11.19-MariaDB-ubu2204'));
        self::assertSame(['name' => 'MariaDB', 'version' => '10.6.12', 'supported' => false], Database::mysqlServer('5.5.5-10.6.12-MariaDB-log'));
        self::assertSame(['name' => 'MariaDB', 'version' => '11.4.2', 'supported' => true], Database::mysqlServer('11.4.2-MariaDB'));
        self::assertSame(['name' => 'MySQL', 'version' => '8.4.11', 'supported' => true], Database::mysqlServer('8.4.11'));
        self::assertSame(['name' => 'MySQL', 'version' => '8.0.36', 'supported' => false], Database::mysqlServer('8.0.36-0ubuntu0.22.04.1'));
        self::assertFalse(Database::mysqlServer('')['supported']);
    }

    /**
     * Runs check.php as in the release ZIP (`api/check.php` next to `api/app/`).
     *
     * @param array<string, string|int> $config
     */
    private function check(array $config): string
    {
        $api = $this->tempDir() . '/api';
        mkdir("{$api}/app/vendor", 0o777, true);
        copy(__DIR__ . '/../../release/check.php', "{$api}/check.php");
        file_put_contents("{$api}/app/vendor/autoload.php", '<?php require ' . var_export(realpath(__DIR__ . '/../../vendor/autoload.php'), true) . ';');
        file_put_contents("{$api}/app/config.php", '<?php return ' . var_export($config, true) . ';');
        $command = escapeshellarg(\PHP_BINARY) . ' -d error_reporting=' . (E_ALL & ~E_DEPRECATED) . ' ' . escapeshellarg("{$api}/check.php");

        return (string) shell_exec($command . ' 2>&1');
    }
}
