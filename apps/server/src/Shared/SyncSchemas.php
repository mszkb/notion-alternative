<?php

declare(strict_types=1);

namespace NotionAlt\Shared;

use NotionAlt\Validation\Issue;
use NotionAlt\Validation\ObjectSchema;
use NotionAlt\Validation\RecordSchema;
use NotionAlt\Validation\Schema;
use NotionAlt\Validation\StringSchema;
use NotionAlt\Validation\V;

/**
 * Port of the sync schemas in packages/shared/src/content.ts and operations.ts: the push input
 * and the payload of each operation (entity × kind).
 */
final class SyncSchemas
{
    public const DOCUMENT_TITLE_MAX_LENGTH = 500;
    public const BLOCK_CONTENT_MAX_LENGTH = 100_000;
    public const TAG_NAME_MAX_LENGTH = 50;
    public const MAX_LIST_INDENT = 5;
    public const ATTACHMENT_NAME_MAX_LENGTH = 255;
    public const SYNC_PUSH_MAX_OPERATIONS = 500;
    public const SYNC_PULL_MAX_LIMIT = 1000;
    /** Largest page of a paged snapshot (#97). */
    public const SNAPSHOT_PAGE_MAX = 5000;
    /** Most pages per `POST /api/sync/documents` (ADR 0017). */
    public const SYNC_DOCUMENTS_MAX = 100;
    /** Built-in cover gradients (#136); the colours live in the web app's stylesheet. */
    public const COVER_GRADIENTS = ['sunrise', 'ocean', 'forest', 'dusk', 'sand', 'slate'];

    public const OPERATION_ENTITIES = ['document', 'block', 'tag', 'document_tag', 'attachment', 'conflict'];
    public const OPERATION_KINDS = ['create', 'update', 'move', 'delete', 'restore'];
    public const BLOCK_TYPES = ['paragraph', 'heading', 'list_item', 'quote', 'code', 'image', 'file', 'todo', 'toggle', 'callout', 'divider'];

    /** `operationSchema`: one local change, transferred idempotently by `opId` (ADR 0002). */
    public static function operation(): ObjectSchema
    {
        return V::object([
            'opId' => V::uuid(),
            'deviceId' => V::uuid(),
            'workspaceId' => V::uuid(),
            'entity' => V::enum(self::OPERATION_ENTITIES),
            'entityId' => V::uuid(),
            'kind' => V::enum(self::OPERATION_KINDS),
            'baseRevision' => V::int()->min(0)->nullable(),
            'payload' => new RecordSchema(),
            'createdAt' => V::string(),
        ]);
    }

    /** `syncPushInputSchema`. */
    public static function pushInput(): ObjectSchema
    {
        return V::object([
            'operations' => V::array(self::operation())->min(1)->max(self::SYNC_PUSH_MAX_OPERATIONS),
        ]);
    }

    /** `syncPullQuerySchema` (`GET /api/sync/pull`); `syncLogQuerySchema` has the same shape. */
    public static function pullQuery(): ObjectSchema
    {
        return V::object([
            'workspaceId' => V::uuid(),
            'cursor' => V::coerce(V::int()->min(0))->default(0),
            'limit' => V::coerce(V::int()->min(1)->max(self::SYNC_PULL_MAX_LIMIT))->default(self::SYNC_PULL_MAX_LIMIT),
        ]);
    }

    /** `syncLogQuerySchema` (`GET /api/sync/log`). */
    public static function logQuery(): ObjectSchema
    {
        return self::pullQuery();
    }

    /** `syncSnapshotQuerySchema` (`GET /api/sync/snapshot`). */
    public static function snapshotQuery(): ObjectSchema
    {
        return V::object([
            'workspaceId' => V::uuid(),
            'limit' => V::coerce(V::int()->min(1)->max(self::SNAPSHOT_PAGE_MAX))->optional(),
            // `<cursor>.<table>.<last id>`, opaque to the client.
            'after' => V::string()->regex('/^\d+\.\d\.[0-9A-Fa-f-]{0,64}$/D')->optional(),
            // `false`: everything except blocks; page contents load on demand (ADR 0017).
            'content' => V::enum(['true', 'false'])->optional(),
        ]);
    }

    /** `syncDocumentQuerySchema` (`GET /api/sync/documents/:id`). */
    public static function documentQuery(): ObjectSchema
    {
        return V::object(['workspaceId' => V::uuid()]);
    }

    /** `syncDocumentParamsSchema`. */
    public static function documentParams(): ObjectSchema
    {
        return V::object(['id' => V::uuid()]);
    }

    /** `syncDocumentsInputSchema` (`POST /api/sync/documents`). */
    public static function documentsInput(): ObjectSchema
    {
        return V::object([
            'workspaceId' => V::uuid(),
            'ids' => V::array(V::uuid())->min(1)->max(self::SYNC_DOCUMENTS_MAX),
        ]);
    }

    /** `validateOperationPayload`: an error message, or null if the payload is valid. */
    public static function validatePayload(string $entity, string $kind, mixed $payload): ?string
    {
        $schema = self::payloadSchema($entity, $kind);
        if ($schema === null) {
            return "{$kind} is not supported for {$entity}";
        }
        $result = $schema->safeParse($payload);
        $issues = $result->issues;
        // `.refine((value) => Object.keys(value).length > 0, 'empty update')`
        if ($issues === [] && $kind === 'update' && ($entity === 'document' || $entity === 'block') && $result->data === []) {
            $issues[] = new Issue([], 'custom', 'empty update');
        }
        if ($issues === []) {
            return null;
        }

        return implode('; ', array_map(
            static fn(Issue $issue): string => ($issue->path === [] ? 'payload' : implode('.', $issue->path)) . ': ' . $issue->message,
            $issues,
        ));
    }

    private static function payloadSchema(string $entity, string $kind): ?Schema
    {
        return match ($entity . '.' . $kind) {
            'document.create' => V::object([
                'parentId' => V::uuid()->nullable(),
                'title' => self::title(),
                'sortKey' => self::sortKey(),
                'favorite' => V::boolean(),
                'icon' => self::documentIcon()->nullable()->optional(),
                'cover' => self::documentCover()->nullable()->optional(),
                'createdAt' => V::string()->max(40),
            ])->strict(),
            'document.update' => V::object([
                'title' => self::title()->optional(),
                'favorite' => V::boolean()->optional(),
                // null removes the icon or cover (#136).
                'icon' => self::documentIcon()->nullable()->optional(),
                'cover' => self::documentCover()->nullable()->optional(),
            ])->strict(),
            'document.move' => V::object([
                'parentId' => V::uuid()->nullable(),
                'sortKey' => self::sortKey(),
            ])->strict(),
            'document.delete', 'document.restore', 'block.delete', 'tag.delete', 'document_tag.delete', 'attachment.delete' => V::object([])->strict(),
            'block.create' => V::object([
                'documentId' => V::uuid(),
                'type' => V::enum(self::BLOCK_TYPES),
                'content' => self::blockContent(),
                'attrs' => self::blockAttrs(),
                'sortKey' => self::sortKey(),
            ])->strict(),
            'block.update' => V::object([
                'type' => V::enum(self::BLOCK_TYPES)->optional(),
                'content' => self::blockContent()->optional(),
                'attrs' => self::blockAttrs()->optional(),
            ])->strict(),
            'block.move' => V::object(['sortKey' => self::sortKey()])->strict(),
            'tag.create', 'tag.update' => V::object([
                'name' => V::string()->trim()->min(1)->max(self::TAG_NAME_MAX_LENGTH),
            ])->strict(),
            'document_tag.create' => V::object(['documentId' => V::uuid(), 'tagId' => V::uuid()])->strict(),
            'attachment.create' => V::object([
                'documentId' => V::uuid(),
                'name' => V::string()->trim()->min(1)->max(self::ATTACHMENT_NAME_MAX_LENGTH),
                'mimeType' => V::string()->max(100)->regex('/^[\w.+-]+\/[\w.+-]+$/D'),
                'size' => V::int()->min(0),
                'sha256' => V::string()->regex('/^[0-9a-f]{64}$/D'),
                'createdAt' => V::string(),
            ])->strict(),
            'conflict.create' => self::conflictCreate(),
            'conflict.update' => V::object(['resolution' => V::enum(['local', 'remote', 'manual'])])->strict(),
            default => null,
        };
    }

    private static function title(): StringSchema
    {
        return V::string()->max(self::DOCUMENT_TITLE_MAX_LENGTH);
    }

    /** `documentIconSchema` (#136): an emoji, stored as text. */
    public static function documentIcon(): StringSchema
    {
        return V::string()->min(1)->max(16);
    }

    /** `documentCoverSchema` (#136): `gradient:<name>` or `attachment:<uuid>`. */
    public static function documentCover(): StringSchema
    {
        return V::string()->regex(
            '/^(gradient:(' . implode('|', self::COVER_GRADIENTS) . ')|attachment:' . StringSchema::UUID_PATTERN . ')$/D',
        );
    }

    private static function sortKey(): StringSchema
    {
        return V::string()->min(1)->max(200);
    }

    private static function blockContent(): StringSchema
    {
        return V::string()->max(self::BLOCK_CONTENT_MAX_LENGTH);
    }

    /** `blockAttrsSchema`. */
    public static function blockAttrs(): ObjectSchema
    {
        return V::object([
            'level' => V::int()->min(1)->max(3)->optional(),
            'list' => V::enum(['bullet', 'ordered'])->optional(),
            'indent' => V::int()->min(0)->max(self::MAX_LIST_INDENT)->optional(),
            // ADR 0019: done (`todo`), emoji shown before the text (`callout`).
            'checked' => V::boolean()->optional(),
            'icon' => V::string()->min(1)->max(16)->optional(),
            'language' => V::string()->max(40)->optional(),
            'attachmentId' => V::uuid()->optional(),
        ])->strict();
    }

    /** Written by the server only; the push rejects it before validation (kept for parity). */
    private static function conflictCreate(): ObjectSchema
    {
        return V::object([
            'entity' => V::enum(['document', 'block', 'tag', 'document_tag', 'attachment']),
            'entityId' => V::uuid(),
            'documentId' => V::uuid()->nullable(),
            'reason' => V::enum(['changed', 'deleted', 'parent_deleted']),
            'baseRevision' => V::int()->min(0)->nullable(),
            'local' => V::object([
                'kind' => V::enum(self::OPERATION_KINDS),
                'payload' => new RecordSchema(),
                'deviceId' => V::uuid(),
                'opId' => V::uuid(),
            ]),
            'remote' => (new RecordSchema())->nullable(),
            'createdAt' => V::string(),
            'resolvedAt' => V::string()->nullable(),
            'resolution' => V::enum(['local', 'remote', 'manual'])->nullable(),
        ])->strict();
    }
}
