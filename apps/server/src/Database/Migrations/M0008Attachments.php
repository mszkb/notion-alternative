<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0008Attachments extends SqlMigration
{
    protected function statements(): array
    {
        return [
            // Attachment metadata (ADR 0012); the content lives in DATA_DIR/attachments.
            'create table "attachments" ("id" text primary key, "workspace_id" text not null references "workspaces" ("id") on delete cascade, "document_id" text not null, "name" text not null, "mime_type" text not null, "size" integer not null, "sha256" text not null, "created_at" text not null, "stored_at" text, "revision" integer not null, "deleted_at" text)',
            'create index "attachments_workspace_id_idx" on "attachments" ("workspace_id")',
        ];
    }
}
