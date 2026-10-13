<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0016WorkspaceMembers extends SqlMigration
{
    protected function statements(): array
    {
        return [
            // Further members of a workspace (ADR 0014). The creator (workspaces.owner_id) is
            // always an owner and has no row here.
            'create table "workspace_members" ("workspace_id" text not null references "workspaces" ("id") on delete cascade, "user_id" text not null references "users" ("id") on delete cascade, "role" text not null, "added_at" text not null, constraint "workspace_members_pk" primary key ("workspace_id", "user_id"))',
            'create index "workspace_members_user_id_idx" on "workspace_members" ("user_id")',
        ];
    }
}
