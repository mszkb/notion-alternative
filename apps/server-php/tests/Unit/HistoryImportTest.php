<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use NotionAlt\History\History;
use NotionAlt\Http\HttpError;
use NotionAlt\Import\Import;
use NotionAlt\Import\ImportLock;
use NotionAlt\Search\SearchIndex;
use NotionAlt\Shared\ExportSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Sync\Apply;
use NotionAlt\Sync\Operation;
use NotionAlt\Tests\TempDir;
use NotionAlt\Validation\Validation;
use PHPUnit\Framework\TestCase;

/** Cases of apps/server/test/history.test.ts and import.test.ts that need internals (#126). */
final class HistoryImportTest extends TestCase
{
    use TempDir;

    private const T0 = 1_777_629_600_000; // 2026-05-01T10:00:00Z

    private \PDO $db;

    private string $user;

    private string $ws;

    private string $laptop;

    private string $phone;

    protected function setUp(): void
    {
        $this->db = Database::open($this->tempDir() . '/app.sqlite');
        (new Migrator($this->db))->migrateToLatest();
        $this->user = Ids::uuid();
        $this->ws = Ids::uuid();
        $this->laptop = Ids::uuid();
        $this->phone = Ids::uuid();
        Sql::run($this->db, "insert into users (id, email, password_hash, created_at) values (?, 'a@example.com', 'h', 'now')", [$this->user]);
        Sql::run($this->db, "insert into workspaces (id, name, owner_id, created_at) values (?, 'Personal', ?, 'now')", [$this->ws, $this->user]);
        foreach ([$this->laptop, $this->phone] as $device) {
            Sql::run($this->db, "insert into devices (id, user_id, name, created_at, last_seen_at, revoked_at) values (?, ?, 'd', 'now', 'now', null)", [$device, $this->user]);
        }
    }

    public function testGroupsEditingSessionsAndRebuildsVersions(): void
    {
        $doc = Ids::uuid();
        $first = Ids::uuid();
        $second = Ids::uuid();
        // Three sessions: laptop writes, phone edits, laptop edits much later.
        $this->apply($this->laptop, 0, 'document', 'create', $doc, ['parentId' => null, 'title' => 'Entwurf', 'sortKey' => 'a0', 'favorite' => false, 'createdAt' => self::at(0)]);
        $this->apply($this->laptop, 1, 'block', 'create', $first, ['documentId' => $doc, 'type' => 'paragraph', 'content' => 'erste Fassung', 'attrs' => new \stdClass(), 'sortKey' => 'a0']);
        $s1 = $this->apply($this->laptop, 2, 'block', 'create', $second, ['documentId' => $doc, 'type' => 'heading', 'content' => 'Abschnitt', 'attrs' => (object) ['level' => 2], 'sortKey' => 'a1']);
        $s2 = $this->apply($this->phone, 3, 'block', 'update', $first, ['content' => 'vom Telefon'], 1);
        $this->apply($this->laptop, 30, 'document', 'update', $doc, ['title' => 'Fertig'], 1);
        $this->apply($this->laptop, 31, 'block', 'delete', $second, [], 1);
        $s3 = $this->apply($this->laptop, 32, 'block', 'move', $first, ['sortKey' => 'b0'], 2);

        self::assertSame([
            ['seq' => $s3, 'at' => self::at(32), 'deviceId' => $this->laptop, 'changes' => 3],
            ['seq' => $s2, 'at' => self::at(3), 'deviceId' => $this->phone, 'changes' => 1],
            ['seq' => $s1, 'at' => self::at(2), 'deviceId' => $this->laptop, 'changes' => 3],
        ], History::listVersions($this->db, $this->user, $this->ws, $doc));

        $v1 = History::versionState($this->db, $this->user, $this->ws, $doc, $s1);
        self::assertNotNull($v1);
        self::assertSame(
            '{"seq":' . $s1 . ',"document":{"id":"' . $doc . '","title":"Entwurf","parentId":null,"favorite":false,"deletedAt":null},"blocks":['
            . '{"id":"' . $first . '","type":"paragraph","content":"erste Fassung","attrs":{},"sortKey":"a0"},'
            . '{"id":"' . $second . '","type":"heading","content":"Abschnitt","attrs":{"level":2},"sortKey":"a1"}]}',
            json_encode($v1, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        );
        $v2 = History::versionState($this->db, $this->user, $this->ws, $doc, $s2);
        self::assertSame(['vom Telefon', 'Abschnitt'], array_column($v2['blocks'] ?? [], 'content'));
        $v3 = History::versionState($this->db, $this->user, $this->ws, $doc, $s3);
        self::assertNotNull($v3);
        self::assertSame('Fertig', $v3['document']['title']);
        self::assertSame([[$first, 'vom Telefon', 'b0']], array_map(
            static fn(array $b): array => [$b['id'], $b['content'], $b['sortKey']],
            $v3['blocks'],
        ));

        // Other accounts and unknown pages see nothing.
        self::assertNull(History::listVersions($this->db, Ids::uuid(), $this->ws, $doc));
        self::assertNull(History::versionState($this->db, $this->user, $this->ws, Ids::uuid(), $s1));
    }

    public function testImportStoresAttrsInSchemaOrderAndRefusesExistingIds(): void
    {
        $doc = Ids::uuid();
        $block = Ids::uuid();
        $raw = json_decode((string) json_encode([
            'schema_version' => 3,
            'exported_at' => 'now',
            'workspace' => ['id' => Ids::uuid(), 'name' => 'Alt'],
            'documents' => [[
                'id' => $doc, 'workspaceId' => $this->ws, 'parentId' => null, 'title' => 'T', 'sortKey' => 'a0',
                'favorite' => true, 'createdAt' => 'c', 'updatedAt' => 'u', 'revision' => null, 'deletedAt' => null,
            ]],
            'blocks' => [[
                'id' => $block, 'documentId' => $doc, 'type' => 'list_item', 'content' => 'Zebra',
                'attrs' => ['indent' => 1, 'list' => 'bullet'], 'sortKey' => 'a0', 'revision' => 3, 'deletedAt' => null,
            ]],
            'tags' => [], 'document_tags' => [], 'links' => [], 'attachments' => [], 'history' => null,
        ]), false);
        /** @var array{documents: list<array<string, mixed>>, blocks: list<array<string, mixed>>, tags: list<array<string, mixed>>, document_tags: list<array<string, mixed>>, attachments: list<array<string, mixed>>, history: null} $data */
        $data = Validation::parseInput(ExportSchemas::jsonExport(), $raw);

        $workspace = Import::workspace($this->db, $this->user, 'Neu', $data, null);
        self::assertSame(1, $workspace['compacted_seq']);
        self::assertSame(
            [['{"list":"bullet","indent":1}', 3]],
            array_map(static fn(array $row): array => array_values($row), Sql::rows($this->db, 'select attrs, revision from blocks where id = ?', [$block])),
        );
        self::assertSame([[1, 1]], array_map(static fn(array $row): array => array_values($row), Sql::rows($this->db, 'select favorite, revision from documents where id = ?', [$doc])));
        $hits = SearchIndex::searchWorkspace($this->db, $this->user, $workspace['id'], 'zebra') ?? [];
        self::assertSame([$doc], array_column($hits, 'documentId'));

        try {
            Import::workspace($this->db, $this->user, 'Noch mal', $data, null);
            self::fail('expected ids_exist');
        } catch (HttpError $error) {
            self::assertSame([409, 'ids_exist'], [$error->statusCode, $error->errorCode]);
        }
        self::assertSame([['n' => 2]], Sql::rows($this->db, 'select count(*) as n from workspaces'));
    }

    /** `429 import_running`: a second import while one holds the lock (another PHP worker). */
    public function testImportLockAllowsOneImportAtATime(): void
    {
        $lock = new ImportLock($this->tempDir() . '/import.lock');
        $inner = null;
        self::assertSame(['outer'], $lock->run(static function () use ($lock, &$inner): string {
            $inner = $lock->run(static fn(): string => 'inner');

            return 'outer';
        }));
        self::assertFalse($inner);
        self::assertSame(['again'], $lock->run(static fn(): string => 'again'));
    }

    private static function at(int $minutes): string
    {
        return Ids::iso(self::T0 + $minutes * 60_000);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function apply(string $device, int $minutes, string $entity, string $kind, string $id, array $payload, ?int $base = null): int
    {
        $op = new Operation(Ids::uuid(), $device, $this->ws, $entity, $id, $kind, $base, (object) $payload, self::at($minutes));
        $result = Apply::operation($this->db, $this->user, $op, self::at($minutes));
        self::assertContains($result['status'] ?? null, ['applied', 'merged']);

        return (int) ($result['seq'] ?? 0);
    }
}
