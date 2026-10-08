<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use NotionAlt\Search\SearchIndex;
use NotionAlt\Tests\TempDir;
use PHPUnit\Framework\TestCase;

/**
 * Same pages, same queries, same hits as `searchWorkspace` in the Node server (fixture search.json
 * from apps/server/scripts/dump-php-search-fixture.ts): order, snippets and FTS queries.
 */
final class SearchNodeFixtureTest extends TestCase
{
    use TempDir;

    public function testReturnsTheHitsOfTheNodeServer(): void
    {
        $json = file_get_contents(__DIR__ . '/../fixtures/search.json');
        \assert(\is_string($json));
        /**
         * @var array{
         *     documents: list<array{id: string, title: string, deleted_at: string|null}>,
         *     blocks: list<array{id: string, document_id: string, type: string, content: string}>,
         *     queries: list<array{q: string, limit: int|null, ftsQuery: string|null, hits: list<array{documentId: string, title: string, snippet: string}>}>
         * } $fixture
         */
        $fixture = json_decode($json, true, 512, JSON_THROW_ON_ERROR);

        $db = Database::open($this->tempDir() . '/app.sqlite');
        (new Migrator($db))->migrateToLatest();
        $db->exec("insert into users (id, email, password_hash, created_at) values ('u1', 'a@example.com', 'h', 'now')");
        $db->exec("insert into workspaces (id, name, owner_id, created_at) values ('w1', 'Personal', 'u1', 'now')");
        foreach ($fixture['documents'] as $i => $document) {
            Sql::run(
                $db,
                "insert into documents (id, workspace_id, parent_id, title, sort_key, favorite, created_at, updated_at, revision, deleted_at)
                    values (?, 'w1', null, ?, ?, 0, 'now', 'now', 1, ?)",
                [$document['id'], $document['title'], "a{$i}", $document['deleted_at']],
            );
            SearchIndex::markForReindex($db, $document['id']);
        }
        foreach ($fixture['blocks'] as $i => $block) {
            Sql::run(
                $db,
                "insert into blocks (id, workspace_id, document_id, type, content, attrs, sort_key, revision, deleted_at)
                    values (?, 'w1', ?, ?, ?, '{}', ?, 1, null)",
                [$block['id'], $block['document_id'], $block['type'], $block['content'], \sprintf('a%02d', $i)],
            );
        }

        foreach ($fixture['queries'] as $query) {
            $label = $query['q'] . ($query['limit'] !== null ? " (limit {$query['limit']})" : '');
            self::assertSame($query['ftsQuery'], SearchIndex::toFtsQuery($query['q']), $label);
            $hits = $query['limit'] === null
                ? SearchIndex::searchWorkspace($db, 'u1', 'w1', $query['q'])
                : SearchIndex::searchWorkspace($db, 'u1', 'w1', $query['q'], $query['limit']);
            self::assertSame($query['hits'], $hits, $label);
        }
    }
}
