<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0014PushHints extends SqlMigration
{
    protected function statements(): array
    {
        return [
            // Pending push hint per subscription (bundles a burst); due_at/sent_at in epoch ms.
            'create table "push_hints" ("endpoint" text primary key references "push_subscriptions" ("endpoint") on delete cascade, "workspace_id" text not null references "workspaces" ("id") on delete cascade, "due_at" integer, "sent_at" integer)',
            'create index "push_hints_due_at_idx" on "push_hints" ("due_at")',
        ];
    }
}
