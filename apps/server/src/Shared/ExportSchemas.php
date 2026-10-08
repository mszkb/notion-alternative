<?php

declare(strict_types=1);

namespace NotionAlt\Shared;

use NotionAlt\Validation\ObjectSchema;
use NotionAlt\Validation\RecordSchema;
use NotionAlt\Validation\V;

/**
 * Port of `jsonExportSchema` (packages/shared/src/export-json.ts), the entity schemas of
 * content.ts it uses, `changeSchema` (operations.ts) and `importInputSchema` (import.ts).
 */
final class ExportSchemas
{
    /** `EXPORT_SCHEMA_VERSION`; the server only accepts the current version (the client migrates). */
    public const SCHEMA_VERSION = 3;

    /** `importInputSchema` (`POST /api/import`). */
    public static function importInput(): ObjectSchema
    {
        return V::object(['name' => WorkspaceSchemas::name(), 'data' => self::jsonExport()]);
    }

    public static function jsonExport(): ObjectSchema
    {
        return V::object([
            'schema_version' => V::literal(self::SCHEMA_VERSION),
            'exported_at' => V::string(),
            'workspace' => V::object(['id' => V::uuid(), 'name' => V::string()]),
            'documents' => V::array(self::document()),
            'blocks' => V::array(self::block()),
            'tags' => V::array(self::tag()),
            'document_tags' => V::array(self::documentTag()),
            'links' => V::array(V::object([
                'blockId' => V::uuid(),
                'sourceDocumentId' => V::uuid(),
                'targetDocumentId' => V::uuid(),
            ])),
            'attachments' => V::array(self::attachment()),
            'history' => V::object([
                'compactedSeq' => V::int()->min(0),
                'changes' => V::array(self::change()),
            ])->nullable(),
        ]);
    }

    /** `changeSchema`. */
    public static function change(): ObjectSchema
    {
        return V::object([
            'seq' => V::int()->min(1),
            'opId' => V::uuid(),
            'deviceId' => V::uuid(),
            'entity' => V::enum(SyncSchemas::OPERATION_ENTITIES),
            'entityId' => V::uuid(),
            'kind' => V::enum(SyncSchemas::OPERATION_KINDS),
            'revision' => V::int()->min(1),
            'payload' => new RecordSchema(),
            'appliedAt' => V::string(),
        ]);
    }

    private static function document(): ObjectSchema
    {
        return V::object([
            'id' => V::uuid(),
            'workspaceId' => V::uuid(),
            'parentId' => V::uuid()->nullable(),
            'title' => V::string()->max(SyncSchemas::DOCUMENT_TITLE_MAX_LENGTH),
            'sortKey' => V::string()->min(1),
            'favorite' => V::boolean(),
            'icon' => SyncSchemas::documentIcon()->nullable()->optional(),
            'cover' => SyncSchemas::documentCover()->nullable()->optional(),
            'createdAt' => V::string(),
            'updatedAt' => V::string(),
            ...self::syncFields(),
        ]);
    }

    private static function block(): ObjectSchema
    {
        return V::object([
            'id' => V::uuid(),
            'documentId' => V::uuid(),
            'type' => V::enum(SyncSchemas::BLOCK_TYPES),
            'content' => V::string()->max(SyncSchemas::BLOCK_CONTENT_MAX_LENGTH),
            'attrs' => SyncSchemas::blockAttrs(),
            'sortKey' => V::string()->min(1),
            ...self::syncFields(),
        ]);
    }

    private static function tag(): ObjectSchema
    {
        return V::object([
            'id' => V::uuid(),
            'workspaceId' => V::uuid(),
            'name' => V::string()->trim()->min(1)->max(SyncSchemas::TAG_NAME_MAX_LENGTH),
            ...self::syncFields(),
        ]);
    }

    private static function documentTag(): ObjectSchema
    {
        return V::object([
            'id' => V::uuid(),
            'workspaceId' => V::uuid(),
            'documentId' => V::uuid(),
            'tagId' => V::uuid(),
            ...self::syncFields(),
        ]);
    }

    private static function attachment(): ObjectSchema
    {
        return V::object([
            'id' => V::uuid(),
            'workspaceId' => V::uuid(),
            'documentId' => V::uuid(),
            'name' => V::string()->trim()->min(1)->max(SyncSchemas::ATTACHMENT_NAME_MAX_LENGTH),
            'mimeType' => V::string()->max(100)->regex('/^[\w.+-]+\/[\w.+-]+$/D'),
            'size' => V::int()->min(0),
            'sha256' => V::string()->regex('/^[0-9a-f]{64}$/D'),
            'createdAt' => V::string(),
            ...self::syncFields(),
        ]);
    }

    /**
     * @return array<string, \NotionAlt\Validation\Schema>
     */
    private static function syncFields(): array
    {
        return ['revision' => V::int()->min(0)->nullable(), 'deletedAt' => V::string()->nullable()];
    }
}
