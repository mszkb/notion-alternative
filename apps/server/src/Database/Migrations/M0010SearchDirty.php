<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0010SearchDirty extends SqlMigration
{
    protected function statements(): array
    {
        // Pages whose search entry is outdated (#99). An applied operation only marks its page, in
        // the same transaction; the entry is rebuilt once per page after a push, before a search and
        // at startup, instead of once per block operation.
        return ['create table search_dirty (document_id text primary key)'];
    }
}
