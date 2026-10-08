<?php

declare(strict_types=1);

namespace NotionAlt\Import;

use NotionAlt\Database\Sql;
use NotionAlt\Database\Transaction;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Search\SearchIndex;
use NotionAlt\Support\Ids;
use NotionAlt\Sync\Apply;

/**
 * Port of apps/server/src/import/import.ts: creates a new workspace from a JSON export (ADR 0004).
 *
 * @phpstan-type Entity array<string, mixed>
 * @phpstan-type ExportData array{documents: list<Entity>, blocks: list<Entity>, tags: list<Entity>, document_tags: list<Entity>, attachments: list<Entity>, history: array{compactedSeq: int, changes: list<Entity>}|null}
 */
final class Import
{
    /** SQLite allows a limited number of bound variables per statement. */
    private const CHUNK = 500;

    private const TABLES = ['documents', 'blocks', 'tags', 'document_tags', 'attachments'];

    /**
     * Imports in one transaction: entities with their ids and revisions, the history as change
     * log, search index. Existing data is never touched; if an id already exists the import is
     * refused (`409`) so the client can import a copy with new ids instead. The log is marked
     * compacted up to the imported history, so devices start with a snapshot rather than
     * replaying a history that may be incomplete.
     *
     * @param ExportData $data validated by `ExportSchemas::jsonExport()`
     *
     * @return array{id: string, name: string, owner_id: string, created_at: string, compacted_seq: int}
     */
    public static function workspace(\PDO $db, string $ownerId, string $name, array $data, ?int $quotaBytes): array
    {
        [$ids, $opIds] = self::checkReferences($data);
        $attachmentBytes = 0;
        foreach ($data['attachments'] as $attachment) {
            if ($attachment['deletedAt'] === null) {
                $attachmentBytes += self::int($attachment['size']);
            }
        }
        if ($quotaBytes !== null && Apply::accountAttachmentUsage($db, $ownerId)['usedBytes'] + $attachmentBytes > $quotaBytes) {
            throw new HttpError(413, 'storage_limit', 'Attachments exceed the storage limit');
        }

        return Transaction::run($db, static function () use ($db, $ownerId, $name, $data, $ids, $opIds): array {
            if (self::anyExists($db, $ids, $opIds)) {
                throw new HttpError(409, 'ids_exist', 'Some ids of the export already exist on this server');
            }
            $changes = $data['history']['changes'] ?? [];
            usort($changes, static fn(array $a, array $b): int => $a['seq'] <=> $b['seq']);
            $workspace = [
                'id' => Ids::uuid(),
                'name' => $name,
                'owner_id' => $ownerId,
                'created_at' => Ids::iso(Ids::nowMs()),
                // Never 0: a device pulling from cursor 0 must take a snapshot to see the import.
                'compacted_seq' => max(\count($changes), 1),
            ];
            Sql::run($db, 'insert into workspaces (id, name, owner_id, created_at, compacted_seq) values (?, ?, ?, ?, ?)', array_values($workspace));
            $ws = $workspace['id'];

            self::insert($db, 'documents', array_map(static fn(array $d): array => [
                'id' => $d['id'],
                'workspace_id' => $ws,
                'parent_id' => $d['parentId'],
                'title' => $d['title'],
                'sort_key' => $d['sortKey'],
                'favorite' => $d['favorite'] === true ? 1 : 0,
                'icon' => $d['icon'] ?? null,
                'cover' => $d['cover'] ?? null,
                'created_at' => $d['createdAt'],
                'updated_at' => $d['updatedAt'],
                'revision' => self::revision($d['revision']),
                'deleted_at' => $d['deletedAt'],
            ], $data['documents']));
            self::insert($db, 'blocks', array_map(static fn(array $b): array => [
                'id' => $b['id'],
                'workspace_id' => $ws,
                'document_id' => $b['documentId'],
                'type' => $b['type'],
                'content' => $b['content'],
                // Parsed attrs come back in schema order, like zod's output in the Node server.
                'attrs' => Json::encode((object) $b['attrs']),
                'sort_key' => $b['sortKey'],
                'revision' => self::revision($b['revision']),
                'deleted_at' => $b['deletedAt'],
            ], $data['blocks']));
            self::insert($db, 'tags', array_map(static fn(array $t): array => [
                'id' => $t['id'],
                'workspace_id' => $ws,
                'name' => $t['name'],
                'revision' => self::revision($t['revision']),
                'deleted_at' => $t['deletedAt'],
            ], $data['tags']));
            self::insert($db, 'document_tags', array_map(static fn(array $a): array => [
                'id' => $a['id'],
                'workspace_id' => $ws,
                'document_id' => $a['documentId'],
                'tag_id' => $a['tagId'],
                'revision' => self::revision($a['revision']),
                'deleted_at' => $a['deletedAt'],
            ], $data['document_tags']));
            self::insert($db, 'attachments', array_map(static fn(array $a): array => [
                'id' => $a['id'],
                'workspace_id' => $ws,
                'document_id' => $a['documentId'],
                'name' => $a['name'],
                'mime_type' => $a['mimeType'],
                'size' => $a['size'],
                'sha256' => $a['sha256'],
                'created_at' => $a['createdAt'],
                // The client uploads the contents afterwards; the hash is checked then.
                'stored_at' => null,
                'revision' => self::revision($a['revision']),
                'deleted_at' => $a['deletedAt'],
            ], $data['attachments']));
            $seq = 0;
            self::insert($db, 'changes', array_map(static function (array $change) use ($ws, &$seq): array {
                return [
                    'workspace_id' => $ws,
                    'seq' => ++$seq,
                    'op_id' => $change['opId'],
                    'device_id' => $change['deviceId'],
                    'entity' => $change['entity'],
                    'entity_id' => $change['entityId'],
                    'kind' => $change['kind'],
                    'revision' => $change['revision'],
                    'payload' => Json::encode($change['payload']),
                    'applied_at' => $change['appliedAt'],
                ];
            }, $changes));
            foreach ($data['documents'] as $document) {
                if ($document['deletedAt'] === null) {
                    SearchIndex::reindexDocument($db, self::str($document['id']));
                }
            }

            return $workspace;
        });
    }

    /**
     * References inside the export must point to entities of the export (no foreign ids).
     *
     * @param ExportData $data
     *
     * @return array{list<string>, list<string>} entity ids and operation ids
     */
    private static function checkReferences(array $data): array
    {
        $documents = array_flip(self::ids($data['documents']));
        $tags = array_flip(self::ids($data['tags']));
        $attachments = array_flip(self::ids($data['attachments']));
        $ids = [];
        foreach ([$data['documents'], $data['blocks'], $data['tags'], $data['document_tags'], $data['attachments']] as $list) {
            $ids = [...$ids, ...self::ids($list)];
        }
        if (\count(array_unique($ids)) !== \count($ids)) {
            self::invalid('Duplicate ids in the export');
        }
        /** @var array<string, ?string> $parents */
        $parents = [];
        foreach ($data['documents'] as $d) {
            $parents[self::str($d['id'])] = $d['parentId'] === null ? null : self::str($d['parentId']);
        }
        foreach ($data['documents'] as $d) {
            if ($d['parentId'] !== null && !isset($documents[self::str($d['parentId'])])) {
                self::invalid('Unknown parent of page ' . self::str($d['id']));
            }
        }
        // The page tree must be a tree: walking up from any page ends at the root.
        $rooted = [];
        foreach ($data['documents'] as $d) {
            $path = [];
            $current = self::str($d['id']);
            while ($current !== null && !isset($rooted[$current])) {
                if (isset($path[$current])) {
                    self::invalid("Cycle in the page tree at page {$current}");
                }
                $path[$current] = true;
                $current = $parents[$current] ?? null;
            }
            $rooted += $path;
        }
        foreach ($data['blocks'] as $b) {
            if (!isset($documents[self::str($b['documentId'])])) {
                self::invalid('Unknown page of block ' . self::str($b['id']));
            }
            $attrs = $b['attrs'];
            $attachmentId = \is_array($attrs) ? ($attrs['attachmentId'] ?? null) : null;
            if (\is_string($attachmentId) && $attachmentId !== '' && !isset($attachments[$attachmentId])) {
                self::invalid('Unknown attachment in block ' . self::str($b['id']));
            }
        }
        foreach ($data['document_tags'] as $a) {
            if (!isset($documents[self::str($a['documentId'])]) || !isset($tags[self::str($a['tagId'])])) {
                self::invalid('Unknown reference in ' . self::str($a['id']));
            }
        }
        foreach ($data['attachments'] as $a) {
            if (!isset($documents[self::str($a['documentId'])])) {
                self::invalid('Unknown page of attachment ' . self::str($a['id']));
            }
        }
        $opIds = array_map(static fn(array $c): string => self::str($c['opId']), $data['history']['changes'] ?? []);
        if (\count(array_unique($opIds)) !== \count($opIds)) {
            self::invalid('Duplicate operation ids in the history');
        }

        return [$ids, $opIds];
    }

    /**
     * @param list<array<string, mixed>> $list
     *
     * @return list<string>
     */
    private static function ids(array $list): array
    {
        return array_map(static fn(array $entity): string => self::str($entity['id']), $list);
    }

    /**
     * True if any of the ids already exists on this server (in any workspace).
     *
     * @param list<string> $ids
     * @param list<string> $opIds
     */
    private static function anyExists(\PDO $db, array $ids, array $opIds): bool
    {
        foreach (array_chunk($ids, self::CHUNK) as $part) {
            $marks = implode(', ', array_fill(0, \count($part), '?'));
            foreach (self::TABLES as $table) {
                if (Sql::rows($db, "select id from {$table} where id in ({$marks}) limit 1", $part) !== []) {
                    return true;
                }
            }
        }
        foreach (array_chunk($opIds, self::CHUNK) as $part) {
            $marks = implode(', ', array_fill(0, \count($part), '?'));
            if (Sql::rows($db, "select op_id from changes where op_id in ({$marks}) limit 1", $part) !== []) {
                return true;
            }
        }

        return false;
    }

    /**
     * Multi-row inserts in chunks (all rows of a table have the same columns).
     *
     * @param list<array<string, mixed>> $rows
     */
    private static function insert(\PDO $db, string $table, array $rows): void
    {
        if ($rows === []) {
            return;
        }
        $columns = array_keys($rows[0]);
        $perRow = '(' . implode(', ', array_fill(0, \count($columns), '?')) . ')';
        // Stay below SQLite's limit of bound variables per statement (32766).
        $size = max(1, intdiv(30000, \count($columns)));
        foreach (array_chunk($rows, min($size, self::CHUNK)) as $part) {
            $params = [];
            foreach ($part as $row) {
                foreach ($row as $value) {
                    $params[] = $value;
                }
            }
            Sql::run(
                $db,
                "insert into {$table} (" . implode(', ', $columns) . ') values ' . implode(', ', array_fill(0, \count($part), $perRow)),
                $params,
            );
        }
    }

    /** Entities that were never synced in the source have no revision yet. */
    private static function revision(mixed $value): int
    {
        return $value === null ? 1 : self::int($value);
    }

    private static function invalid(string $reason): never
    {
        throw new HttpError(400, 'invalid_import', $reason);
    }

    private static function str(mixed $value): string
    {
        return \is_string($value) ? $value : throw new \LogicException('Expected a string');
    }

    private static function int(mixed $value): int
    {
        return \is_int($value) ? $value : throw new \LogicException('Expected an int');
    }
}
