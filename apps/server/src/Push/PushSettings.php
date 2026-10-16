<?php

declare(strict_types=1);

namespace NotionAlt\Push;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Support\Ids;

/** VAPID keys and installation id, created once in the table `settings`. */
final class PushSettings
{
    /** VAPID key pair of this installation, created on first use (stored in the database backup). */
    public static function vapidKeys(\PDO $db): VapidKeys
    {
        return VapidKeys::fromJson(self::setting($db, 'vapid', static fn(): string => VapidKeys::generate()->toJson()));
    }

    public static function installationId(\PDO $db): string
    {
        return self::setting($db, 'installation_id', Ids::uuid(...));
    }

    /**
     * Reads a server setting, creating it once (concurrent first requests agree on one value).
     *
     * @param \Closure(): string $create
     */
    private static function setting(\PDO $db, string $key, \Closure $create): string
    {
        // `key` is quoted: a reserved word on MariaDB/MySQL.
        $rows = Sql::rows($db, 'select value from settings where "key" = ?', [$key]);
        if ($rows === []) {
            Sql::insertIfMissing($db, 'insert into settings ("key", value) values (?, ?)', '"key"', [$key, $create()]);
            $rows = Sql::rows($db, 'select value from settings where "key" = ?', [$key]);
        }

        return Row::string($rows[0] ?? [], 'value');
    }
}
