<?php

declare(strict_types=1);

namespace NotionAlt\Sync;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Database\Transaction;
use NotionAlt\Devices\Devices;
use NotionAlt\Http\Json;
use NotionAlt\Search\SearchIndex;
use NotionAlt\Shared\SyncSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Workspaces\Workspaces;

/**
 * Applies client operations (ADR 0002) with block merge and conflict objects (ADR 0003).
 * Results (`ApplyResult`):
 * `applied`/`merged`/`duplicate` with `revision` and `seq`, `conflict` with `currentRevision`,
 * `reason` and `conflictId`, `rejected` with `code` and `message`.
 *
 * @phpstan-type ApplyResult array<string, int|string>
 */
final class Apply
{
    private const ENTITY_TABLES = [
        'document' => 'documents',
        'block' => 'blocks',
        'tag' => 'tags',
        'document_tag' => 'document_tags',
        'attachment' => 'attachments',
    ];

    /** Set when the operation was merged with another device's change to other fields. */
    private bool $merged = false;

    private function __construct(
        private readonly \PDO $db,
        private readonly AttachmentLimits $limits,
        private readonly string $now,
    ) {}

    /**
     * Applies one client operation in its own transaction, idempotent by `opId`.
     *
     * @return ApplyResult
     */
    public static function operation(\PDO $db, string $userId, Operation $op, ?string $now = null, ?AttachmentLimits $limits = null): array
    {
        $now ??= Ids::iso(Ids::nowMs());
        $limits ??= AttachmentLimits::none();
        try {
            return Transaction::run($db, static fn(): array => (new self($db, $limits, $now))->applyIn($userId, $op));
        } catch (Stop $stop) {
            return $stop->result;
        }
    }

    /**
     * Applies a push batch in order, in one SQLite transaction with a savepoint per operation
     * (#95): one commit per batch instead of per operation. A rejected operation only rolls back
     * its savepoint. An unexpected error commits what was applied before it and is rethrown, as
     * with one transaction per operation (T-OFF-05); a crash before the commit loses the whole
     * unconfirmed batch, which the client resends idempotently (T-OFF-07).
     *
     * @param list<Operation> $operations
     *
     * @return list<ApplyResult>
     */
    public static function batch(\PDO $db, string $userId, array $operations, ?string $now = null, ?AttachmentLimits $limits = null): array
    {
        $now ??= Ids::iso(Ids::nowMs());
        $limits ??= AttachmentLimits::none();
        $failure = null;
        $results = Transaction::run($db, static function () use ($db, $userId, $operations, $now, $limits, &$failure): array {
            $applied = [];
            foreach ($operations as $op) {
                $db->exec('savepoint op');
                try {
                    $applied[] = (new self($db, $limits, $now))->applyIn($userId, $op);
                    $db->exec('release op');
                } catch (\Throwable $error) {
                    try {
                        $db->exec('rollback to op');
                        $db->exec('release op');
                    } catch (\Throwable) {
                        // SQLite already rolled back the whole transaction (e.g. disk full).
                        throw $error;
                    }
                    if (!$error instanceof Stop) {
                        $failure = $error;
                        break;
                    }
                    $applied[] = $error->result;
                }
            }

            return $applied;
        });
        if ($failure !== null) {
            throw $failure;
        }

        return $results;
    }

    /**
     * Attachment storage of the account owning `$workspaceId` (all its workspaces, #74): active
     * attachments plus deleted ones whose file is still kept for the retention period.
     *
     * @return array{usedBytes: int, count: int}
     */
    public static function attachmentUsage(\PDO $db, string $workspaceId): array
    {
        return self::usage($db, '(select owner_id from workspaces where id = ?)', $workspaceId);
    }

    /**
     * Attachment storage of an account (all its workspaces), see {@see self::attachmentUsage()}.
     *
     * @return array{usedBytes: int, count: int}
     */
    public static function accountAttachmentUsage(\PDO $db, string $ownerId): array
    {
        return self::usage($db, '?', $ownerId);
    }

    /**
     * @return array{usedBytes: int, count: int}
     */
    private static function usage(\PDO $db, string $owner, string $param): array
    {
        $rows = Sql::rows(
            $db,
            "select sum(attachments.size) as bytes,
                sum(case when attachments.deleted_at is null then 1 else 0 end) as count
             from attachments inner join workspaces on workspaces.id = attachments.workspace_id
             where workspaces.owner_id = {$owner}
               and (attachments.deleted_at is null or attachments.stored_at is not null)",
            [$param],
        );
        $row = $rows[0] ?? [];

        return [
            'usedBytes' => ($row['bytes'] ?? null) === null ? 0 : Row::int($row, 'bytes'),
            'count' => ($row['count'] ?? null) === null ? 0 : Row::int($row, 'count'),
        ];
    }

    /**
     * @return ApplyResult
     */
    private function applyIn(string $userId, Operation $op): array
    {
        $db = $this->db;
        $member = Workspaces::findWithRole($db, $op->workspaceId, $userId);
        if ($member === null) {
            self::reject('workspace_not_found', 'Workspace not found');
        }
        if (Devices::findActive($db, $userId, $op->deviceId) === null) {
            self::reject('device_not_active', 'Device is not registered or was removed');
        }
        $previous = self::first($db, 'select workspace_id, entity, entity_id, seq, revision from changes where op_id = ?', [$op->opId]);
        if ($previous !== null) {
            $same = $previous['workspace_id'] === $op->workspaceId
                && $previous['entity'] === $op->entity
                && $previous['entity_id'] === $op->entityId;
            if (!$same) {
                self::reject('op_id_reused', 'Operation id was used for another change');
            }

            return ['status' => 'duplicate', 'revision' => Row::int($previous, 'revision'), 'seq' => Row::int($previous, 'seq')];
        }
        // Resending an operation that became a conflict returns that conflict again.
        $known = self::first($db, 'select id, reason, entity_id, workspace_id from conflicts where op_id = ?', [$op->opId]);
        if ($known !== null) {
            if ($known['workspace_id'] !== $op->workspaceId || $known['entity_id'] !== $op->entityId) {
                self::reject('op_id_reused', 'Operation id was used for another change');
            }
            $remote = $this->remoteState($op);
            $revision = $remote['revision'] ?? 1;

            return [
                'status' => 'conflict',
                'currentRevision' => \is_int($revision) ? $revision : 1,
                'reason' => Row::string($known, 'reason'),
                'conflictId' => Row::string($known, 'id'),
            ];
        }
        // After the duplicate checks: an operation applied before the role was lowered is still
        // acknowledged, so the device can drop it from its queue (ADR 0014).
        if (!Workspaces::atLeast($member['role'], 'editor')) {
            self::reject('forbidden', 'Your role in this workspace does not allow changes');
        }
        if ($op->entity === 'conflict' && $op->kind !== 'update') {
            self::reject('invalid_payload', 'Conflicts are created by the server and can only be resolved');
        }
        $invalid = SyncSchemas::validatePayload($op->entity, $op->kind, $op->payload);
        if ($invalid !== null) {
            self::reject('invalid_payload', $invalid);
        }

        try {
            $revision = match ($op->entity) {
                'document' => $this->applyDocument($op),
                'block' => $this->applyBlock($op),
                'tag' => $this->applyTag($op),
                'document_tag' => $this->applyDocumentTag($op),
                'attachment' => $this->applyAttachment($op),
                'conflict' => $this->applyConflict($op),
                default => self::reject('invalid_payload', 'Unknown entity'),
            };
        } catch (ConflictFound $found) {
            return $this->recordConflict($op, $found);
        }
        $indexed = $this->indexedDocument($op);
        if ($indexed !== null) {
            SearchIndex::markForReindex($db, $indexed);
        }
        $seq = $this->nextSeq($op->workspaceId);
        $this->insertChange($op->workspaceId, $seq, $op->opId, $op->deviceId, $op->entity, $op->entityId, $op->kind, $revision, Json::encode($op->payload));

        return ['status' => $this->merged ? 'merged' : 'applied', 'revision' => $revision, 'seq' => $seq];
    }

    /** Fields an operation changes; `*` for create/delete (they touch everything). */
    /**
     * @param array<string, mixed> $payload
     *
     * @return list<string>
     */
    private static function touchedFields(string $kind, array $payload): array
    {
        return $kind === 'update' || $kind === 'move' ? array_map('strval', array_keys($payload)) : ['*'];
    }

    /**
     * Change-log entry that deleted the entity, if any.
     *
     * @return array<string, mixed>|null
     */
    private function deletion(Operation $op): ?array
    {
        return self::first(
            $this->db,
            "select seq, device_id, revision from changes
             where workspace_id = ? and entity = ? and entity_id = ? and kind = 'delete'
             order by seq desc limit 1",
            [$op->workspaceId, $op->entity, $op->entityId],
        );
    }

    /**
     * Fields other devices changed on the entity after `$baseRevision` (empty: none). Changes of
     * the operation's own device do not count: its queued operations build on each other.
     *
     * @return array<string, true>
     */
    private function fieldsChangedByOthers(Operation $op, int $baseRevision): array
    {
        $rows = Sql::rows(
            $this->db,
            'select kind, payload from changes
             where workspace_id = ? and entity = ? and entity_id = ? and revision > ? and device_id != ?',
            [$op->workspaceId, $op->entity, $op->entityId, $baseRevision, $op->deviceId],
        );
        $fields = [];
        foreach ($rows as $row) {
            $payload = json_decode(Row::string($row, 'payload'), true, 512, JSON_THROW_ON_ERROR);
            /** @var array<string, mixed> $payload */
            $payload = \is_array($payload) ? $payload : [];
            foreach (self::touchedFields(Row::string($row, 'kind'), $payload) as $field) {
                $fields[$field] = true;
            }
        }

        return $fields;
    }

    /**
     * Checks an operation against the stored entity and returns the revision it will get.
     * Entities of other workspaces are reported as missing, never revealed.
     *
     * @param array<string, mixed>|null $existing
     */
    private function nextRevision(Operation $op, ?array $existing): int
    {
        if ($existing !== null && $existing['workspace_id'] !== $op->workspaceId) {
            self::reject('not_found', 'Entity not found');
        }
        if ($op->kind === 'create') {
            if ($existing !== null) {
                self::reject('already_exists', 'Entity already exists');
            }
            if ($op->baseRevision !== null) {
                self::reject('invalid_payload', 'create has no base revision');
            }

            return 1;
        }
        if ($existing === null) {
            self::reject('not_found', 'Entity not found');
        }
        $current = Row::int($existing, 'revision');
        $deletedAt = Row::nullableString($existing, 'deleted_at');
        if ($op->kind === 'restore') {
            if ($deletedAt !== null) {
                return $current + 1;
            }
            // Already restored (e.g. by another device): same outcome.
            $last = self::first(
                $this->db,
                'select seq from changes where workspace_id = ? and entity = ? and entity_id = ? order by seq desc',
                [$op->workspaceId, $op->entity, $op->entityId],
            ) ?? throw new \LogicException('no change for an existing entity');

            throw new Stop(['status' => 'duplicate', 'revision' => $current, 'seq' => Row::int($last, 'seq')]);
        }
        if ($deletedAt !== null) {
            $deleted = $this->deletion($op);
            // Deleting again has the same effect: answer like the original deletion.
            if ($op->kind === 'delete' && $deleted !== null) {
                throw new Stop(['status' => 'duplicate', 'revision' => $current, 'seq' => Row::int($deleted, 'seq')]);
            }
            // Edited on this device while another one deleted it (T-DEL-02): visible, never lost.
            if ($deleted !== null && $deleted['device_id'] !== $op->deviceId) {
                throw new ConflictFound($current, 'deleted');
            }
            self::reject('deleted', 'Entity is deleted');
        }
        $base = $op->baseRevision ?? 0;
        if ($base > $current) {
            self::reject('invalid_payload', 'Base revision is ahead of the server');
        }
        if ($base < $current) {
            $theirs = $this->fieldsChangedByOthers($op, $base);
            if ($theirs !== []) {
                // Merge rule (ADR 0003): disjoint fields of the same entity merge. The same field,
                // or a create or delete on either side, is a conflict.
                $overlap = isset($theirs['*']);
                foreach (self::touchedFields($op->kind, $op->fields()) as $field) {
                    if ($field === '*' || isset($theirs[$field])) {
                        $overlap = true;
                    }
                }
                if ($overlap) {
                    throw new ConflictFound($current, 'changed');
                }
                $this->merged = true;
            }
        }

        return $current + 1;
    }

    /**
     * @return array<string, mixed>
     */
    private function requireDocumentIn(string $workspaceId, string $id, string $what): array
    {
        $document = self::first(
            $this->db,
            'select id, parent_id, revision, deleted_at from documents where id = ? and workspace_id = ?',
            [$id, $workspaceId],
        );

        return $document ?? self::reject('not_found', "{$what} not found");
    }

    /** A page must not become its own ancestor; also stops on an existing cycle. */
    private function assertNoCycle(string $workspaceId, string $id, ?string $parentId): void
    {
        $seen = [];
        $current = $parentId;
        while ($current !== null && $current !== '') {
            if ($current === $id) {
                self::reject('invalid_payload', 'A page cannot be moved below itself');
            }
            if (isset($seen[$current])) {
                self::reject('invalid_payload', 'The page tree contains a cycle');
            }
            $seen[$current] = true;
            $current = Row::nullableString($this->requireDocumentIn($workspaceId, $current, 'Parent'), 'parent_id');
        }
    }

    /** A cover image must be an attachment of the same workspace (#136). */
    private function assertCoverInWorkspace(string $workspaceId, mixed $cover): void
    {
        if (!\is_string($cover) || !str_starts_with($cover, 'attachment:')) {
            return;
        }
        $attachment = self::first(
            $this->db,
            'select id from attachments where id = ? and workspace_id = ?',
            [substr($cover, \strlen('attachment:')), $workspaceId],
        );
        if ($attachment === null) {
            self::reject('invalid_payload', 'Cover attachment not found in this workspace');
        }
    }

    private function applyDocument(Operation $op): int
    {
        $db = $this->db;
        $now = $this->now;
        $existing = self::first($db, 'select * from documents where id = ?', [$op->entityId]);
        $revision = $this->nextRevision($op, $existing);
        switch ($op->kind) {
            case 'create':
                $parentId = self::nullableStr($op->field('parentId'));
                $this->assertNoCycle($op->workspaceId, $op->entityId, $parentId);
                $this->assertCoverInWorkspace($op->workspaceId, $op->field('cover'));
                Sql::run(
                    $db,
                    'insert into documents (id, workspace_id, parent_id, title, sort_key, favorite, icon, cover, created_at, updated_at, revision, deleted_at)
                     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)',
                    [
                        $op->entityId, $op->workspaceId, $parentId, self::str($op->field('title')),
                        self::str($op->field('sortKey')), $op->field('favorite') === true ? 1 : 0,
                        self::nullableStr($op->field('icon')), self::nullableStr($op->field('cover')),
                        self::str($op->field('createdAt')), $now, $revision,
                    ],
                );
                break;
            case 'update':
                $this->assertCoverInWorkspace($op->workspaceId, $op->field('cover'));
                $sets = [];
                $params = [];
                if ($op->has('title')) {
                    $sets[] = 'title = ?';
                    $params[] = self::str($op->field('title'));
                }
                if ($op->has('favorite')) {
                    $sets[] = 'favorite = ?';
                    $params[] = $op->field('favorite') === true ? 1 : 0;
                }
                // null removes the icon or cover (#136).
                foreach (['icon', 'cover'] as $field) {
                    if ($op->has($field)) {
                        $sets[] = "{$field} = ?";
                        $params[] = self::nullableStr($op->field($field));
                    }
                }
                $sets[] = 'updated_at = ?';
                $sets[] = 'revision = ?';
                Sql::run($db, 'update documents set ' . implode(', ', $sets) . ' where id = ?', [...$params, $now, $revision, $op->entityId]);
                break;
            case 'move':
                $parentId = self::nullableStr($op->field('parentId'));
                $this->assertNoCycle($op->workspaceId, $op->entityId, $parentId);
                Sql::run(
                    $db,
                    'update documents set parent_id = ?, sort_key = ?, updated_at = ?, revision = ? where id = ?',
                    [$parentId, self::str($op->field('sortKey')), $now, $revision, $op->entityId],
                );
                break;
            case 'delete':
                Sql::run($db, 'update documents set deleted_at = ?, updated_at = ?, revision = ? where id = ?', [$now, $now, $revision, $op->entityId]);
                break;
            case 'restore':
                // Lifts the tombstone (trash, #66). Blocks, tags and links of a deleted page were
                // never tombstoned (sync.md), so the page comes back complete under its old id.
                Sql::run($db, 'update documents set deleted_at = null, updated_at = ?, revision = ? where id = ?', [$now, $revision, $op->entityId]);
                break;
        }

        return $revision;
    }

    /**
     * Content of a page that another device deleted must not vanish into the tombstone: changes
     * to its blocks or tags become a conflict (T-DEL-02). Deleting them along is fine.
     */
    private function assertDocumentAlive(Operation $op, string $documentId): void
    {
        if ($op->kind === 'delete') {
            return;
        }
        $document = $this->requireDocumentIn($op->workspaceId, $documentId, 'Document');
        if (Row::nullableString($document, 'deleted_at') !== null) {
            throw new ConflictFound(Row::int($document, 'revision'), 'parent_deleted');
        }
    }

    private function applyBlock(Operation $op): int
    {
        $db = $this->db;
        $existing = self::first($db, 'select * from blocks where id = ?', [$op->entityId]);
        if ($existing !== null && $existing['workspace_id'] === $op->workspaceId) {
            $this->assertDocumentAlive($op, Row::string($existing, 'document_id'));
        }
        $revision = $this->nextRevision($op, $existing);
        switch ($op->kind) {
            case 'create':
                $documentId = self::str($op->field('documentId'));
                $this->assertDocumentAlive($op, $documentId);
                Sql::run(
                    $db,
                    'insert into blocks (id, workspace_id, document_id, type, content, attrs, sort_key, revision, deleted_at)
                     values (?, ?, ?, ?, ?, ?, ?, ?, null)',
                    [
                        $op->entityId, $op->workspaceId, $documentId, self::str($op->field('type')),
                        self::str($op->field('content')), Json::encode($op->field('attrs')),
                        self::str($op->field('sortKey')), $revision,
                    ],
                );
                break;
            case 'update':
                $sets = [];
                $params = [];
                if ($op->has('type')) {
                    $sets[] = 'type = ?';
                    $params[] = self::str($op->field('type'));
                }
                if ($op->has('content')) {
                    $sets[] = 'content = ?';
                    $params[] = self::str($op->field('content'));
                }
                if ($op->has('attrs')) {
                    $sets[] = 'attrs = ?';
                    $params[] = Json::encode($op->field('attrs'));
                }
                $sets[] = 'revision = ?';
                Sql::run($db, 'update blocks set ' . implode(', ', $sets) . ' where id = ?', [...$params, $revision, $op->entityId]);
                break;
            case 'move':
                Sql::run($db, 'update blocks set sort_key = ?, revision = ? where id = ?', [self::str($op->field('sortKey')), $revision, $op->entityId]);
                break;
            case 'delete':
                Sql::run($db, 'update blocks set deleted_at = ?, revision = ? where id = ?', [$this->now, $revision, $op->entityId]);
                break;
            default:
                // Not allowed by the payload schemas; blocks come back with their page.
                self::reject('invalid_payload', 'Blocks cannot be restored');
        }

        return $revision;
    }

    private function applyTag(Operation $op): int
    {
        $db = $this->db;
        $existing = self::first($db, 'select * from tags where id = ?', [$op->entityId]);
        $revision = $this->nextRevision($op, $existing);
        if ($op->kind === 'create') {
            Sql::run(
                $db,
                'insert into tags (id, workspace_id, name, revision, deleted_at) values (?, ?, ?, ?, null)',
                [$op->entityId, $op->workspaceId, self::str($op->field('name')), $revision],
            );
        } elseif ($op->kind === 'update') {
            Sql::run($db, 'update tags set name = ?, revision = ? where id = ?', [self::str($op->field('name')), $revision, $op->entityId]);
        } else {
            Sql::run($db, 'update tags set deleted_at = ?, revision = ? where id = ?', [$this->now, $revision, $op->entityId]);
        }

        return $revision;
    }

    private function applyDocumentTag(Operation $op): int
    {
        $db = $this->db;
        $existing = self::first($db, 'select * from document_tags where id = ?', [$op->entityId]);
        $revision = $this->nextRevision($op, $existing);
        if ($op->kind === 'create') {
            $documentId = self::str($op->field('documentId'));
            $tagId = self::str($op->field('tagId'));
            $this->assertDocumentAlive($op, $documentId);
            if (self::first($db, 'select id from tags where id = ? and workspace_id = ?', [$tagId, $op->workspaceId]) === null) {
                self::reject('not_found', 'Tag not found');
            }
            Sql::run(
                $db,
                'insert into document_tags (id, workspace_id, document_id, tag_id, revision, deleted_at) values (?, ?, ?, ?, ?, null)',
                [$op->entityId, $op->workspaceId, $documentId, $tagId, $revision],
            );
        } else {
            Sql::run($db, 'update document_tags set deleted_at = ?, revision = ? where id = ?', [$this->now, $revision, $op->entityId]);
        }

        return $revision;
    }

    /** Attachment metadata (ADR 0012); the content is uploaded separately and never changes. */
    private function applyAttachment(Operation $op): int
    {
        $db = $this->db;
        $existing = self::first($db, 'select * from attachments where id = ?', [$op->entityId]);
        if ($existing !== null && $existing['workspace_id'] === $op->workspaceId) {
            $this->assertDocumentAlive($op, Row::string($existing, 'document_id'));
        }
        $revision = $this->nextRevision($op, $existing);
        if ($op->kind === 'create') {
            $documentId = self::str($op->field('documentId'));
            $this->assertDocumentAlive($op, $documentId);
            $size = $op->field('size');
            $size = \is_int($size) ? $size : (int) (\is_float($size) ? $size : 0);
            // Rejected, not dropped: the client keeps the file and shows why (#64).
            if ($this->limits->maxBytes !== null && $size > $this->limits->maxBytes) {
                self::reject('too_large', "File exceeds {$this->limits->maxBytes} bytes");
            }
            $quota = $this->limits->workspaceQuotaBytes;
            if ($quota !== null && self::attachmentUsage($db, $op->workspaceId)['usedBytes'] + $size > $quota) {
                self::reject('quota_exceeded', 'Workspace storage limit reached');
            }
            Sql::run(
                $db,
                'insert into attachments (id, workspace_id, document_id, name, mime_type, size, sha256, created_at, stored_at, revision, deleted_at)
                 values (?, ?, ?, ?, ?, ?, ?, ?, null, ?, null)',
                [
                    $op->entityId, $op->workspaceId, $documentId, self::str($op->field('name')),
                    self::str($op->field('mimeType')), $size, self::str($op->field('sha256')),
                    self::str($op->field('createdAt')), $revision,
                ],
            );
        } else {
            // Tombstone; the file is removed after the retention period.
            Sql::run($db, 'update attachments set deleted_at = ?, revision = ? where id = ?', [$this->now, $revision, $op->entityId]);
        }

        return $revision;
    }

    /** Resolving a conflict (the only conflict operation clients send). */
    private function applyConflict(Operation $op): int
    {
        $db = $this->db;
        $existing = self::first($db, 'select * from conflicts where id = ? and workspace_id = ?', [$op->entityId, $op->workspaceId])
            ?? self::reject('not_found', 'Conflict not found');
        if (Row::nullableString($existing, 'resolved_at') !== null) {
            // Another device resolved it first: same outcome for this one (no conflict on a conflict).
            $resolved = self::first(
                $db,
                "select seq from changes where entity = 'conflict' and entity_id = ? and kind = 'update' order by seq desc",
                [$op->entityId],
            ) ?? throw new \LogicException('resolved conflict without change');

            throw new Stop(['status' => 'duplicate', 'revision' => Row::int($existing, 'revision'), 'seq' => Row::int($resolved, 'seq')]);
        }
        $revision = Row::int($existing, 'revision') + 1;
        Sql::run(
            $db,
            'update conflicts set resolved_at = ?, resolution = ?, revision = ? where id = ?',
            [$this->now, self::str($op->field('resolution')), $revision, $op->entityId],
        );

        return $revision;
    }

    /**
     * Current server state of the entity, as the "remote" side of a conflict.
     *
     * @return array<string, mixed>|null
     */
    private function remoteState(Operation $op): ?array
    {
        $table = self::ENTITY_TABLES[$op->entity] ?? null;
        if ($table === null) {
            return null;
        }
        $row = self::first($this->db, "select * from {$table} where id = ?", [$op->entityId]);
        if ($row === null) {
            return null;
        }

        return match ($op->entity) {
            'document' => Mapping::toDocument($row),
            'block' => Mapping::toBlock($row),
            'tag' => Mapping::toTag($row),
            'document_tag' => Mapping::toDocumentTag($row),
            default => Mapping::toAttachment($row),
        };
    }

    /** Page a conflicting operation belongs to (for display). */
    private function conflictDocument(Operation $op): ?string
    {
        if ($op->entity === 'document') {
            return $op->entityId;
        }
        $documentId = $op->field('documentId');
        if (\is_string($documentId)) {
            return $documentId;
        }
        $table = ['block' => 'blocks', 'document_tag' => 'document_tags', 'attachment' => 'attachments'][$op->entity] ?? null;
        if ($table === null) {
            return null;
        }
        $row = self::first($this->db, "select document_id from {$table} where id = ?", [$op->entityId]);

        return $row === null ? null : Row::nullableString($row, 'document_id');
    }

    /**
     * Stores both versions as a conflict object and logs it like any other entity change.
     *
     * @return ApplyResult
     */
    private function recordConflict(Operation $op, ConflictFound $found): array
    {
        $id = Ids::uuid();
        $now = $this->now;
        $local = ['kind' => $op->kind, 'payload' => $op->payload, 'deviceId' => $op->deviceId, 'opId' => $op->opId];
        $remote = $this->remoteState($op);
        $documentId = $this->conflictDocument($op);
        $payload = [
            'entity' => $op->entity,
            'entityId' => $op->entityId,
            'documentId' => $documentId,
            'reason' => $found->reason,
            'baseRevision' => $op->baseRevision,
            'local' => $local,
            'remote' => $remote,
            'createdAt' => $now,
            'resolvedAt' => null,
            'resolution' => null,
        ];
        Sql::run(
            $this->db,
            'insert into conflicts (id, workspace_id, op_id, entity, entity_id, document_id, reason, base_revision, local, remote,
                created_at, resolved_at, resolution, revision, deleted_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, 1, null)',
            [
                $id, $op->workspaceId, $op->opId, $op->entity, $op->entityId, $documentId, $found->reason,
                $op->baseRevision, Json::encode($local), $remote === null ? null : Json::encode($remote), $now,
            ],
        );
        $this->insertChange($op->workspaceId, $this->nextSeq($op->workspaceId), Ids::uuid(), $op->deviceId, 'conflict', $id, 'create', 1, Json::encode($payload));

        return [
            'status' => 'conflict',
            'currentRevision' => $found->currentRevision,
            'reason' => $found->reason,
            'conflictId' => $id,
        ];
    }

    /** Page whose search entry the operation changes (documents and their blocks). */
    private function indexedDocument(Operation $op): ?string
    {
        if ($op->entity === 'document') {
            return $op->entityId;
        }
        if ($op->entity !== 'block') {
            return null;
        }
        $block = self::first($this->db, 'select document_id from blocks where id = ?', [$op->entityId]);

        return $block === null ? null : Row::string($block, 'document_id');
    }

    private function nextSeq(string $workspaceId): int
    {
        $max = self::first($this->db, 'select max(seq) as max from changes where workspace_id = ?', [$workspaceId]);
        $floor = self::first($this->db, 'select compacted_seq from workspaces where id = ?', [$workspaceId])
            ?? throw new \LogicException('workspace vanished');
        // After compaction the log may be empty; numbering continues above the removed part.
        $last = $max === null || $max['max'] === null ? 0 : Row::int($max, 'max');

        return max($last, Row::int($floor, 'compacted_seq')) + 1;
    }

    private function insertChange(
        string $workspaceId,
        int $seq,
        string $opId,
        string $deviceId,
        string $entity,
        string $entityId,
        string $kind,
        int $revision,
        string $payload,
    ): void {
        Sql::run(
            $this->db,
            'insert into changes (workspace_id, seq, op_id, device_id, entity, entity_id, kind, revision, payload, applied_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$workspaceId, $seq, $opId, $deviceId, $entity, $entityId, $kind, $revision, $payload, $this->now],
        );
    }

    private static function reject(string $code, string $message): never
    {
        throw new Stop(['status' => 'rejected', 'code' => $code, 'message' => $message]);
    }

    /**
     * @param list<mixed> $params
     *
     * @return array<string, mixed>|null
     */
    private static function first(\PDO $db, string $sql, array $params): ?array
    {
        return Sql::rows($db, $sql, $params)[0] ?? null;
    }

    private static function str(mixed $value): string
    {
        return \is_string($value) ? $value : throw new \LogicException('validated payload field is not a string');
    }

    private static function nullableStr(mixed $value): ?string
    {
        return $value === null ? null : self::str($value);
    }
}
