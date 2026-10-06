<?php

declare(strict_types=1);

namespace NotionAlt\Database;

/** Small PDO helpers; PDO is used in exception mode, so `false` results only appear in its types. */
final class Sql
{
    public static function prepare(\PDO $db, string $sql): \PDOStatement
    {
        $statement = $db->prepare($sql);
        if ($statement === false) {
            throw new \RuntimeException('Cannot prepare statement');
        }

        return $statement;
    }

    /**
     * Prepares and executes a statement.
     *
     * @param list<mixed> $params
     */
    public static function run(\PDO $db, string $sql, array $params = []): \PDOStatement
    {
        $statement = self::prepare($db, $sql);
        $statement->execute($params);

        return $statement;
    }

    /**
     * @param list<mixed> $params
     *
     * @return list<array<string, mixed>>
     */
    public static function rows(\PDO $db, string $sql, array $params = []): array
    {
        /** @var list<array<string, mixed>> */
        return self::run($db, $sql, $params)->fetchAll(\PDO::FETCH_ASSOC);
    }
}
