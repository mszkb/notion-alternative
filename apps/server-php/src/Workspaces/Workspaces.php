<?php

declare(strict_types=1);

namespace NotionAlt\Workspaces;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Support\Ids;

/**
 * Port of apps/server/src/workspaces/repository.ts. Every read is restricted to the owner
 * (workspace boundary).
 *
 * @phpstan-type WorkspaceRow array{id: string, name: string, owner_id: string, created_at: string, compacted_seq: int}
 */
final class Workspaces
{
    /**
     * @param WorkspaceRow $row
     *
     * @return array{id: string, name: string, ownerId: string, createdAt: string}
     */
    public static function toWorkspace(array $row): array
    {
        return ['id' => $row['id'], 'name' => $row['name'], 'ownerId' => $row['owner_id'], 'createdAt' => $row['created_at']];
    }

    /**
     * @return list<WorkspaceRow>
     */
    public static function listForUser(\PDO $db, string $userId): array
    {
        return array_map(
            self::row(...),
            Sql::rows($db, 'select * from workspaces where owner_id = ? order by created_at', [$userId]),
        );
    }

    /**
     * The workspace only if the user may access it.
     *
     * @return WorkspaceRow|null
     */
    public static function findForUser(\PDO $db, string $workspaceId, string $userId): ?array
    {
        $rows = Sql::rows($db, 'select * from workspaces where id = ? and owner_id = ?', [$workspaceId, $userId]);

        return $rows === [] ? null : self::row($rows[0]);
    }

    /**
     * @return WorkspaceRow
     */
    public static function insert(\PDO $db, string $ownerId, string $name): array
    {
        $row = [
            'id' => Ids::uuid(),
            'name' => $name,
            'owner_id' => $ownerId,
            'created_at' => Ids::iso(Ids::nowMs()),
            'compacted_seq' => 0,
        ];
        Sql::run(
            $db,
            'insert into workspaces (id, name, owner_id, created_at, compacted_seq) values (?, ?, ?, ?, ?)',
            array_values($row),
        );

        return $row;
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return WorkspaceRow
     */
    private static function row(array $row): array
    {
        return [
            'id' => Row::string($row, 'id'),
            'name' => Row::string($row, 'name'),
            'owner_id' => Row::string($row, 'owner_id'),
            'created_at' => Row::string($row, 'created_at'),
            'compacted_seq' => Row::int($row, 'compacted_seq'),
        ];
    }
}
