<?php

declare(strict_types=1);

namespace NotionAlt\Auth;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Support\Ids;

/** Session tokens; the database stores only the SHA-256 of the token. */
final class Sessions
{
    public const COOKIE = 'session';

    public static function id(string $token): string
    {
        return hash('sha256', $token);
    }

    /**
     * @return array{token: string, expiresAt: int} expiry in epoch milliseconds
     */
    public static function create(\PDO $db, string $userId, int $ttlDays): array
    {
        $token = Ids::base64Url(random_bytes(32));
        $now = Ids::nowMs();
        $expiresAt = $now + $ttlDays * 24 * 60 * 60 * 1000;
        Sql::run(
            $db,
            'insert into sessions (id, user_id, created_at, expires_at, device_id) values (?, ?, ?, ?, null)',
            [self::id($token), $userId, Ids::iso($now), Ids::iso($expiresAt)],
        );

        return ['token' => $token, 'expiresAt' => $expiresAt];
    }

    /**
     * The user of a valid, unexpired session token.
     *
     * @return array{id: string, email: string, created_at: string, device_id: string|null}|null
     */
    public static function findUser(\PDO $db, string $token): ?array
    {
        $rows = Sql::rows(
            $db,
            'select users.id, users.email, users.created_at, sessions.device_id from sessions
             inner join users on users.id = sessions.user_id
             where sessions.id = ? and sessions.expires_at > ?',
            [self::id($token), Ids::iso(Ids::nowMs())],
        );
        if ($rows === []) {
            return null;
        }
        $row = $rows[0];

        return [
            'id' => Row::string($row, 'id'),
            'email' => Row::string($row, 'email'),
            'created_at' => Row::string($row, 'created_at'),
            'device_id' => Row::nullableString($row, 'device_id'),
        ];
    }

    public static function delete(\PDO $db, string $token): void
    {
        Sql::run($db, 'delete from sessions where id = ?', [self::id($token)]);
    }

    /** Ends every session of the user except the one identified by `$keepToken`. */
    public static function deleteOthers(\PDO $db, string $userId, string $keepToken): void
    {
        Sql::run($db, 'delete from sessions where user_id = ? and id != ?', [$userId, self::id($keepToken)]);
    }
}
