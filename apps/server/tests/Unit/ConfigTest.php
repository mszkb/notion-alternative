<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Config\ConfigException;
use NotionAlt\Config\ConfigLoader;
use NotionAlt\Tests\TempDir;
use PHPUnit\Framework\TestCase;

final class ConfigTest extends TestCase
{
    use TempDir;

    private const APP = '/srv/app';

    public function testDefaultsMatchTheNodeServer(): void
    {
        $config = ConfigLoader::load([], self::APP);

        self::assertSame('info', $config->logLevel);
        self::assertSame('/srv/app/data/app.sqlite', $config->databasePath);
        self::assertFalse($config->allowRegistration);
        self::assertFalse($config->cookieSecure);
        self::assertSame(30, $config->sessionTtlDays);
        self::assertFalse($config->metricsEnabled);
        self::assertTrue($config->trustProxy);
        self::assertFalse(ConfigLoader::load(['TRUST_PROXY' => 'false'], self::APP)->trustProxy);
        self::assertSame(50_000_000, $config->importMaxBytes);
        self::assertSame('/srv/app/data/attachments', $config->attachments->dir);
        self::assertSame(25_000_000, $config->attachments->maxBytes);
        self::assertSame(30, $config->attachments->retentionDays);
        self::assertSame(2_048_000_000, $config->attachments->workspaceQuotaBytes);
        self::assertNull($config->attachments->s3);
        self::assertSame('mailto:admin@localhost', $config->push->subject);
        self::assertSame(
            ['fcm.googleapis.com', 'updates.push.services.mozilla.com', '*.push.apple.com', '*.notify.windows.com'],
            $config->push->allowedHosts,
        );
        self::assertSame(15, $config->authRateLimit->windowMinutes);
        self::assertSame(20, $config->authRateLimit->loginMaxFailuresPerIp);
        self::assertSame(5, $config->authRateLimit->loginMaxFailuresPerEmail);
        self::assertSame(10, $config->authRateLimit->registerMaxAttemptsPerIp);
    }

    public function testTreatsEmptyVariablesAsUnset(): void
    {
        // docker compose passes `${VAR:-}` as "".
        $config = ConfigLoader::load([
            'S3_ENDPOINT' => '',
            'S3_BUCKET' => '',
            'S3_ACCESS_KEY_ID' => '',
            'S3_SECRET_ACCESS_KEY' => '',
            'ATTACHMENT_STORAGE' => 'volume',
            'ALLOW_REGISTRATION' => 'false',
            'LOG_LEVEL' => '',
        ], self::APP);

        self::assertNull($config->attachments->s3);
        self::assertFalse($config->allowRegistration);
        self::assertSame('info', $config->logLevel);
    }

    public function testReadsAndConvertsValues(): void
    {
        $config = ConfigLoader::load([
            'LOG_LEVEL' => 'warn',
            'DATA_DIR' => './var',
            'ALLOW_REGISTRATION' => '1',
            'COOKIE_SECURE' => 'true',
            'SESSION_TTL_DAYS' => ' 7 ',
            'METRICS_ENABLED' => '0',
            'ATTACHMENT_MAX_MB' => '1.5',
            'WORKSPACE_STORAGE_MB' => '0',
            'IMPORT_MAX_MB' => '1e1',
            'ATTACHMENT_RETENTION_DAYS' => '0x10',
            'PUSH_ALLOWED_HOSTS' => ' A.example , ,b.example',
            'HOST' => 'ignored',
            'PORT' => 'not a number but not used',
        ], self::APP);

        self::assertSame('warn', $config->logLevel);
        self::assertSame('/srv/app/var/app.sqlite', $config->databasePath);
        self::assertSame('/srv/app/var/attachments', $config->attachments->dir);
        self::assertTrue($config->allowRegistration);
        self::assertTrue($config->cookieSecure);
        self::assertSame(7, $config->sessionTtlDays);
        self::assertFalse($config->metricsEnabled);
        self::assertSame(1_500_000, $config->attachments->maxBytes);
        self::assertNull($config->attachments->workspaceQuotaBytes);
        self::assertSame(10_000_000, $config->importMaxBytes);
        self::assertSame(16, $config->attachments->retentionDays);
        self::assertSame(['a.example', 'b.example'], $config->push->allowedHosts);
    }

    public function testExplicitPaths(): void
    {
        $config = ConfigLoader::load(['DATABASE_PATH' => '/var/db/x.sqlite', 'ATTACHMENTS_DIR' => 'files/'], self::APP);
        self::assertSame('/var/db/x.sqlite', $config->databasePath);
        self::assertSame('/srv/app/files', $config->attachments->dir);
        self::assertSame(':memory:', ConfigLoader::load(['DATABASE_PATH' => ':memory:'], self::APP)->databasePath);
    }

    public function testRejectsInvalidValuesByName(): void
    {
        try {
            ConfigLoader::load([
                'LOG_LEVEL' => 'verbose',
                'ALLOW_REGISTRATION' => 'yes',
                'SESSION_TTL_DAYS' => '366',
                'LOGIN_MAX_FAILURES_PER_IP' => '1.5',
                'ATTACHMENT_MAX_MB' => 'abc',
                'S3_ENDPOINT' => 'not a url',
            ], self::APP);
            self::fail('expected a ConfigException');
        } catch (ConfigException $error) {
            self::assertSame(
                'Invalid configuration: LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent; '
                . 'ALLOW_REGISTRATION must be true, false, 1 or 0; SESSION_TTL_DAYS must be an integer between 1 and 365; '
                . 'LOGIN_MAX_FAILURES_PER_IP must be an integer of at least 1; ATTACHMENT_MAX_MB must be a number between 1 and 1024; '
                . 'S3_ENDPOINT must be a URL',
                $error->getMessage(),
            );
        }
    }

    public function testS3NeedsAllVariablesAndNeverLeaksValues(): void
    {
        try {
            ConfigLoader::load([
                'ATTACHMENT_STORAGE' => 's3',
                'S3_ACCESS_KEY_ID' => 'AKIA-secret-id',
                'S3_SECRET_ACCESS_KEY' => '',
            ], self::APP);
            self::fail('expected a ConfigException');
        } catch (ConfigException $error) {
            self::assertSame('ATTACHMENT_STORAGE=s3 needs S3_ENDPOINT, S3_BUCKET, S3_SECRET_ACCESS_KEY', $error->getMessage());
        }

        $config = ConfigLoader::load([
            'ATTACHMENT_STORAGE' => 's3',
            'S3_ENDPOINT' => 'https://s3.example.com',
            'S3_BUCKET' => 'notes',
            'S3_ACCESS_KEY_ID' => 'id',
            'S3_SECRET_ACCESS_KEY' => 'secret',
            'S3_FORCE_PATH_STYLE' => 'false',
        ], self::APP);
        self::assertNotNull($config->attachments->s3);
        self::assertSame('https://s3.example.com', $config->attachments->s3->endpoint);
        self::assertSame('us-east-1', $config->attachments->s3->region);
        self::assertSame('notes', $config->attachments->s3->bucket);
        self::assertFalse($config->attachments->s3->forcePathStyle);
    }

    public function testConfigFileValuesAreOverriddenByTheEnvironment(): void
    {
        $file = $this->tempDir() . '/config.php';
        file_put_contents($file, <<<'PHP'
            <?php
            return [
                'LOG_LEVEL' => 'debug',
                'ALLOW_REGISTRATION' => true,
                'SESSION_TTL_DAYS' => 14,
                'ATTACHMENT_MAX_MB' => 2.5,
                'PUSH_ALLOWED_HOSTS' => ['a.example', 'b.example'],
                'DATABASE_PATH' => null,
            ];
            PHP);
        $values = ConfigLoader::readFile($file);
        $config = ConfigLoader::load(['LOG_LEVEL' => 'error', 'SESSION_TTL_DAYS' => ''], self::APP, $values);

        self::assertSame('error', $config->logLevel);
        self::assertTrue($config->allowRegistration);
        self::assertSame(14, $config->sessionTtlDays);
        self::assertSame(2_500_000, $config->attachments->maxBytes);
        self::assertSame(['a.example', 'b.example'], $config->push->allowedHosts);
        self::assertSame('/srv/app/data/app.sqlite', $config->databasePath);
    }

    public function testFromEnvironmentFindsTheConfigFile(): void
    {
        $dir = $this->tempDir();
        file_put_contents($dir . '/config.php', "<?php\nreturn ['SESSION_TTL_DAYS' => 3];\n");
        file_put_contents($dir . '/other.php', "<?php\nreturn ['SESSION_TTL_DAYS' => 4];\n");
        try {
            putenv('SESSION_TTL_DAYS');
            putenv(ConfigLoader::CONFIG_FILE_VARIABLE);
            self::assertSame(3, ConfigLoader::fromEnvironment($dir)->sessionTtlDays);
            self::assertSame($dir . '/data/app.sqlite', ConfigLoader::fromEnvironment($dir)->databasePath);

            putenv(ConfigLoader::CONFIG_FILE_VARIABLE . '=' . $dir . '/other.php');
            self::assertSame(4, ConfigLoader::fromEnvironment($dir)->sessionTtlDays);

            putenv('SESSION_TTL_DAYS=5');
            self::assertSame(5, ConfigLoader::fromEnvironment($dir)->sessionTtlDays);
        } finally {
            putenv(ConfigLoader::CONFIG_FILE_VARIABLE);
            putenv('SESSION_TTL_DAYS');
        }
    }

    public function testConfigFileMustReturnAnArray(): void
    {
        $file = $this->tempDir() . '/config.php';
        file_put_contents($file, "<?php\nreturn 'nope';\n");

        $this->expectException(ConfigException::class);
        $this->expectExceptionMessage('must return an array');
        ConfigLoader::readFile($file);
    }

    public function testMissingConfigFileNamedByVariableFails(): void
    {
        $this->expectException(ConfigException::class);
        $this->expectExceptionMessage('is not readable');
        ConfigLoader::readFile($this->tempDir() . '/missing.php');
    }
}
