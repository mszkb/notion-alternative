<?php

declare(strict_types=1);

namespace NotionAlt\Database;

/**
 * A schema migration. Migrations 0001–0015 reproduce the schema of the former Node server exactly
 * (same DDL text), so its databases are continued (ADR 0018). Never change a migration afterwards.
 */
interface Migration
{
    public function up(\PDO $db): void;
}
