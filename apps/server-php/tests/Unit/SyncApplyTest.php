<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use NotionAlt\Shared\SyncSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Sync\Apply;
use NotionAlt\Sync\AttachmentLimits;
use NotionAlt\Sync\Operation;
use NotionAlt\Tests\TempDir;
use PHPUnit\Framework\TestCase;

/** Logic cases of apps/server/test/sync-*.test.ts for the PHP port of apply.ts (#121). */
final class SyncApplyTest extends TestCase
{
    use TempDir;

    private \PDO $db;

    private string $user;

    private string $ws;

    private string $deviceA;

    private string $deviceB;

    protected function setUp(): void
    {
        $this->db = Database::open($this->tempDir() . '/app.sqlite');
        (new Migrator($this->db))->migrateToLatest();
        $this->user = Ids::uuid();
        $this->ws = Ids::uuid();
        $this->deviceA = Ids::uuid();
        $this->deviceB = Ids::uuid();
        Sql::run($this->db, "insert into users (id, email, password_hash, created_at) values (?, 'a@example.com', 'h', 'now')", [$this->user]);
        Sql::run($this->db, "insert into workspaces (id, name, owner_id, created_at) values (?, 'Personal', ?, 'now')", [$this->ws, $this->user]);
        foreach ([$this->deviceA, $this->deviceB] as $device) {
            Sql::run($this->db, "insert into devices (id, user_id, name, created_at, last_seen_at, revoked_at) values (?, ?, 'd', 'now', 'now', null)", [$device, $this->user]);
        }
    }

    public function testRejectedOperationOnlyRollsBackItsSavepoint(): void
    {
        $doc = Ids::uuid();
        $orphan = Ids::uuid();
        $results = Apply::batch($this->db, $this->user, [
            $this->op('document', $doc, 'create', null, $this->documentPayload(null)),
            $this->op('document', $orphan, 'create', null, $this->documentPayload(Ids::uuid())),
            $this->op('document', $doc, 'update', 1, ['title' => 'Neu']),
        ]);

        self::assertSame(['status' => 'applied', 'revision' => 1, 'seq' => 1], $results[0]);
        self::assertSame(['status' => 'rejected', 'code' => 'not_found', 'message' => 'Parent not found'], $results[1]);
        self::assertSame(['status' => 'applied', 'revision' => 2, 'seq' => 2], $results[2]);
        self::assertSame([], Sql::rows($this->db, 'select id from documents where id = ?', [$orphan]));
        self::assertSame([[1], [2]], $this->column('select seq from changes order by seq'));
        self::assertSame(['Neu'], array_column(Sql::rows($this->db, 'select title from documents'), 'title'));
    }

    public function testResendIsDuplicateAndReusedOpIdIsRejected(): void
    {
        $create = $this->op('document', Ids::uuid(), 'create', null, $this->documentPayload(null));
        Apply::batch($this->db, $this->user, [$create]);
        self::assertSame([['status' => 'duplicate', 'revision' => 1, 'seq' => 1]], Apply::batch($this->db, $this->user, [$create]));

        $reused = new Operation($create->opId, $this->deviceA, $this->ws, 'document', Ids::uuid(), 'create', null, (object) $this->documentPayload(null), 'now');
        self::assertSame('op_id_reused', Apply::batch($this->db, $this->user, [$reused])[0]['code']);
    }

    public function testDisjointFieldsMergeAndSameFieldIsAConflict(): void
    {
        $doc = Ids::uuid();
        $block = Ids::uuid();
        Apply::batch($this->db, $this->user, [
            $this->op('document', $doc, 'create', null, $this->documentPayload(null)),
            $this->op('block', $block, 'create', null, ['documentId' => $doc, 'type' => 'paragraph', 'content' => 'x', 'attrs' => new \stdClass(), 'sortKey' => 'a0']),
        ]);
        // Empty objects stay objects in the stored payload and row.
        self::assertSame('{}', Sql::rows($this->db, 'select attrs from blocks')[0]['attrs']);

        // Device B moves the block, device A edits its text from the same base: merged.
        $moved = Apply::batch($this->db, $this->user, [$this->op('block', $block, 'move', 1, ['sortKey' => 'b0'], $this->deviceB)]);
        self::assertSame('applied', $moved[0]['status']);
        $edited = Apply::batch($this->db, $this->user, [$this->op('block', $block, 'update', 1, ['content' => 'A'])]);
        self::assertSame(['status' => 'merged', 'revision' => 3, 'seq' => 4], $edited[0]);

        // Device B edits the text from the old base: the same field, so a conflict object.
        $conflicting = $this->op('block', $block, 'update', 1, ['content' => 'B'], $this->deviceB);
        $result = Apply::batch($this->db, $this->user, [$conflicting])[0];
        self::assertSame('conflict', $result['status']);
        self::assertSame(3, $result['currentRevision']);
        self::assertSame('changed', $result['reason']);
        self::assertSame('A', Sql::rows($this->db, 'select content from blocks')[0]['content']);
        $row = Sql::rows($this->db, 'select * from conflicts')[0];
        self::assertSame($result['conflictId'], $row['id']);
        self::assertSame($doc, $row['document_id']);
        self::assertSame(
            ['kind' => 'update', 'payload' => ['content' => 'B'], 'deviceId' => $this->deviceB, 'opId' => $conflicting->opId],
            json_decode(\NotionAlt\Database\Row::string($row, 'local'), true),
        );
        $change = Sql::rows($this->db, "select * from changes where entity = 'conflict'")[0];
        self::assertSame(5, $change['seq']);
        self::assertSame('create', $change['kind']);

        // Resending the conflicting operation returns the same conflict, nothing new is written.
        self::assertSame($result, Apply::batch($this->db, $this->user, [$conflicting])[0]);
        self::assertSame([[1]], $this->column('select count(*) from conflicts'));

        // Resolving it is a normal operation, once.
        $resolve = $this->op('conflict', (string) $result['conflictId'], 'update', 1, ['resolution' => 'local']);
        self::assertSame(['status' => 'applied', 'revision' => 2, 'seq' => 6], Apply::batch($this->db, $this->user, [$resolve])[0]);
        $again = $this->op('conflict', (string) $result['conflictId'], 'update', 1, ['resolution' => 'remote'], $this->deviceB);
        self::assertSame(['status' => 'duplicate', 'revision' => 2, 'seq' => 6], Apply::batch($this->db, $this->user, [$again])[0]);
    }

    public function testEditOfABlockOnAPageDeletedElsewhereIsAConflict(): void
    {
        $doc = Ids::uuid();
        $block = Ids::uuid();
        Apply::batch($this->db, $this->user, [
            $this->op('document', $doc, 'create', null, $this->documentPayload(null)),
            $this->op('block', $block, 'create', null, ['documentId' => $doc, 'type' => 'paragraph', 'content' => 'x', 'attrs' => new \stdClass(), 'sortKey' => 'a0']),
        ]);
        $deleted = Apply::batch($this->db, $this->user, [$this->op('document', $doc, 'delete', 1, [], $this->deviceB)]);
        self::assertSame('applied', $deleted[0]['status']);
        self::assertSame('{}', Sql::rows($this->db, "select payload from changes where kind = 'delete'")[0]['payload']);

        $result = Apply::batch($this->db, $this->user, [$this->op('block', $block, 'update', 1, ['content' => 'y'])])[0];
        self::assertSame('conflict', $result['status']);
        self::assertSame('parent_deleted', $result['reason']);

        // Deleting the page again answers like the original deletion.
        self::assertSame(['status' => 'duplicate', 'revision' => 2, 'seq' => 3], Apply::batch($this->db, $this->user, [$this->op('document', $doc, 'delete', 1, [])])[0]);
        // Editing the deleted page from another device is a conflict, not a silent overwrite.
        self::assertSame('deleted', Apply::batch($this->db, $this->user, [$this->op('document', $doc, 'update', 1, ['title' => 'z'])])[0]['reason']);
    }

    public function testValidatesPayloadsLikeTheSharedSchemas(): void
    {
        self::assertNull(SyncSchemas::validatePayload('document', 'update', (object) ['title' => 'x']));
        self::assertSame('payload: empty update', SyncSchemas::validatePayload('document', 'update', new \stdClass()));
        self::assertSame('restore is not supported for block', SyncSchemas::validatePayload('block', 'restore', new \stdClass()));
        self::assertSame('payload: Unrecognized key: "x"', SyncSchemas::validatePayload('tag', 'delete', (object) ['x' => 1]));
        $result = Apply::batch($this->db, $this->user, [$this->op('conflict', Ids::uuid(), 'create', null, [])], null, AttachmentLimits::none());
        self::assertSame('invalid_payload', $result[0]['code']);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function op(string $entity, string $id, string $kind, ?int $base, array $payload, ?string $device = null): Operation
    {
        return new Operation(Ids::uuid(), $device ?? $this->deviceA, $this->ws, $entity, $id, $kind, $base, (object) $payload, 'now');
    }

    /**
     * @return array<string, mixed>
     */
    private function documentPayload(?string $parentId): array
    {
        return ['parentId' => $parentId, 'title' => 'Seite', 'sortKey' => 'a0', 'favorite' => false, 'createdAt' => 'now'];
    }

    /**
     * @return list<list<mixed>>
     */
    private function column(string $sql): array
    {
        return array_map(static fn(array $row): array => array_values($row), Sql::rows($this->db, $sql));
    }
}
