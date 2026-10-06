<?php

declare(strict_types=1);

namespace NotionAlt\Sync;

use NotionAlt\Database\Sql;
use NotionAlt\Workspaces\Workspaces;

/** Port of apps/server/src/sync/changes.ts: reading and compacting the change log. */
final class Changes
{
    /**
     * Changes after `$cursor` in `seq` order, or null if the user may not access the workspace.
     * Basis for `GET /api/sync/pull` (ADR 0002).
     *
     * @return list<array<string, mixed>>|null
     */
    public static function listSince(\PDO $db, string $userId, string $workspaceId, int $cursor, int $limit): ?array
    {
        if (Workspaces::findForUser($db, $workspaceId, $userId) === null) {
            return null;
        }

        return Sql::rows(
            $db,
            'select * from changes where workspace_id = ? and seq > ? order by seq limit ?',
            [$workspaceId, $cursor, $limit],
        );
    }

    /** Highest `seq` handed out in the workspace, including compacted ones. */
    public static function latestSeq(\PDO $db, string $workspaceId, int $compactedSeq): int
    {
        $max = Sql::run($db, 'select max(seq) from changes where workspace_id = ?', [$workspaceId])->fetchColumn();

        return max(is_numeric($max) ? (int) $max : 0, $compactedSeq);
    }

    /**
     * Removes change-log entries up to `$throughSeq` (log compaction). Not scheduled in the MVP
     * (ADR 0002); used to test the re-sync path (T-MD-05). Pulls from an older cursor get 410.
     */
    public static function compact(\PDO $db, string $workspaceId, int $throughSeq): void
    {
        $db->beginTransaction();
        try {
            Sql::run($db, 'delete from changes where workspace_id = ? and seq <= ?', [$workspaceId, $throughSeq]);
            Sql::run($db, 'update workspaces set compacted_seq = max(compacted_seq, ?) where id = ?', [$throughSeq, $workspaceId]);
            $db->commit();
        } catch (\Throwable $error) {
            $db->rollBack();

            throw $error;
        }
    }
}
