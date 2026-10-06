<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0006Conflicts extends SqlMigration
{
    protected function statements(): array
    {
        return [
            // Conflict objects (ADR 0003): both versions are kept until a user resolves them.
            'create table "conflicts" ("id" text primary key, "workspace_id" text not null references "workspaces" ("id") on delete cascade, "op_id" text not null unique, "entity" text not null, "entity_id" text not null, "document_id" text, "reason" text not null, "base_revision" integer, "local" text not null, "remote" text, "created_at" text not null, "resolved_at" text, "resolution" text, "revision" integer not null, "deleted_at" text)',
            'create index "conflicts_workspace_id_idx" on "conflicts" ("workspace_id")',
        ];
    }
}
