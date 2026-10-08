<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0009SearchRowids extends SqlMigration
{
    protected function statements(): array
    {
        // `search_index.document_id` is unindexed, so finding a page's row scanned the whole FTS
        // table on every applied operation (#77). The row is now addressed by its rowid, kept in a
        // table with an explicit INTEGER PRIMARY KEY (stable across VACUUM and backups).
        return [
            "create table search_documents (\n    id integer primary key,\n    document_id text not null unique\n  )",
            "create temp table search_index_copy as\n    select document_id, workspace_id, title, body from search_index",
            'delete from search_index',
            "insert into search_documents (document_id)\n    select document_id from search_index_copy",
            "insert into search_index (rowid, document_id, workspace_id, title, body)\n"
                . "    select s.id, c.document_id, c.workspace_id, c.title, c.body\n"
                . '    from search_index_copy c join search_documents s on s.document_id = c.document_id',
            'drop table search_index_copy',
        ];
    }
}
