<?php

declare(strict_types=1);

namespace NotionAlt\Database;

/** A migration made of SQL statements only. */
abstract class SqlMigration implements Migration
{
    /**
     * @return list<string>
     */
    abstract protected function statements(): array;

    public function up(\PDO $db): void
    {
        foreach ($this->statements() as $statement) {
            $db->exec($statement);
        }
    }
}
