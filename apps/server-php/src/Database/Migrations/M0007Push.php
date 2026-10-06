<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0007Push extends SqlMigration
{
    protected function statements(): array
    {
        return [
            // Server-wide values created on first start (VAPID keys, installation id); part of the backup.
            'create table "settings" ("key" text primary key, "value" text not null)',
            // Web Push subscriptions, one per device (ADR 0005).
            'create table "push_subscriptions" ("endpoint" text primary key, "user_id" text not null references "users" ("id") on delete cascade, "device_id" text not null references "devices" ("id") on delete cascade, "p256dh" text not null, "auth" text not null, "created_at" text not null, "last_success_at" text, "failures" integer default 0 not null)',
            'create index "push_subscriptions_user_id_idx" on "push_subscriptions" ("user_id")',
        ];
    }
}
