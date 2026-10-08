<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use NotionAlt\Shared\SyncSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Sync\Apply;
use NotionAlt\Sync\Changes;
use NotionAlt\Sync\Operation;
use NotionAlt\Sync\Snapshot;
use NotionAlt\Tests\TempDir;
use NotionAlt\Validation\CoerceNumberSchema;
use PHPUnit\Framework\TestCase;

/** Paging tokens of the snapshot (#97, #122) and the change-log helpers. */
final class SyncSnapshotTest extends TestCase
{
    use TempDir;

    private \PDO $db;

    private string $user;

    private string $ws;

    private string $device;

    protected function setUp(): void
    {
        $this->db = Database::open($this->tempDir() . '/app.sqlite');
        (new Migrator($this->db))->migrateToLatest();
        $this->user = Ids::uuid();
        $this->ws = Ids::uuid();
        $this->device = Ids::uuid();
        Sql::run($this->db, "insert into users (id, email, password_hash, created_at) values (?, 'a@example.com', 'h', 'now')", [$this->user]);
        Sql::run($this->db, "insert into workspaces (id, name, owner_id, created_at) values (?, 'Personal', ?, 'now')", [$this->ws, $this->user]);
        Sql::run($this->db, "insert into devices (id, user_id, name, created_at, last_seen_at, revoked_at) values (?, ?, 'd', 'now', 'now', null)", [$this->device, $this->user]);
    }

    public function testParsesTokensAndRejectsUnknownTables(): void
    {
        $id = Ids::uuid();
        self::assertSame([7, 4, $id], Snapshot::parseToken("7.4.{$id}"));
        self::assertSame([7, 2, null], Snapshot::parseToken('7.2.'));
        self::assertNull(Snapshot::parseToken('7.6.'));
        self::assertNull(Snapshot::parseToken('7.9.'));
        self::assertNull(Snapshot::parseToken('x'));
    }

    public function testQuerySchemaChecksTheTokenFormat(): void
    {
        $schema = SyncSchemas::snapshotQuery();
        self::assertSame([], $schema->safeParse(['workspaceId' => $this->ws, 'limit' => '10', 'after' => '3.1.abc-1'])->issues);
        self::assertSame(['workspaceId' => $this->ws, 'limit' => 10], $schema->safeParse(['workspaceId' => $this->ws, 'limit' => '10'])->data);
        foreach (['x', '1.10.', '1.1.zz', "1.1.\n", '.1.'] as $after) {
            self::assertNotSame([], $schema->safeParse(['workspaceId' => $this->ws, 'limit' => '10', 'after' => $after])->issues, $after);
        }
        foreach (['0', '5001', 'abc', '1.5'] as $limit) {
            self::assertNotSame([], $schema->safeParse(['workspaceId' => $this->ws, 'limit' => $limit])->issues, $limit);
        }
    }

    public function testPullQueryCoercesAndDefaults(): void
    {
        self::assertSame(
            ['workspaceId' => $this->ws, 'cursor' => 0, 'limit' => 1000],
            SyncSchemas::pullQuery()->safeParse(['workspaceId' => $this->ws])->data,
        );
        self::assertSame(
            ['workspaceId' => $this->ws, 'cursor' => 12, 'limit' => 5],
            SyncSchemas::pullQuery()->safeParse(['workspaceId' => $this->ws, 'cursor' => ' 12 ', 'limit' => '5'])->data,
        );
        self::assertSame(0, CoerceNumberSchema::toNumber(''));
        self::assertSame(16, CoerceNumberSchema::toNumber('0x10'));
        self::assertNan(CoerceNumberSchema::toNumber('1a'));
    }

    public function testPagesWalkTablesInOrderAndCrossTableBoundaries(): void
    {
        $docs = [];
        for ($i = 0; $i < 3; $i++) {
            $docs[] = $id = Ids::uuid();
            $this->apply('document', $id, ['parentId' => null, 'title' => "D{$i}", 'sortKey' => "a{$i}", 'favorite' => false, 'createdAt' => 'now']);
        }
        $tag = Ids::uuid();
        $this->apply('tag', $tag, ['name' => 'Tag']);
        sort($docs);

        $first = Snapshot::loadPage($this->db, $this->user, $this->ws, 2);
        self::assertNotNull($first);
        self::assertSame(4, $first['total']);
        self::assertSame(4, $first['cursor']);
        self::assertSame(\array_slice($docs, 0, 2), self::ids($first['documents']));
        self::assertSame("4.0.{$docs[1]}", $first['next']);

        // The rest of the documents fills the page exactly: the token points at the next table.
        $second = Snapshot::loadPage($this->db, $this->user, $this->ws, 1, $first['next']);
        self::assertNotNull($second);
        self::assertArrayNotHasKey('total', $second);
        self::assertSame([$docs[2]], self::ids($second['documents']));
        self::assertSame('4.1.', $second['next']);

        $third = Snapshot::loadPage($this->db, $this->user, $this->ws, 10, $second['next']);
        self::assertNotNull($third);
        self::assertSame([$tag], self::ids($third['tags']));
        self::assertNull($third['next']);

        self::assertNull(Snapshot::loadPage($this->db, $this->user, $this->ws, 10, '4.6.'));
        self::assertNull(Snapshot::loadPage($this->db, Ids::uuid(), $this->ws, 10));
    }

    public function testFullSnapshotAndCompactionKeepTheCursor(): void
    {
        $this->apply('document', Ids::uuid(), ['parentId' => null, 'title' => 'D', 'sortKey' => 'a0', 'favorite' => false, 'createdAt' => 'now']);
        $this->apply('tag', Ids::uuid(), ['name' => 'Tag']);
        Changes::compact($this->db, $this->ws, 2);
        self::assertSame([], Changes::listSince($this->db, $this->user, $this->ws, 0, 10));
        self::assertSame(2, Changes::latestSeq($this->db, $this->ws, 2));

        $snapshot = Snapshot::load($this->db, $this->user, $this->ws);
        self::assertNotNull($snapshot);
        self::assertSame(['documents', 'blocks', 'tags', 'documentTags', 'attachments', 'conflicts', 'cursor'], array_keys($snapshot));
        self::assertSame(2, $snapshot['cursor']);
        self::assertNull(Changes::listSince($this->db, Ids::uuid(), $this->ws, 0, 10));
    }

    /**
     * @return list<mixed>
     */
    private static function ids(mixed $entities): array
    {
        self::assertIsArray($entities);
        $ids = [];
        foreach ($entities as $entity) {
            self::assertIsArray($entity);
            $ids[] = $entity['id'] ?? null;
        }

        return $ids;
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function apply(string $entity, string $id, array $payload): void
    {
        $op = new Operation(Ids::uuid(), $this->device, $this->ws, $entity, $id, 'create', null, (object) $payload, 'now');
        self::assertSame('applied', Apply::batch($this->db, $this->user, [$op])[0]['status']);
    }
}
