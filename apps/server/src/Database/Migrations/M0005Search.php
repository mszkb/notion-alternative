<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\Migration;
use NotionAlt\Database\Sql;
use NotionAlt\Text\InlineText;

final class M0005Search implements Migration
{
    public function up(\PDO $db): void
    {
        // One row per active page: title and the plain text of its blocks (server-side search, FTS5).
        // `remove_diacritics 2` lets "uber" find "über"; prefixes are matched by the query.
        // The exact text (line breaks, indentation) in sqlite_master of existing databases.
        $db->exec(
            "create virtual table search_index using fts5(\n"
            . "    document_id unindexed,\n"
            . "    workspace_id unindexed,\n"
            . "    title,\n"
            . "    body,\n"
            . "    tokenize = 'unicode61 remove_diacritics 2'\n"
            . '  )',
        );

        // Initial fill from the existing pages (same text rules as the app at the time of writing).
        $blocks = Sql::prepare($db, 'select "type", "content" from "blocks" where "document_id" = ? and "deleted_at" is null order by "sort_key"');
        $insert = Sql::prepare($db, 'insert into search_index (document_id, workspace_id, title, body) values (?, ?, ?, ?)');
        /** @var list<array{id: string, workspace_id: string, title: string}> $rows */
        $rows = Sql::rows($db, 'select "id", "workspace_id", "title" from "documents" where "deleted_at" is null');
        foreach ($rows as $document) {
            $blocks->execute([$document['id']]);
            /** @var list<array{type: string, content: string}> $blockRows */
            $blockRows = $blocks->fetchAll(\PDO::FETCH_ASSOC);
            $texts = [];
            foreach ($blockRows as $block) {
                $texts[] = $block['type'] === 'code' ? $block['content'] : InlineText::toPlainText($block['content']);
            }
            $body = implode("\n", $texts);
            $insert->execute([$document['id'], $document['workspace_id'], $document['title'], $body]);
        }
    }
}
