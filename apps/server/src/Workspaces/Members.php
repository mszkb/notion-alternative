<?php

declare(strict_types=1);

namespace NotionAlt\Workspaces;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Support\Ids;

/**
 * Members of a workspace (ADR 0014): the creator (`workspaces.owner_id`, always an owner) and
 * the rows of `workspace_members`. Callers check the caller's role first.
 *
 * @phpstan-type Member array{userId: string, email: string, role: string, creator: bool, addedAt: string}
 */
final class Members
{
    /**
     * Creator first, then by the time they were added.
     *
     * @return list<Member>
     */
    public static function list(\PDO $db, string $workspaceId): array
    {
        $rows = Sql::rows(
            $db,
            "select users.id as user_id, users.email, 'owner' as role, 1 as creator, workspaces.created_at as added_at
             from workspaces inner join users on users.id = workspaces.owner_id
             where workspaces.id = ?
             union all
             select users.id, users.email, workspace_members.role, 0, workspace_members.added_at
             from workspace_members inner join users on users.id = workspace_members.user_id
             where workspace_members.workspace_id = ?
             order by creator desc, added_at, email",
            [$workspaceId, $workspaceId],
        );

        return array_map(self::member(...), $rows);
    }

    /**
     * @return Member|null
     */
    public static function find(\PDO $db, string $workspaceId, string $userId): ?array
    {
        foreach (self::list($db, $workspaceId) as $member) {
            if ($member['userId'] === $userId) {
                return $member;
            }
        }

        return null;
    }

    /** False if the user already is a member (not for the creator: callers check that). */
    public static function add(\PDO $db, string $workspaceId, string $userId, string $role): bool
    {
        return Sql::run(
            $db,
            'insert into workspace_members (workspace_id, user_id, role, added_at) values (?, ?, ?, ?)
             on conflict (workspace_id, user_id) do nothing',
            [$workspaceId, $userId, $role, Ids::iso(Ids::nowMs())],
        )->rowCount() === 1;
    }

    public static function setRole(\PDO $db, string $workspaceId, string $userId, string $role): void
    {
        Sql::run($db, 'update workspace_members set role = ? where workspace_id = ? and user_id = ?', [$role, $workspaceId, $userId]);
    }

    /** Removes the membership and the member's pending push hints for the workspace. */
    public static function remove(\PDO $db, string $workspaceId, string $userId): void
    {
        Sql::run($db, 'delete from workspace_members where workspace_id = ? and user_id = ?', [$workspaceId, $userId]);
        Sql::run(
            $db,
            'delete from push_hints where workspace_id = ?
               and endpoint in (select endpoint from push_subscriptions where user_id = ?)',
            [$workspaceId, $userId],
        );
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return Member
     */
    private static function member(array $row): array
    {
        return [
            'userId' => Row::string($row, 'user_id'),
            'email' => Row::string($row, 'email'),
            'role' => Row::string($row, 'role'),
            'creator' => Row::int($row, 'creator') === 1,
            'addedAt' => Row::string($row, 'added_at'),
        ];
    }
}
