<?php

declare(strict_types=1);

namespace NotionAlt\Auth;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Support\Ids;

/**
 * Accounts; email addresses are stored normalized (trimmed, lowercase).
 *
 * @phpstan-type UserRow array{id: string, email: string, password_hash: string, created_at: string}
 */
final class Users
{
    /**
     * @param array{id: string, email: string, created_at: string} $row
     *
     * @return array{id: string, email: string, createdAt: string}
     */
    public static function toUser(array $row): array
    {
        return ['id' => $row['id'], 'email' => $row['email'], 'createdAt' => $row['created_at']];
    }

    public static function count(\PDO $db): int
    {
        return Row::int(Sql::rows($db, 'select count(*) as count from users')[0], 'count');
    }

    /**
     * @return UserRow|null
     */
    public static function findByEmail(\PDO $db, string $email): ?array
    {
        return self::one($db, 'select * from users where email = ?', [$email]);
    }

    /**
     * @return UserRow|null
     */
    public static function findById(\PDO $db, string $id): ?array
    {
        return self::one($db, 'select * from users where id = ?', [$id]);
    }

    /**
     * @return UserRow
     */
    public static function insert(\PDO $db, string $email, string $passwordHash): array
    {
        $row = [
            'id' => Ids::uuid(),
            'email' => $email,
            'password_hash' => $passwordHash,
            'created_at' => Ids::iso(Ids::nowMs()),
        ];
        Sql::run(
            $db,
            'insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)',
            [$row['id'], $row['email'], $row['password_hash'], $row['created_at']],
        );

        return $row;
    }

    public static function updatePasswordHash(\PDO $db, string $id, string $passwordHash): void
    {
        Sql::run($db, 'update users set password_hash = ? where id = ?', [$passwordHash, $id]);
    }

    /**
     * @param list<mixed> $params
     *
     * @return UserRow|null
     */
    private static function one(\PDO $db, string $sql, array $params): ?array
    {
        $rows = Sql::rows($db, $sql, $params);
        if ($rows === []) {
            return null;
        }

        return [
            'id' => Row::string($rows[0], 'id'),
            'email' => Row::string($rows[0], 'email'),
            'password_hash' => Row::string($rows[0], 'password_hash'),
            'created_at' => Row::string($rows[0], 'created_at'),
        ];
    }
}
