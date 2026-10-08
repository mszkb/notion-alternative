<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0003Sync extends SqlMigration
{
    protected function statements(): array
    {
        return [
            // Synchronised entities (docs/architecture/sync.md). Ids come from the clients; `revision` is
            // assigned by the server and rises with every applied change; `deleted_at` is the tombstone.
            'create table "documents" ("id" text primary key, "workspace_id" text not null references "workspaces" ("id") on delete cascade, "parent_id" text, "title" text not null, "sort_key" text not null, "favorite" integer not null, "created_at" text not null, "updated_at" text not null, "revision" integer not null, "deleted_at" text)',
            'create index "documents_workspace_id_idx" on "documents" ("workspace_id")',
            'create table "blocks" ("id" text primary key, "workspace_id" text not null references "workspaces" ("id") on delete cascade, "document_id" text not null, "type" text not null, "content" text not null, "attrs" text not null, "sort_key" text not null, "revision" integer not null, "deleted_at" text)',
            'create index "blocks_document_id_idx" on "blocks" ("document_id")',
            'create index "blocks_workspace_id_idx" on "blocks" ("workspace_id")',
            'create table "tags" ("id" text primary key, "workspace_id" text not null references "workspaces" ("id") on delete cascade, "name" text not null, "revision" integer not null, "deleted_at" text)',
            'create index "tags_workspace_id_idx" on "tags" ("workspace_id")',
            'create table "document_tags" ("id" text primary key, "workspace_id" text not null references "workspaces" ("id") on delete cascade, "document_id" text not null, "tag_id" text not null, "revision" integer not null, "deleted_at" text)',
            'create index "document_tags_document_id_idx" on "document_tags" ("document_id")',
            'create index "document_tags_workspace_id_idx" on "document_tags" ("workspace_id")',
            // Change log: one row per applied operation; `seq` is gap-free per workspace (= sync cursor).
            'create table "changes" ("workspace_id" text not null references "workspaces" ("id") on delete cascade, "seq" integer not null, "op_id" text not null unique, "device_id" text not null, "entity" text not null, "entity_id" text not null, "kind" text not null, "revision" integer not null, "payload" text not null, "applied_at" text not null, constraint "changes_pk" primary key ("workspace_id", "seq"))',
            'create index "changes_entity_idx" on "changes" ("entity", "entity_id")',
        ];
    }
}
