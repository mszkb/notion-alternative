<?php

declare(strict_types=1);

namespace NotionAlt\Attachments;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Support\Ids;

/** Port of `purgeDeletedAttachments` (apps/server/src/attachments/storage.ts), run by the cron (#127). */
final class Purge
{
    /**
     * Removes the files of attachments deleted longer than `$retentionDays` ago (ADR 0012). The
     * tombstones stay for the sync; only the content goes. Returns the number of removed files.
     */
    public static function deletedAttachments(\PDO $db, ContentStore $store, int $retentionDays, ?int $nowMs = null): int
    {
        $cutoff = Ids::iso(($nowMs ?? Ids::nowMs()) - $retentionDays * 24 * 60 * 60 * 1000);
        $rows = Sql::rows(
            $db,
            'select id, workspace_id from attachments
             where deleted_at is not null and deleted_at < ? and stored_at is not null',
            [$cutoff],
        );
        foreach ($rows as $row) {
            $store->remove(Row::string($row, 'workspace_id'), Row::string($row, 'id'));
            Sql::run($db, 'update attachments set stored_at = null where id = ?', [Row::string($row, 'id')]);
        }

        return \count($rows);
    }
}
