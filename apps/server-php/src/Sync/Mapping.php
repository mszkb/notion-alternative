<?php

declare(strict_types=1);

namespace NotionAlt\Sync;

use NotionAlt\Database\Row;

/**
 * Port of apps/server/src/sync/mapping.ts: the single place where DB rows (snake_case) become
 * API objects (camelCase, ADR 0009). JSON columns are decoded with objects as `stdClass`, so
 * `{}` encodes back as `{}`.
 */
final class Mapping
{
    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    public static function toDocument(array $row): array
    {
        $icon = Row::nullableString($row, 'icon');
        $cover = Row::nullableString($row, 'cover');

        return [
            'id' => Row::string($row, 'id'),
            'workspaceId' => Row::string($row, 'workspace_id'),
            'parentId' => Row::nullableString($row, 'parent_id'),
            'title' => Row::string($row, 'title'),
            'sortKey' => Row::string($row, 'sort_key'),
            'favorite' => Row::int($row, 'favorite') === 1,
            // Only when set (#136): pages without them look like before export schema version 3.
            ...($icon !== null && $icon !== '' ? ['icon' => $icon] : []),
            ...($cover !== null && $cover !== '' ? ['cover' => $cover] : []),
            'createdAt' => Row::string($row, 'created_at'),
            'updatedAt' => Row::string($row, 'updated_at'),
            'revision' => Row::int($row, 'revision'),
            'deletedAt' => Row::nullableString($row, 'deleted_at'),
        ];
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    public static function toBlock(array $row): array
    {
        return [
            'id' => Row::string($row, 'id'),
            'documentId' => Row::string($row, 'document_id'),
            'type' => Row::string($row, 'type'),
            'content' => Row::string($row, 'content'),
            'attrs' => self::json(Row::string($row, 'attrs')),
            'sortKey' => Row::string($row, 'sort_key'),
            'revision' => Row::int($row, 'revision'),
            'deletedAt' => Row::nullableString($row, 'deleted_at'),
        ];
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    public static function toTag(array $row): array
    {
        return [
            'id' => Row::string($row, 'id'),
            'workspaceId' => Row::string($row, 'workspace_id'),
            'name' => Row::string($row, 'name'),
            'revision' => Row::int($row, 'revision'),
            'deletedAt' => Row::nullableString($row, 'deleted_at'),
        ];
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    public static function toDocumentTag(array $row): array
    {
        return [
            'id' => Row::string($row, 'id'),
            'workspaceId' => Row::string($row, 'workspace_id'),
            'documentId' => Row::string($row, 'document_id'),
            'tagId' => Row::string($row, 'tag_id'),
            'revision' => Row::int($row, 'revision'),
            'deletedAt' => Row::nullableString($row, 'deleted_at'),
        ];
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    public static function toChange(array $row): array
    {
        return [
            'seq' => Row::int($row, 'seq'),
            'opId' => Row::string($row, 'op_id'),
            'deviceId' => Row::string($row, 'device_id'),
            'entity' => Row::string($row, 'entity'),
            'entityId' => Row::string($row, 'entity_id'),
            'kind' => Row::string($row, 'kind'),
            'revision' => Row::int($row, 'revision'),
            'payload' => self::json(Row::string($row, 'payload')),
            'appliedAt' => Row::string($row, 'applied_at'),
        ];
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    public static function toConflict(array $row): array
    {
        $remote = Row::nullableString($row, 'remote');
        $baseRevision = Row::nullableString($row, 'base_revision');

        return [
            'id' => Row::string($row, 'id'),
            'workspaceId' => Row::string($row, 'workspace_id'),
            'entity' => Row::string($row, 'entity'),
            'entityId' => Row::string($row, 'entity_id'),
            'documentId' => Row::nullableString($row, 'document_id'),
            'reason' => Row::string($row, 'reason'),
            'baseRevision' => $baseRevision === null ? null : (int) $baseRevision,
            'local' => self::json(Row::string($row, 'local')),
            'remote' => $remote === null ? null : self::json($remote),
            'createdAt' => Row::string($row, 'created_at'),
            'resolvedAt' => Row::nullableString($row, 'resolved_at'),
            'resolution' => Row::nullableString($row, 'resolution'),
            'revision' => Row::int($row, 'revision'),
            'deletedAt' => Row::nullableString($row, 'deleted_at'),
        ];
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    public static function toAttachment(array $row): array
    {
        return [
            'id' => Row::string($row, 'id'),
            'workspaceId' => Row::string($row, 'workspace_id'),
            'documentId' => Row::string($row, 'document_id'),
            'name' => Row::string($row, 'name'),
            'mimeType' => Row::string($row, 'mime_type'),
            'size' => Row::int($row, 'size'),
            'sha256' => Row::string($row, 'sha256'),
            'createdAt' => Row::string($row, 'created_at'),
            'revision' => Row::int($row, 'revision'),
            'deletedAt' => Row::nullableString($row, 'deleted_at'),
        ];
    }

    /** `JSON.parse` with objects as `stdClass`. */
    public static function json(string $json): mixed
    {
        return json_decode($json, false, 512, JSON_THROW_ON_ERROR);
    }
}
