<?php

declare(strict_types=1);

namespace NotionAlt\Devices;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Database\Transaction;

/**
 * Devices of a user; removing one sets `revoked_at` (#46).
 *
 * @phpstan-type DeviceRow array{id: string, user_id: string, name: string, created_at: string, last_seen_at: string, revoked_at: string|null}
 */
final class Devices
{
    /**
     * @param DeviceRow $row
     *
     * @return array{id: string, name: string, createdAt: string, lastSeenAt: string, current: bool}
     */
    public static function toDevice(array $row, ?string $currentDeviceId): array
    {
        return [
            'id' => $row['id'],
            'name' => $row['name'],
            'createdAt' => $row['created_at'],
            'lastSeenAt' => $row['last_seen_at'],
            'current' => $row['id'] === $currentDeviceId,
        ];
    }

    /**
     * Any device with this id, of any user, including removed ones (ids are global).
     *
     * @return DeviceRow|null
     */
    public static function findById(\PDO $db, string $id): ?array
    {
        $rows = Sql::rows($db, 'select * from devices where id = ?', [$id]);

        return $rows === [] ? null : self::row($rows[0]);
    }

    /**
     * Active device of the user; sync must reject operations of devices this returns nothing for.
     *
     * @return DeviceRow|null
     */
    public static function findActive(\PDO $db, string $userId, string $id): ?array
    {
        $rows = Sql::rows(
            $db,
            'select * from devices where id = ? and user_id = ? and revoked_at is null',
            [$id, $userId],
        );

        return $rows === [] ? null : self::row($rows[0]);
    }

    /**
     * @return list<DeviceRow>
     */
    public static function listForUser(\PDO $db, string $userId): array
    {
        return array_map(self::row(...), Sql::rows(
            $db,
            'select * from devices where user_id = ? and revoked_at is null order by last_seen_at desc',
            [$userId],
        ));
    }

    public static function insert(\PDO $db, string $userId, string $id, string $name, string $now): void
    {
        Sql::run(
            $db,
            'insert into devices (id, user_id, name, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, null)',
            [$id, $userId, $name, $now, $now],
        );
    }

    /** Marks the device as seen (registration, later every sync run). */
    public static function touch(\PDO $db, string $userId, string $id, string $now): void
    {
        Sql::run(
            $db,
            'update devices set last_seen_at = ? where id = ? and user_id = ? and revoked_at is null',
            [$now, $id, $userId],
        );
    }

    public static function linkSession(\PDO $db, string $sessionId, string $deviceId): void
    {
        Sql::run($db, 'update sessions set device_id = ? where id = ?', [$deviceId, $sessionId]);
    }

    /** Returns false if the user has no such active device. */
    public static function rename(\PDO $db, string $userId, string $id, string $name): bool
    {
        return Sql::run(
            $db,
            'update devices set name = ? where id = ? and user_id = ? and revoked_at is null',
            [$name, $id, $userId],
        )->rowCount() > 0;
    }

    /** Removes the device: its sessions end, later operations from it are rejected. */
    public static function revoke(\PDO $db, string $userId, string $id, string $now): bool
    {
        return Transaction::run($db, static function () use ($db, $userId, $id, $now): bool {
            $updated = Sql::run(
                $db,
                'update devices set revoked_at = ? where id = ? and user_id = ? and revoked_at is null',
                [$now, $id, $userId],
            )->rowCount();
            if ($updated === 0) {
                return false;
            }
            Sql::run($db, 'delete from sessions where device_id = ?', [$id]);

            return true;
        });
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return DeviceRow
     */
    private static function row(array $row): array
    {
        return [
            'id' => Row::string($row, 'id'),
            'user_id' => Row::string($row, 'user_id'),
            'name' => Row::string($row, 'name'),
            'created_at' => Row::string($row, 'created_at'),
            'last_seen_at' => Row::string($row, 'last_seen_at'),
            'revoked_at' => Row::nullableString($row, 'revoked_at'),
        ];
    }
}
