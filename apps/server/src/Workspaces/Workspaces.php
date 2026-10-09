<?php

declare(strict_types=1);

namespace NotionAlt\Workspaces;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Support\Ids;

/**
 * Workspaces; every read is restricted to the members (workspace boundary, ADR 0014). The
 * creator (`owner_id`) is always an owner and carries the attachment quota; `workspace_members`
 * holds everyone else.
 *
 * @phpstan-type WorkspaceRow array{id: string, name: string, owner_id: string, created_at: string, compacted_seq: int}
 */
final class Workspaces
{
    /** Roles by rank: each one may do everything the lower ones may (ADR 0014). */
    public const ROLES = ['reader' => 1, 'commenter' => 2, 'editor' => 3, 'owner' => 4];

    /** The creator is always an owner, everyone else has the role of their membership (user id). */
    private const ROLE_SQL = "case when workspaces.owner_id = ? then 'owner' else workspace_members.role end";

    /** Whether `$role` is at least `$minimum`. */
    public static function atLeast(string $role, string $minimum): bool
    {
        return (self::ROLES[$role] ?? 0) >= (self::ROLES[$minimum] ?? PHP_INT_MAX);
    }

    /**
     * @param WorkspaceRow $row
     *
     * @return array{id: string, name: string, ownerId: string, createdAt: string, role?: string}
     */
    public static function toWorkspace(array $row, ?string $role = null): array
    {
        $workspace = ['id' => $row['id'], 'name' => $row['name'], 'ownerId' => $row['owner_id'], 'createdAt' => $row['created_at']];
        if ($role !== null) {
            $workspace['role'] = $role;
        }

        return $workspace;
    }

    /**
     * The user's workspaces with their role in each.
     *
     * @return list<array{workspace: WorkspaceRow, role: string}>
     */
    public static function listForUser(\PDO $db, string $userId): array
    {
        $rows = Sql::rows(
            $db,
            'select workspaces.*, ' . self::ROLE_SQL . ' as role
             from workspaces left join workspace_members
               on workspace_members.workspace_id = workspaces.id and workspace_members.user_id = ?
             where workspaces.owner_id = ? or workspace_members.user_id is not null
             order by workspaces.created_at',
            [$userId, $userId, $userId],
        );

        return array_map(static fn(array $row): array => ['workspace' => self::row($row), 'role' => Row::string($row, 'role')], $rows);
    }

    /**
     * The workspace only if the user is a member with at least `$minimum`.
     *
     * @return WorkspaceRow|null
     */
    public static function findForUser(\PDO $db, string $workspaceId, string $userId, string $minimum = 'reader'): ?array
    {
        $found = self::findWithRole($db, $workspaceId, $userId);

        return $found !== null && self::atLeast($found['role'], $minimum) ? $found['workspace'] : null;
    }

    /**
     * The workspace and the user's role in it, or null for non-members.
     *
     * @return array{workspace: WorkspaceRow, role: string}|null
     */
    public static function findWithRole(\PDO $db, string $workspaceId, string $userId): ?array
    {
        $rows = Sql::rows(
            $db,
            'select workspaces.*, ' . self::ROLE_SQL . ' as role
             from workspaces left join workspace_members
               on workspace_members.workspace_id = workspaces.id and workspace_members.user_id = ?
             where workspaces.id = ? and (workspaces.owner_id = ? or workspace_members.user_id is not null)',
            [$userId, $userId, $workspaceId, $userId],
        );

        return $rows === [] ? null : ['workspace' => self::row($rows[0]), 'role' => Row::string($rows[0], 'role')];
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
