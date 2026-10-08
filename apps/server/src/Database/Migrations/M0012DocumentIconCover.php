<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0012DocumentIconCover extends SqlMigration
{
    protected function statements(): array
    {
        // Page icon (emoji) and cover (`gradient:<name>` or `attachment:<uuid>`), #136.
        return [
            'alter table "documents" add column "icon" text',
            'alter table "documents" add column "cover" text',
        ];
    }
}
