<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0017ShareLinks extends SqlMigration
{
    protected function statements(): array
    {
        return [
            // Read links for people without an account (ADR 0022): one page each, only the
            // SHA-256 of the token is stored. Revoking deletes the row.
            'create table "share_links" ("id" text primary key, "token_hash" text not null unique, "workspace_id" text not null references "workspaces" ("id") on delete cascade, "document_id" text not null, "created_by" text not null references "users" ("id") on delete cascade, "created_at" text not null, "expires_at" text)',
            'create index "share_links_workspace_id_document_id_idx" on "share_links" ("workspace_id", "document_id")',
            'create index "share_links_created_by_idx" on "share_links" ("created_by")',
        ];
    }
}
