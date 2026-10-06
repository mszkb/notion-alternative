<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0002Devices extends SqlMigration
{
    protected function statements(): array
    {
        return [
            // Removed devices stay as a row so their sessions and operations are rejected for good.
            'create table "devices" ("id" text primary key, "user_id" text not null references "users" ("id") on delete cascade, "name" text not null, "created_at" text not null, "last_seen_at" text not null, "revoked_at" text)',
            'create index "devices_user_id_idx" on "devices" ("user_id")',
            // The device a session belongs to (set on registration); removing the device ends it.
            'alter table "sessions" add column "device_id" text',
            'create index "sessions_device_id_idx" on "sessions" ("device_id")',
        ];
    }
}
