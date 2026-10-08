<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use NotionAlt\Database\SqlMigration;

final class M0015Metrics extends SqlMigration
{
    protected function statements(): array
    {
        return [
            // Prometheus series (name + labels as JSON) of this server, only with METRICS_ENABLED.
            'create table "metrics" ("name" text not null, "labels" text not null, "value" real not null, constraint "metrics_pk" primary key ("name", "labels"))',
        ];
    }
}
