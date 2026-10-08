<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use NotionAlt\Search\SearchIndex;
use NotionAlt\Shared\SearchSchemas;
use NotionAlt\Tests\TempDir;
use PHPUnit\Framework\TestCase;

/**
 * Search index logic. Operations are emulated by writing rows and marking the page, as
 * `Apply` does.
 */
final class SearchIndexTest extends TestCase
{
    use TempDir;

    private const USER = 'u1';

    private const WS = 'w1';

    private \PDO $db;

    private int $sortKey = 0;

    protected function setUp(): void
    {
        $this->db = Database::open($this->tempDir() . '/app.sqlite');
        (new Migrator($this->db))->migrateToLatest();
        self::insertOwner($this->db, self::USER, self::WS);
    }

    public function testFindsTitlesAndBlockText(): void
    {
        $doc = $this->page('Reiseplanung');
        $this->block($doc, 'Wir fahren **über** die Alpen');
        $other = $this->page('Küche');
        $this->block($other, 'const rezept = "Kuchen"', 'code');

        self::assertSame(['Reiseplanung'], $this->titles('reise'));
        self::assertSame(['Reiseplanung'], $this->titles('uber alpen'));
        self::assertSame(['Küche'], $this->titles('kuche'));
        self::assertSame(['Küche'], $this->titles('rezept'));
        $hits = $this->search('alpen');
        self::assertCount(1, $hits);
        self::assertSame(['documentId', 'title', 'snippet'], array_keys($hits[0]));
        self::assertSame($doc, $hits[0]['documentId']);
        self::assertStringContainsString('Wir fahren über die Alpen', $hits[0]['snippet']);
        self::assertStringNotContainsString('**', $hits[0]['snippet']);
    }

    public function testFollowsEditsAndDropsDeletedBlocksAndPages(): void
    {
        $doc = $this->page('Notizen');
        $block = $this->block($doc, 'alter Inhalt');

        $this->change($doc, 'update blocks set content = ? where id = ?', ['neuer Inhalt', $block]);
        self::assertSame([], $this->titles('alter'));
        self::assertSame(['Notizen'], $this->titles('neuer'));
        $this->change($doc, "update blocks set deleted_at = 'now' where id = ?", [$block]);
        self::assertSame([], $this->titles('neuer'));
        $this->change($doc, 'update documents set title = ? where id = ?', ['Umbenannt', $doc]);
        self::assertSame(['Umbenannt'], $this->titles('umbenannt'));
        $this->change($doc, "update documents set deleted_at = 'now' where id = ?", [$doc]);
        self::assertSame([], $this->titles('umbenannt'));
        self::assertSame([], Sql::rows($this->db, 'select * from search_documents'));
    }

    public function testRebuildsAMarkedPageOnceWithEveryBlock(): void
    {
        // #99: many block operations mark the page once; the rebuild sees all of them.
        $doc = $this->page('Lang');
        for ($i = 0; $i < 300; $i++) {
            $this->block($doc, "zeile{$i}");
        }
        self::assertSame([['n' => 1]], Sql::rows($this->db, 'select count(*) as n from search_dirty'));

        SearchIndex::reindexMarked($this->db);

        self::assertSame([['n' => 0]], Sql::rows($this->db, 'select count(*) as n from search_dirty'));
        self::assertSame([['n' => 1]], Sql::rows($this->db, 'select count(*) as n from search_index'));
        self::assertSame(['Lang'], $this->titles('zeile0'));
        self::assertSame(['Lang'], $this->titles('zeile299'));
    }

    public function testIndexesLeftOverMarksBeforeSearching(): void
    {
        // #99: applied and committed, but the request died before reindexing.
        $doc = $this->page('Absturz');
        SearchIndex::reindexMarked($this->db);
        $this->block($doc, 'gerettet');
        self::assertSame([['n' => 1]], Sql::rows($this->db, 'select count(*) as n from search_dirty'));

        self::assertSame(['Absturz'], $this->titles('gerettet'));
        // Startup does the same; nothing is left to do now.
        self::assertSame([['n' => 0]], Sql::rows($this->db, 'select count(*) as n from search_dirty'));
        SearchIndex::reindexMarked($this->db);
        self::assertSame([['n' => 1]], Sql::rows($this->db, 'select count(*) as n from search_index'));
    }

    public function testJoinsAnOpenTransaction(): void
    {
        $doc = $this->page('Transaktion');
        $this->db->beginTransaction();
        SearchIndex::reindexMarked($this->db);
        self::assertTrue($this->db->inTransaction());
        $this->db->rollBack();

        self::assertSame([['document_id' => $doc]], Sql::rows($this->db, 'select document_id from search_dirty'));
    }

    public function testNeverReturnsHitsFromForeignWorkspaces(): void
    {
        $this->page('Geheim');
        self::insertOwner($this->db, 'u2', 'w2');
        $this->page('Bobs Seite', 'w2');

        self::assertNull(SearchIndex::searchWorkspace($this->db, 'u2', self::WS, 'geheim'));
        self::assertNull(SearchIndex::searchWorkspace($this->db, self::USER, 'missing', 'geheim'));
        self::assertSame([], SearchIndex::searchWorkspace($this->db, 'u2', 'w2', 'geheim'));
        self::assertSame(['Bobs Seite'], array_column(SearchIndex::searchWorkspace($this->db, 'u2', 'w2', 'bob') ?? [], 'title'));
    }

    public function testTreatsFtsSyntaxInTheInputAsPlainWords(): void
    {
        $this->page('Alpha Beta');

        // All words must match, so the operators are searched as words: no error, no hit.
        self::assertSame([], $this->titles('"alpha" OR title:x NEAR('));
        self::assertSame(['Alpha Beta'], $this->titles('"alpha" beta*'));
        self::assertSame('"a"* "OR"* "b*"*', SearchIndex::toFtsQuery('a" OR b*'));
        self::assertNull(SearchIndex::toFtsQuery('  -- '));
        self::assertNull(SearchIndex::toFtsQuery(''));
        self::assertSame([], $this->search('-- ""'));
    }

    public function testBuildsQueriesLikeTheTypeScriptImplementation(): void
    {
        // Splits on JavaScript whitespace (incl. no-break space), keeps at most ten words.
        self::assertSame('"über"* "Straße"*', SearchIndex::toFtsQuery("über\u{a0}Straße"));
        self::assertSame('"a"* "b"*', SearchIndex::toFtsQuery("\ta\n\u{3000}b\u{feff}"));
        self::assertSame('"x_1"* "日本"*', SearchIndex::toFtsQuery('x_1 日本 __ !?'));
        self::assertSame(
            implode(' ', array_map(static fn(int $i): string => "\"w{$i}\"*", range(1, 10))),
            SearchIndex::toFtsQuery(implode(' ', array_map(static fn(int $i): string => "w{$i}", range(1, 12)))),
        );
        self::assertSame('"a"* "b"*', SearchIndex::toFtsQuery('a "" - b'));
        self::assertSame("\"a\u{fffd}\"*", SearchIndex::toFtsQuery("a\xff"));
    }

    public function testRanksTitleHitsFirstAndLimitsTheResult(): void
    {
        $body = $this->page('Erste Seite');
        $this->block($body, 'Hier steht Garten im Text');
        $this->page('Garten');

        self::assertSame(['Garten', 'Erste Seite'], $this->titles('garten'));
        $hits = SearchIndex::searchWorkspace($this->db, self::USER, self::WS, 'garten', 1);
        self::assertSame(['Garten'], array_column($hits ?? [], 'title'));
        // A title-only hit has an empty body snippet.
        self::assertSame('', ($hits ?? [])[0]['snippet'] ?? null);
    }

    public function testShortensLongSnippets(): void
    {
        $doc = $this->page('Lang');
        $words = array_map(static fn(int $i): string => "wort{$i}", range(1, 40));
        $words[20] = 'treffer';
        $this->block($doc, implode(' ', $words));

        $snippet = $this->search('treffer')[0]['snippet'];
        self::assertStringStartsWith('…', $snippet);
        self::assertStringEndsWith('…', $snippet);
        self::assertStringContainsString('treffer', $snippet);
        self::assertCount(12, explode(' ', trim($snippet, '…')));
    }

    public function testDescribesTheQueryOfTheRoute(): void
    {
        $ok = SearchSchemas::query()->safeParse(['workspaceId' => '3f2b8c1e-7d4a-4b6e-9c0f-1a2b3c4d5e6f', 'q' => '  alpen ']);
        self::assertTrue($ok->success());
        self::assertSame(['workspaceId' => '3f2b8c1e-7d4a-4b6e-9c0f-1a2b3c4d5e6f', 'q' => 'alpen'], $ok->data);
        self::assertFalse(SearchSchemas::query()->safeParse(['workspaceId' => '3f2b8c1e-7d4a-4b6e-9c0f-1a2b3c4d5e6f', 'q' => ' '])->success());
        self::assertFalse(SearchSchemas::query()->safeParse(['workspaceId' => 'x', 'q' => 'a'])->success());
        self::assertFalse(SearchSchemas::query()->safeParse(['workspaceId' => '3f2b8c1e-7d4a-4b6e-9c0f-1a2b3c4d5e6f', 'q' => str_repeat('a', 201)])->success());
    }

    public function testMigration0005FillsTheIndexFromExistingPages(): void
    {
        $db = Database::open($this->tempDir() . '/old.sqlite');
        (new Migrator($db, \array_slice(Migrator::all(), 0, 4, true)))->migrateToLatest();
        self::insertOwner($db, 'u1', 'w1');
        self::insertDocument($db, 'd1', 'w1', 'Bestand');
        self::insertDocument($db, 'd2', 'w1', 'Gelöscht', 'x');
        self::insertBlock($db, 'b1', 'w1', 'd1', '_kursiver_ Altbestand');

        (new Migrator($db))->migrateToLatest();

        self::assertSame([['document_id' => 'd1', 'body' => 'kursiver Altbestand']], Sql::rows($db, 'select document_id, body from search_index'));
    }

    public function testMigration0009KeepsSearchEntriesAndAddressesThemByRowid(): void
    {
        // T-MIG-01
        $db = Database::open($this->tempDir() . '/old.sqlite');
        (new Migrator($db, \array_slice(Migrator::all(), 0, 8, true)))->migrateToLatest();
        self::insertOwner($db, 'u1', 'w1');
        self::insertDocument($db, 'd1', 'w1', 'Einkaufsliste');
        $db->exec("insert into search_index (document_id, workspace_id, title, body) values ('d1', 'w1', 'Einkaufsliste', 'Milch')");

        (new Migrator($db))->migrateToLatest();
        self::assertSame(['d1'], array_column(SearchIndex::searchWorkspace($db, 'u1', 'w1', 'milch') ?? [], 'documentId'));

        // Reindexing replaces the migrated row instead of adding a second one.
        $db->exec("update documents set title = 'Wochenmarkt' where id = 'd1'");
        SearchIndex::reindexDocument($db, 'd1');
        self::assertSame([['n' => 1]], Sql::rows($db, 'select count(*) as n from search_index'));
        self::assertSame([], SearchIndex::searchWorkspace($db, 'u1', 'w1', 'einkauf'));
        self::assertCount(1, SearchIndex::searchWorkspace($db, 'u1', 'w1', 'wochenmarkt') ?? []);

        // A deleted page leaves the index and its rowid entry.
        $db->exec("update documents set deleted_at = 'now' where id = 'd1'");
        SearchIndex::reindexDocument($db, 'd1');
        self::assertSame(
            [['n' => 0]],
            Sql::rows($db, 'select (select count(*) from search_index) + (select count(*) from search_documents) as n'),
        );
    }

    /** @return list<array{documentId: string, title: string, snippet: string}> */
    private function search(string $q): array
    {
        $hits = SearchIndex::searchWorkspace($this->db, self::USER, self::WS, $q);
        self::assertNotNull($hits);

        return $hits;
    }

    /** @return list<string> */
    private function titles(string $q): array
    {
        return array_column($this->search($q), 'title');
    }

    private function page(string $title, string $workspaceId = self::WS): string
    {
        $id = self::uuid();
        self::insertDocument($this->db, $id, $workspaceId, $title);
        SearchIndex::markForReindex($this->db, $id);

        return $id;
    }

    private function block(string $documentId, string $content, string $type = 'paragraph'): string
    {
        $id = self::uuid();
        self::insertBlock($this->db, $id, self::WS, $documentId, $content, $type, \sprintf('a%04d', $this->sortKey++));
        SearchIndex::markForReindex($this->db, $documentId);

        return $id;
    }

    /** @param list<string> $params */
    private function change(string $documentId, string $sql, array $params): void
    {
        Sql::run($this->db, $sql, $params);
        SearchIndex::markForReindex($this->db, $documentId);
    }

    private static function insertOwner(\PDO $db, string $userId, string $workspaceId): void
    {
        Sql::run($db, "insert into users (id, email, password_hash, created_at) values (?, ?, 'h', 'now')", [$userId, "{$userId}@example.com"]);
        Sql::run($db, "insert into workspaces (id, name, owner_id, created_at) values (?, 'Personal', ?, 'now')", [$workspaceId, $userId]);
    }

    private static function insertDocument(\PDO $db, string $id, string $workspaceId, string $title, ?string $deletedAt = null): void
    {
        Sql::run(
            $db,
            "insert into documents (id, workspace_id, parent_id, title, sort_key, favorite, created_at, updated_at, revision, deleted_at)
                values (?, ?, null, ?, 'a0', 0, 'now', 'now', 1, ?)",
            [$id, $workspaceId, $title, $deletedAt],
        );
    }

    private static function insertBlock(
        \PDO $db,
        string $id,
        string $workspaceId,
        string $documentId,
        string $content,
        string $type = 'paragraph',
        string $sortKey = 'a',
    ): void {
        Sql::run(
            $db,
            "insert into blocks (id, workspace_id, document_id, type, content, attrs, sort_key, revision, deleted_at)
                values (?, ?, ?, ?, ?, '{}', ?, 1, null)",
            [$id, $workspaceId, $documentId, $type, $content, $sortKey],
        );
    }

    private static function uuid(): string
    {
        $hex = bin2hex(random_bytes(16));

        return \sprintf('%s-%s-4%s-a%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 13, 3), substr($hex, 17, 3), substr($hex, 20, 12));
    }
}
