<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0001Initial extends SqlMigration
{
    protected function statements(): array
    {
        return [
            'create table "users" ("id" text primary key, "email" text not null unique, "password_hash" text not null, "created_at" text not null)',
            'create table "sessions" ("id" text primary key, "user_id" text not null references "users" ("id") on delete cascade, "created_at" text not null, "expires_at" text not null)',
            'create index "sessions_user_id_idx" on "sessions" ("user_id")',
            'create table "workspaces" ("id" text primary key, "name" text not null, "owner_id" text not null references "users" ("id") on delete cascade, "created_at" text not null)',
            'create index "workspaces_owner_id_idx" on "workspaces" ("owner_id")',
        ];
    }
}
