<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Attachments\VolumeStore;
use NotionAlt\Auth\Password;
use NotionAlt\Cli\Backup;
use NotionAlt\Cli\Console;
use NotionAlt\Cli\Cron;
use NotionAlt\Config\Config;
use NotionAlt\Config\ConfigLoader;
use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use NotionAlt\Support\Ids;
use NotionAlt\Tests\TempDir;
use PHPUnit\Framework\TestCase;

/** bin/console and bin/cron.php (#127). */
final class CliTest extends TestCase
{
    use TempDir;

    private Config $config;

    private \PDO $db;

    private string $user;

    private string $ws;

    protected function setUp(): void
    {
        $this->config = ConfigLoader::load(['DATA_DIR' => $this->tempDir() . '/data'], __DIR__);
        Database::assertFts5();
        $this->db = Database::open($this->config->databasePath);
        (new Migrator($this->db))->migrateToLatest();
        $this->user = Ids::uuid();
        $this->ws = Ids::uuid();
        Sql::run($this->db, "insert into users (id, email, password_hash, created_at) values (?, 'alice@example.com', 'h', 'now')", [$this->user]);
        Sql::run($this->db, "insert into workspaces (id, name, owner_id, created_at, compacted_seq) values (?, 'W', ?, 'now', 0)", [$this->ws, $this->user]);
    }

    public function testBackupAndRestoreWithAttachments(): void
    {
        $doc = Ids::uuid();
        $stored = Ids::uuid();
        $lost = Ids::uuid();
        Sql::run($this->db, "insert into documents (id, workspace_id, parent_id, title, sort_key, favorite, created_at, updated_at, revision, deleted_at) values (?, ?, null, 'D', 'a', 0, 'now', 'now', 1, null)", [$doc, $this->ws]);
        foreach ([$stored, $lost] as $id) {
            Sql::run($this->db, "insert into attachments (id, workspace_id, document_id, name, mime_type, size, sha256, created_at, stored_at, revision, deleted_at) values (?, ?, ?, 'a.bin', 'application/octet-stream', 3, 'x', 'now', 'now', 1, null)", [$id, $this->ws, $doc]);
        }
        Sql::run($this->db, "insert into changes (workspace_id, seq, op_id, device_id, entity, entity_id, kind, revision, payload, applied_at) values (?, 7, ?, ?, 'document', ?, 'create', 1, '{}', 'now')", [$this->ws, Ids::uuid(), Ids::uuid(), $doc]);
        $volume = new VolumeStore($this->config->attachments->dir);
        $volume->put($this->ws, $stored, 'abc');

        ['dir' => $dir, 'manifest' => $manifest] = Backup::create($this->config, $this->tempDir() . '/backups', 1_700_000_000_123);
        self::assertStringEndsWith('/backup-2023-11-14T22-13-20-123Z', $dir);
        self::assertSame('0015_metrics', $manifest['migration']);
        self::assertSame([$lost], $manifest['missingAttachments']);
        self::assertSame(['app.sqlite', "attachments/{$this->ws}/{$stored}"], array_column($manifest['files'], 'path'));
        $json = (string) file_get_contents("{$dir}/manifest.json");
        self::assertStringStartsWith("{\n  \"format\": \"notion-alt-backup\",\n  \"version\": 1,\n", $json);
        self::assertSame(Backup::verify($dir), $manifest);

        // Refuses to overwrite without --force; restores with it.
        $this->expectExceptionMessageMatches('/exists/');
        try {
            Backup::restore($this->config, $dir);
        } finally {
            unset($this->db);
            $volume->remove($this->ws, $stored);
            $report = Backup::restore($this->config, $dir, force: true);
            self::assertSame(1, $report['attachments']);
            self::assertSame('abc', (string) $volume->get($this->ws, $stored));
            $db = Database::open($this->config->databasePath);
            self::assertSame([['compacted_seq' => 7 + Backup::RESTORE_SEQ_GAP]], Sql::rows($db, 'select compacted_seq from workspaces'));
        }
    }

    public function testVerifyRejectsTamperedBackups(): void
    {
        ['dir' => $dir] = Backup::create($this->config, $this->tempDir() . '/backups');
        file_put_contents("{$dir}/app.sqlite", 'x', FILE_APPEND);
        $this->expectExceptionMessage('Checksum mismatch in backup: app.sqlite');
        Backup::verify($dir);
    }

    public function testResetPasswordEndsSessions(): void
    {
        Sql::run($this->db, "insert into sessions (id, user_id, created_at, expires_at) values ('s', ?, 'now', '9999')", [$this->user]);
        $stdin = fopen('php://memory', 'r+');
        $stdout = fopen('php://memory', 'r+');
        $stderr = fopen('php://memory', 'r+');
        self::assertNotFalse($stdin);
        self::assertNotFalse($stdout);
        self::assertNotFalse($stderr);
        fwrite($stdin, "ein langes Passwort\n");
        rewind($stdin);
        $console = new Console($this->config, $stdout, $stderr, $stdin);

        self::assertSame(0, $console->run(['reset-password', ' Alice@Example.com ']));
        rewind($stdout);
        self::assertSame('{"email":"alice@example.com","endedSessions":1}' . "\n", stream_get_contents($stdout));
        $hash = Sql::rows($this->db, 'select password_hash from users')[0]['password_hash'] ?? '';
        self::assertTrue(Password::verify('ein langes Passwort', \is_string($hash) ? $hash : ''));
        self::assertSame(1, $console->run(['reset-password', 'bob@example.com']));
        self::assertSame(2, $console->run(['unknown']));
    }

    public function testCronCleansUp(): void
    {
        $now = 1_800_000_000_000;
        Sql::run($this->db, "insert into sessions (id, user_id, created_at, expires_at) values ('old', ?, 'now', ?), ('new', ?, 'now', ?)", [$this->user, Ids::iso($now - 1), $this->user, Ids::iso($now + 1)]);
        Sql::run($this->db, "insert into auth_attempts (key, count, reset_at) values ('a', 1, ?), ('b', 1, ?)", [$now - 1, $now + 1]);

        self::assertSame(
            ['sessions' => 1, 'authAttempts' => 1, 'pushHints' => 0, 'purgedAttachments' => 0],
            Cron::run($this->db, $this->config, nowMs: $now),
        );
    }
}
