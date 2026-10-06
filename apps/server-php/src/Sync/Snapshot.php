<?php

declare(strict_types=1);

namespace NotionAlt\Sync;

use NotionAlt\Database\Sql;
use NotionAlt\Workspaces\Workspaces;

/** Port of apps/server/src/sync/snapshot.ts: the workspace state for a full re-sync. */
final class Snapshot
{
    /**
     * Order in which a paged snapshot walks the tables; the index is part of the `after` token.
     * Each table maps to its response key and row mapper.
     */
    public const TABLES = ['documents', 'tags', 'document_tags', 'attachments', 'blocks', 'conflicts'];

    private const KEYS = [
        'documents' => 'documents',
        'tags' => 'tags',
        'document_tags' => 'documentTags',
        'attachments' => 'attachments',
        'blocks' => 'blocks',
        'conflicts' => 'conflicts',
    ];

    /**
     * Complete state of a workspace including tombstones, read in one transaction so entities
     * and cursor match (ADR 0002 re-sync). Null if the user may not access the workspace.
     *
     * @return array<string, mixed>|null
     */
    public static function load(\PDO $db, string $userId, string $workspaceId): ?array
    {
        return self::inTransaction($db, static function () use ($db, $userId, $workspaceId): ?array {
            $workspace = Workspaces::findForUser($db, $workspaceId, $userId);
            if ($workspace === null) {
                return null;
            }
            $snapshot = [];
            foreach (['documents', 'blocks', 'tags', 'document_tags', 'attachments', 'conflicts'] as $table) {
                $rows = Sql::rows($db, "select * from {$table} where workspace_id = ?", [$workspaceId]);
                $snapshot[self::KEYS[$table]] = self::map($table, $rows);
            }
            $snapshot['cursor'] = Changes::latestSeq($db, $workspaceId, $workspace['compacted_seq']);

            return $snapshot;
        });
    }

    /**
     * One page of a paged snapshot (#97): at most `$limit` entities, walking the tables in a
     * fixed order and each table by id. Every page is a short read of its own. The first page
     * (no `$after`) fixes the cursor and carries it in `next`. Rows on later pages may be newer
     * than the cursor and rows created behind the walk are missing; both are covered by the pull
     * from the cursor, which replays every change after it (tombstones included, ADR 0002).
     * Null if the user may not access the workspace or `$after` names no table.
     *
     * @return array<string, mixed>|null
     */
    public static function loadPage(\PDO $db, string $userId, string $workspaceId, int $limit, ?string $after = null): ?array
    {
        return self::inTransaction($db, static function () use ($db, $userId, $workspaceId, $limit, $after): ?array {
            $workspace = Workspaces::findForUser($db, $workspaceId, $userId);
            if ($workspace === null) {
                return null;
            }
            $table = 0;
            $lastId = null;
            $total = null;
            // An empty `after` counts as missing, like the `if (after)` in Node.
            if ($after !== null && $after !== '') {
                $token = self::parseToken($after);
                if ($token === null) {
                    return null;
                }
                [$cursor, $table, $lastId] = $token;
            } else {
                $cursor = Changes::latestSeq($db, $workspaceId, $workspace['compacted_seq']);
                $total = 0;
                foreach (self::TABLES as $name) {
                    $total += (int) Sql::run($db, "select count(*) from {$name} where workspace_id = ?", [$workspaceId])->fetchColumn();
                }
            }

            $page = [
                'documents' => [],
                'blocks' => [],
                'tags' => [],
                'documentTags' => [],
                'attachments' => [],
                'conflicts' => [],
                'cursor' => $cursor,
                'next' => null,
            ];
            if ($total !== null) {
                $page['total'] = $total;
            }
            $room = $limit;
            for (; $table < \count(self::TABLES) && $room > 0; $table++, $lastId = null) {
                $name = self::TABLES[$table];
                $sql = "select * from {$name} where workspace_id = ?";
                $params = [$workspaceId];
                if ($lastId !== null) {
                    $sql .= ' and id > ?';
                    $params[] = $lastId;
                }
                $sql .= ' order by id limit ?';
                $params[] = $room + 1;
                $rows = Sql::rows($db, $sql, $params);
                $taken = \array_slice($rows, 0, $room);
                $room -= \count($taken);
                $page[self::KEYS[$name]] = self::map($name, $taken);
                if (\count($rows) > \count($taken)) {
                    $last = $taken[\count($taken) - 1];
                    $page['next'] = $cursor . '.' . $table . '.' . (\is_string($last['id'] ?? null) ? $last['id'] : '');

                    return $page;
                }
            }
            // The page filled up exactly at the end of a table: continue with the next one.
            if ($table < \count(self::TABLES)) {
                $page['next'] = $cursor . '.' . $table . '.';
            }

            return $page;
        });
    }

    /**
     * Splits an `after` token `<cursor>.<table>.<last id>` (format checked by the query schema).
     * Null if it names no table.
     *
     * @return array{0: int, 1: int, 2: string|null}|null
     */
    public static function parseToken(string $after): ?array
    {
        $parts = explode('.', $after, 3);
        if (\count($parts) !== 3 || !ctype_digit($parts[0]) || !ctype_digit($parts[1])) {
            return null;
        }
        $table = (int) $parts[1];
        if ($table >= \count(self::TABLES)) {
            return null;
        }

        return [(int) $parts[0], $table, $parts[2] === '' ? null : $parts[2]];
    }

    /**
     * @param list<array<string, mixed>> $rows
     *
     * @return list<array<string, mixed>>
     */
    private static function map(string $table, array $rows): array
    {
        $mapper = match ($table) {
            'documents' => Mapping::toDocument(...),
            'tags' => Mapping::toTag(...),
            'document_tags' => Mapping::toDocumentTag(...),
            'attachments' => Mapping::toAttachment(...),
            'blocks' => Mapping::toBlock(...),
            default => Mapping::toConflict(...),
        };

        return array_map($mapper, $rows);
    }

    /**
     * Runs `$read` in a transaction of its own, so all its reads see the same state.
     *
     * @template T
     *
     * @param \Closure(): T $read
     *
     * @return T
     */
    private static function inTransaction(\PDO $db, \Closure $read): mixed
    {
        $db->beginTransaction();
        try {
            $result = $read();
            $db->commit();

            return $result;
        } catch (\Throwable $error) {
            $db->rollBack();

            throw $error;
        }
    }
}
