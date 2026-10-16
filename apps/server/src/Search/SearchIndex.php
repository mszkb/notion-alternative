<?php

declare(strict_types=1);

namespace NotionAlt\Search;

use NotionAlt\Database\Database;
use NotionAlt\Database\Sql;
use NotionAlt\Database\Transaction;
use NotionAlt\Text\InlineText;
use NotionAlt\Workspaces\Workspaces;

/**
 * Server-side full-text search (FTS5) over the title and
 * the plain text of a page's blocks. `search_index` rows are addressed by the rowid kept in
 * `search_documents` (#77); applied operations only mark pages in `search_dirty` (#99).
 * MariaDB/MySQL use `FULLTEXT` indexes instead (ADR 0024): words need at least 3 characters,
 * stopwords are not found, and hits are ranked differently.
 */
final class SearchIndex
{
    /** Default number of hits, as in `searchWorkspace`. */
    public const LIMIT = 20;

    /** At most this many words of the input become FTS terms. */
    private const MAX_TERMS = 10;

    /**
     * The characters JavaScript's `\s` matches (ECMAScript WhiteSpace and LineTerminator), so the
     * input is split into the same words as in the web app.
     */
    private const JS_WHITESPACE = '[\x{9}-\x{d}\x{20}\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]';

    /** InnoDB indexes no shorter words (`innodb_ft_min_token_size`, not changeable on shared hosting). */
    private const MYSQL_MIN_TERM_LENGTH = 3;

    /** Words of the body around the first hit, like FTS5's `snippet(…, 12)`. */
    private const SNIPPET_WORDS = 12;

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
        // MariaDB/MySQL have no rowid; their search_index has the column `id` (ADR 0024).
        $key = Database::isMysql($db) ? 'id' : 'rowid';
        $found = Sql::run($db, 'select id from search_documents where document_id = ?', [$documentId])->fetchColumn();
        $rowid = \is_int($found) ? $found : null;
        if ($rowid !== null) {
            Sql::run($db, "delete from search_index where {$key} = ?", [$rowid]);
        }
        /** @var array{id: string, workspace_id: string, title: string, deleted_at: string|null}|false $document */
        $document = Sql::run(
            $db,
            'select "id", "workspace_id", "title", "deleted_at" from "documents" where "id" = ?',
            [$documentId],
        )->fetch(\PDO::FETCH_ASSOC);
        // An empty deleted_at counts as not deleted.
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
            Sql::run($db, 'insert into search_documents (document_id) values (?)', [$documentId]);
            $rowid = (int) $db->lastInsertId();
        }
        Sql::run(
            $db,
            "insert into search_index ({$key}, document_id, workspace_id, title, body) values (?, ?, ?, ?, ?)",
            [$rowid, $document['id'], $document['workspace_id'], $document['title'], self::blocksText($blocks)],
        );
    }

    /** Marks a page's search entry as outdated; called in the transaction that changes the page. */
    public static function markForReindex(\PDO $db, string $documentId): void
    {
        Sql::insertIfMissing($db, 'insert into search_dirty (document_id) values (?)', 'document_id', [$documentId]);
    }

    /**
     * Rebuilds the entries of all marked pages, once per page (#99). Runs after each push, before
     * each search (so results never lag behind applied operations) and at startup (a crash between
     * applying and reindexing leaves marks behind, never a stale index without a mark).
     */
    public static function reindexMarked(\PDO $db): void
    {
        if (Sql::rows($db, 'select 1 from search_dirty limit 1') === []) {
            return;
        }
        $work = static function () use ($db): void {
            // Read inside the write transaction: another worker may have handled some pages. On
            // MariaDB/MySQL the rows are locked, so another worker waits and then skips them.
            /** @var list<string> $marked */
            $marked = Sql::run($db, 'select document_id from search_dirty' . (Database::isMysql($db) ? ' for update' : ''))->fetchAll(\PDO::FETCH_COLUMN);
            foreach ($marked as $documentId) {
                self::reindexDocument($db, $documentId);
                Sql::run($db, 'delete from search_dirty where document_id = ?', [$documentId]);
            }
        };
        // Joins an open transaction (PDO cannot nest them). Otherwise one of its own that takes the
        // write lock up front: a deferred one that reads first fails at once with SQLITE_BUSY when
        // another worker commits in between, without waiting for busy_timeout.
        if ($db->inTransaction()) {
            $work();
        } else {
            Transaction::run($db, $work);
        }
    }

    /**
     * Turns user input into a safe FTS5 query: every word becomes a quoted prefix term, all must
     * match. FTS syntax in the input (quotes, operators, columns) is never interpreted.
     */
    public static function toFtsQuery(string $input): ?string
    {
        // A /u pattern cannot split invalid UTF-8; broken sequences become U+FFFD.
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
        if (Workspaces::findForUser($db, $workspaceId, $userId) === null) {
            return null;
        }
        self::reindexMarked($db);
        if (Database::isMysql($db)) {
            return self::searchMysql($db, $workspaceId, $input, $limit);
        }
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

    /**
     * Words of the input as terms of MariaDB/MySQL's boolean mode, used as `+word*` (all must
     * match). Words are split where InnoDB splits them (anything but letters, digits and `_`), so
     * operators in the input are never interpreted; words shorter than InnoDB indexes are left out.
     *
     * @return list<string>
     */
    public static function toMysqlTerms(string $input): array
    {
        if (!mb_check_encoding($input, 'UTF-8')) {
            $input = htmlspecialchars_decode(htmlspecialchars($input, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'), ENT_QUOTES);
        }
        $words = preg_split('/[^\p{L}\p{N}_]+/u', $input, -1, PREG_SPLIT_NO_EMPTY);
        $terms = [];
        foreach ($words === false ? [] : $words as $word) {
            if (mb_strlen($word) < self::MYSQL_MIN_TERM_LENGTH) {
                continue;
            }
            $terms[] = $word;
            if (\count($terms) === self::MAX_TERMS) {
                break;
            }
        }

        return $terms;
    }

    /**
     * @return list<array{documentId: string, title: string, snippet: string}>
     */
    private static function searchMysql(\PDO $db, string $workspaceId, string $input, int $limit): array
    {
        $terms = self::toMysqlTerms($input);
        if ($terms === []) {
            return [];
        }
        $query = implode(' ', array_map(static fn(string $term): string => "+{$term}*", $terms));
        $statement = Sql::prepare(
            $db,
            "select document_id as \"documentId\", title, body\n"
            . "from search_index\n"
            . "where match(title, body) against(? in boolean mode) and workspace_id = ?\n"
            . "order by match(title) against(? in boolean mode) * 10 + match(title, body) against(? in boolean mode) desc\n"
            . 'limit ?',
        );
        $statement->bindValue(1, $query);
        $statement->bindValue(2, $workspaceId);
        $statement->bindValue(3, $query);
        $statement->bindValue(4, $query);
        $statement->bindValue(5, $limit, \PDO::PARAM_INT);
        $statement->execute();
        $hits = [];
        /** @var array{documentId: string, title: string, body: string} $row */
        foreach ($statement->fetchAll(\PDO::FETCH_ASSOC) as $row) {
            $hits[] = ['documentId' => $row['documentId'], 'title' => $row['title'], 'snippet' => self::snippet($row['body'], $terms)];
        }

        return $hits;
    }

    /**
     * Up to {@see SNIPPET_WORDS} words of the body around the first word that starts with a term,
     * `…` where text was cut off; the start of the body if no word matches.
     *
     * @param list<string> $terms
     */
    public static function snippet(string $body, array $terms): string
    {
        $words = preg_split('/' . self::JS_WHITESPACE . '+/u', $body, -1, PREG_SPLIT_NO_EMPTY);
        if ($words === false || $words === []) {
            return '';
        }
        $prefixes = array_map(self::fold(...), $terms);
        $hit = 0;
        foreach ($words as $index => $word) {
            $parts = preg_split('/[^\p{L}\p{N}_]+/u', self::fold($word), -1, PREG_SPLIT_NO_EMPTY);
            foreach ($parts === false ? [] : $parts as $part) {
                foreach ($prefixes as $prefix) {
                    if (str_starts_with($part, $prefix)) {
                        $hit = $index;
                        break 3;
                    }
                }
            }
        }
        $count = \count($words);
        $start = max(0, min($hit - intdiv(self::SNIPPET_WORDS, 2) + 1, $count - self::SNIPPET_WORDS));
        $end = min($count, $start + self::SNIPPET_WORDS);

        return ($start > 0 ? '…' : '') . implode(' ', \array_slice($words, $start, $end - $start)) . ($end < $count ? '…' : '');
    }

    /** Lower case without accents (with ext-intl), so a term finds the word as the index did. */
    private static function fold(string $text): string
    {
        $text = mb_strtolower($text);
        if (class_exists(\Normalizer::class)) {
            $decomposed = \Normalizer::normalize($text, \Normalizer::FORM_D);
            if (\is_string($decomposed)) {
                $text = preg_replace('/\p{Mn}+/u', '', $decomposed) ?? $text;
            }
        }

        return $text;
    }
}
