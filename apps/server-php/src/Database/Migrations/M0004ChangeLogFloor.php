<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0004ChangeLogFloor extends SqlMigration
{
    protected function statements(): array
    {
        return [
            // Highest change `seq` removed by log compaction; pulls from an older cursor need a re-sync.
            'alter table "workspaces" add column "compacted_seq" integer default 0 not null',
        ];
    }
}
