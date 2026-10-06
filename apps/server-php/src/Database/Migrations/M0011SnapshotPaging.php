<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0011SnapshotPaging extends SqlMigration
{
    private const TABLES = ['documents', 'blocks', 'tags', 'document_tags', 'attachments', 'conflicts'];

    protected function statements(): array
    {
        // A paged snapshot (#97) walks each table by id within one workspace. The workspace index
        // alone orders by rowid, so every page would sort the whole workspace.
        return array_map(
            static fn(string $table): string => "create index {$table}_workspace_id_id_idx on \"{$table}\" (workspace_id, id)",
            self::TABLES,
        );
    }
}
