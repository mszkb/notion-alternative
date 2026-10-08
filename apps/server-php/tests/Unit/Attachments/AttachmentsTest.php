<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit\Attachments;

use NotionAlt\Attachments\AttachmentRoutes;
use NotionAlt\Attachments\Purge;
use NotionAlt\Attachments\S3Client;
use NotionAlt\Attachments\S3Error;
use NotionAlt\Attachments\S3Store;
use NotionAlt\Attachments\VolumeStore;
use NotionAlt\Config\S3Config;
use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use NotionAlt\Support\Ids;
use NotionAlt\Tests\TempDir;
use PHPUnit\Framework\TestCase;

/** Port of the internal cases of apps/server/test/attachments.test.ts (#124). */
final class AttachmentsTest extends TestCase
{
    use TempDir;

    public function testContentDispositionLikeNode(): void
    {
        self::assertSame("inline; filename=\"foto.png\"; filename*=UTF-8''foto.png", AttachmentRoutes::disposition('inline', 'foto.png'));
        self::assertSame(
            "attachment; filename=\"b_se.svg\"; filename*=UTF-8''b%C3%B6se.svg",
            AttachmentRoutes::disposition('attachment', 'böse.svg'),
        );
        // Quotes and backslashes are replaced; astral characters are two UTF-16 code units in JS.
        self::assertSame(
            "attachment; filename=\"a_b_c__!'()*~.txt\"; filename*=UTF-8''a%22b%5Cc%F0%9F%98%80!'()*~.txt",
            AttachmentRoutes::disposition('attachment', "a\"b\\c😀!'()*~.txt"),
        );
    }

    public function testVolumeStoreWritesAtomicallyUnderUuidPaths(): void
    {
        $store = new VolumeStore($this->tempDir() . '/attachments');
        $ws = Ids::uuid();
        $id = Ids::uuid();
        self::assertNull($store->get($ws, $id));
        $store->put($ws, $id, "\x00data");
        self::assertSame("\x00data", (string) $store->get($ws, $id));
        self::assertSame([$id], array_values(array_diff(scandir($this->tempDir() . "/attachments/{$ws}") ?: [], ['.', '..'])));
        $store->remove($ws, $id);
        $store->remove($ws, $id);
        self::assertNull($store->get($ws, $id));

        $this->expectException(\InvalidArgumentException::class);
        $store->put('../etc', $id, 'x');
    }

    public function testS3StoreSendsSignedRequests(): void
    {
        $fake = new FakeS3();
        $config = new S3Config('http://minio:9000', 'us-east-1', 'bucket', 'AK', 'SK', true);
        $store = new S3Store(new S3Client($config, $fake->send(...)));
        $ws = Ids::uuid();
        $id = Ids::uuid();

        self::assertNull($store->get($ws, $id));
        $store->put($ws, $id, 'inhalt');
        self::assertSame('inhalt', (string) $store->get($ws, $id));
        $store->remove($ws, $id);

        self::assertSame("http://minio:9000/bucket/{$ws}/{$id}", $fake->sent[1][1]);
        self::assertSame(hash('sha256', 'inhalt'), $fake->sent[1][2]['x-amz-content-sha256']);
        self::assertSame('application/octet-stream', $fake->sent[1][2]['content-type']);
        self::assertStringStartsWith('AWS4-HMAC-SHA256 Credential=AK/', $fake->sent[1][2]['authorization']);
        self::assertSame(['GET', 'PUT', 'GET', 'DELETE'], array_column($fake->sent, 0));

        $failing = new S3Client($config, static fn(): int => 403);
        try {
            $failing->put('k', 'x');
            self::fail('expected S3Error');
        } catch (S3Error $error) {
            self::assertSame('S3 put failed with status 403', $error->getMessage());
            self::assertStringNotContainsString('SK', $error->getMessage());
        }
        (new S3Client($config, static fn(): int => 404))->delete('k');
        (new S3Client($config, static fn(): int => 409))->createBucket();
    }

    public function testPurgeRemovesOnlyFilesPastTheRetention(): void
    {
        $db = Database::open($this->tempDir() . '/app.sqlite');
        (new Migrator($db))->migrateToLatest();
        $store = new VolumeStore($this->tempDir() . '/attachments');
        $user = Ids::uuid();
        $ws = Ids::uuid();
        $doc = Ids::uuid();
        Sql::run($db, "insert into users (id, email, password_hash, created_at) values (?, 'a@example.com', 'h', 'now')", [$user]);
        Sql::run($db, "insert into workspaces (id, name, owner_id, created_at) values (?, 'W', ?, 'now')", [$ws, $user]);
        Sql::run(
            $db,
            "insert into documents (id, workspace_id, parent_id, title, sort_key, favorite, created_at, updated_at, revision, deleted_at)
             values (?, ?, null, 'D', 'a', 0, 'now', 'now', 1, null)",
            [$doc, $ws],
        );
        $now = Ids::nowMs();
        $day = 24 * 60 * 60 * 1000;
        $rows = ['old' => Ids::iso($now - 31 * $day), 'recent' => Ids::iso($now - $day), 'live' => null];
        $ids = [];
        foreach ($rows as $name => $deletedAt) {
            $ids[$name] = Ids::uuid();
            $store->put($ws, $ids[$name], $name);
            Sql::run(
                $db,
                "insert into attachments (id, workspace_id, document_id, name, mime_type, size, sha256, created_at, stored_at, revision, deleted_at)
                 values (?, ?, ?, ?, 'text/plain', 1, 'x', 'now', 'now', 1, ?)",
                [$ids[$name], $ws, $doc, $name, $deletedAt],
            );
        }

        self::assertSame(1, Purge::deletedAttachments($db, $store, 30, $now));
        self::assertNull($store->get($ws, $ids['old']));
        self::assertNotNull($store->get($ws, $ids['recent']));
        self::assertNotNull($store->get($ws, $ids['live']));
        $stored = Sql::rows($db, 'select stored_at from attachments where id = ?', [$ids['old']]);
        self::assertNull($stored[0]['stored_at'] ?? null);
        self::assertSame(0, Purge::deletedAttachments($db, $store, 30, $now));
    }
}

/** In-memory S3 endpoint behind the transport of {@see S3Client}. */
final class FakeS3
{
    /** @var list<array{string, string, array<string, string>, ?string}> */
    public array $sent = [];

    /** @var array<string, string> */
    private array $objects = [];

    /**
     * @param array<string, string> $headers
     * @param resource              $sink
     */
    public function send(string $method, string $url, array $headers, ?string $body, $sink): int
    {
        $this->sent[] = [$method, $url, $headers, $body];
        if ($method === 'PUT') {
            $this->objects[$url] = $body ?? '';

            return 200;
        }
        if ($method === 'GET') {
            if (!isset($this->objects[$url])) {
                fwrite($sink, '<Error/>');

                return 404;
            }
            fwrite($sink, $this->objects[$url]);

            return 200;
        }

        return 204;
    }
}
