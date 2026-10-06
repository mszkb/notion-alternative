<?php

declare(strict_types=1);

namespace NotionAlt\Database;

/**
 * A schema migration. Each one is the port of the Kysely migration with the same name in
 * apps/server/src/db/migrations and must produce exactly the same schema (same DDL text), so that
 * both servers can open each other's database (ADR 0018). Never change a migration afterwards.
 */
interface Migration
{
    public function up(\PDO $db): void;
}
