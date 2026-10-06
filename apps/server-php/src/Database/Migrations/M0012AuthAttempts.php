<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0012AuthAttempts extends SqlMigration
{
    protected function statements(): array
    {
        return [
            // Rate-limit counters of this server (fixed window per key, reset_at in epoch ms).
            'create table "auth_attempts" ("key" text primary key, "count" integer not null, "reset_at" integer not null)',
            'create index "auth_attempts_reset_at_idx" on "auth_attempts" ("reset_at")',
        ];
    }
}
