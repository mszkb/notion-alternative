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

    public const OPERATION_ENTITIES = ['document', 'block', 'tag', 'document_tag', 'attachment', 'conflict'];
    public const OPERATION_KINDS = ['create', 'update', 'move', 'delete', 'restore'];
    public const BLOCK_TYPES = ['paragraph', 'heading', 'list_item', 'quote', 'code', 'image', 'file'];

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
                'createdAt' => V::string()->max(40),
            ])->strict(),
            'document.update' => V::object([
                'title' => self::title()->optional(),
                'favorite' => V::boolean()->optional(),
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

    private static function sortKey(): StringSchema
    {
        return V::string()->min(1)->max(200);
    }

    private static function blockContent(): StringSchema
    {
        return V::string()->max(self::BLOCK_CONTENT_MAX_LENGTH);
    }

    /** `blockAttrsSchema`. */
    private static function blockAttrs(): ObjectSchema
    {
        return V::object([
            'level' => V::int()->min(1)->max(3)->optional(),
            'list' => V::enum(['bullet', 'ordered'])->optional(),
            'indent' => V::int()->min(0)->max(self::MAX_LIST_INDENT)->optional(),
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
