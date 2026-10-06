<?php

declare(strict_types=1);

namespace NotionAlt\Search;

use NotionAlt\Database\Sql;
use NotionAlt\Text\InlineText;

/**
 * Port of apps/server/src/search/index.ts: server-side full-text search (FTS5) over the title and
 * the plain text of a page's blocks. `search_index` rows are addressed by the rowid kept in
 * `search_documents` (#77); applied operations only mark pages in `search_dirty` (#99).
 */
final class SearchIndex
{
    /** Default number of hits, as in `searchWorkspace`. */
    public const LIMIT = 20;

    /** At most this many words of the input become FTS terms. */
    private const MAX_TERMS = 10;

    /**
     * The characters JavaScript's `\s` matches (ECMAScript WhiteSpace and LineTerminator), so the
     * input is split into the same words as in Node.
     */
    private const JS_WHITESPACE = '[\x{9}-\x{d}\x{20}\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]';

    /**
     * Plain text of a page's blocks as indexed: Markdown inline normalised, code verbatim.
     *
     * @param iterable<array{type: string, content: string}> $blocks
     */
    public static function blocksText(iterable $blocks): string
    {
        $texts = [];
        foreach ($blocks as $block) {
            $texts[] = $block['type'] === 'code' ? $block['content'] : InlineText::toPlainText($block['content']);
        }

        return implode("\n", $texts);
    }

    /**
     * Rebuilds the index row of one page from its current state; deleted pages leave the index.
     * Called in the same transaction that applies an operation.
     */
    public static function reindexDocument(\PDO $db, string $documentId): void
    {
        // Addressed by rowid: a lookup by the unindexed document_id would scan the whole index (#77).
        $found = Sql::run($db, 'select id from search_documents where document_id = ?', [$documentId])->fetchColumn();
        $rowid = \is_int($found) ? $found : null;
        if ($rowid !== null) {
            Sql::run($db, 'delete from search_index where rowid = ?', [$rowid]);
        }
        /** @var array{id: string, workspace_id: string, title: string, deleted_at: string|null}|false $document */
        $document = Sql::run(
            $db,
            'select "id", "workspace_id", "title", "deleted_at" from "documents" where "id" = ?',
            [$documentId],
        )->fetch(\PDO::FETCH_ASSOC);
        // Like the falsy check in Node: an empty deleted_at counts as not deleted.
        if ($document === false || ($document['deleted_at'] !== null && $document['deleted_at'] !== '')) {
            if ($rowid !== null) {
                Sql::run($db, 'delete from search_documents where id = ?', [$rowid]);
            }

            return;
        }
        /** @var list<array{type: string, content: string}> $blocks */
        $blocks = Sql::rows(
            $db,
            'select "type", "content" from "blocks" where "document_id" = ? and "deleted_at" is null order by "sort_key"',
            [$documentId],
        );
        if ($rowid === null) {
            $id = Sql::run($db, 'insert into search_documents (document_id) values (?) returning id', [$documentId])->fetchColumn();
            \assert(\is_int($id));
            $rowid = $id;
        }
        Sql::run(
            $db,
            'insert into search_index (rowid, document_id, workspace_id, title, body) values (?, ?, ?, ?, ?)',
            [$rowid, $document['id'], $document['workspace_id'], $document['title'], self::blocksText($blocks)],
        );
    }

    /** Marks a page's search entry as outdated; called in the transaction that changes the page. */
    public static function markForReindex(\PDO $db, string $documentId): void
    {
        Sql::run($db, 'insert or ignore into search_dirty (document_id) values (?)', [$documentId]);
    }

    /**
     * Rebuilds the entries of all marked pages, once per page (#99). Runs after each push, before
     * each search (so results never lag behind applied operations) and at startup (a crash between
     * applying and reindexing leaves marks behind, never a stale index without a mark).
     */
    public static function reindexMarked(\PDO $db): void
    {
        /** @var list<string> $marked */
        $marked = Sql::run($db, 'select document_id from search_dirty')->fetchAll(\PDO::FETCH_COLUMN);
        if ($marked === []) {
            return;
        }
        // Joins an open transaction (PDO cannot nest them); otherwise runs in one of its own.
        $own = !$db->inTransaction();
        if ($own) {
            $db->beginTransaction();
        }
        try {
            foreach ($marked as $documentId) {
                self::reindexDocument($db, $documentId);
                Sql::run($db, 'delete from search_dirty where document_id = ?', [$documentId]);
            }
            if ($own) {
                $db->commit();
            }
        } catch (\Throwable $error) {
            if ($own) {
                $db->rollBack();
            }

            throw $error;
        }
    }

    /**
     * Turns user input into a safe FTS5 query: every word becomes a quoted prefix term, all must
     * match. FTS syntax in the input (quotes, operators, columns) is never interpreted.
     */
    public static function toFtsQuery(string $input): ?string
    {
        // A /u pattern cannot split invalid UTF-8; broken sequences become U+FFFD as in Node.
        if (!mb_check_encoding($input, 'UTF-8')) {
            $input = htmlspecialchars_decode(htmlspecialchars($input, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'), ENT_QUOTES);
        }
        $words = preg_split('/' . self::JS_WHITESPACE . '+/u', $input);
        if ($words === false) {
            return null;
        }
        $terms = [];
        foreach ($words as $word) {
            $term = str_replace('"', '', $word);
            if (preg_match('/[\p{L}\p{N}]/u', $term) !== 1) {
                continue;
            }
            $terms[] = '"' . $term . '"*';
            if (\count($terms) === self::MAX_TERMS) {
                break;
            }
        }

        return $terms === [] ? null : implode(' ', $terms);
    }

    /**
     * Full-text search in one workspace of the user; null if the workspace is not theirs. Hits in
     * the order and shape of `GET /api/search` (`ServerSearchHit`): best match first, title hits
     * weighted ten times higher than body hits, snippet of the body without highlight markers.
     *
     * @return list<array{documentId: string, title: string, snippet: string}>|null
     */
    public static function searchWorkspace(
        \PDO $db,
        string $userId,
        string $workspaceId,
        string $input,
        int $limit = self::LIMIT,
    ): ?array {
        // Same restriction as findWorkspaceForUser: only workspaces the user owns.
        $owned = Sql::run($db, 'select 1 from "workspaces" where "id" = ? and "owner_id" = ?', [$workspaceId, $userId])->fetchColumn();
        if ($owned === false) {
            return null;
        }
        self::reindexMarked($db);
        $query = self::toFtsQuery($input);
        if ($query === null) {
            return [];
        }
        $statement = Sql::prepare(
            $db,
            "select document_id as \"documentId\", title,\n"
            . "  snippet(search_index, 3, '', '', '…', 12) as snippet\n"
            . "from search_index\n"
            . "where search_index match ? and workspace_id = ?\n"
            . "order by bm25(search_index, 0, 0, 10.0, 1.0)\n"
            . 'limit ?',
        );
        $statement->bindValue(1, $query);
        $statement->bindValue(2, $workspaceId);
        $statement->bindValue(3, $limit, \PDO::PARAM_INT);
        $statement->execute();

        /** @var list<array{documentId: string, title: string, snippet: string}> */
        return $statement->fetchAll(\PDO::FETCH_ASSOC);
    }
}
