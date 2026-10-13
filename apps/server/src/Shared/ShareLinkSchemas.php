<?php

declare(strict_types=1);

namespace NotionAlt\Shared;

use NotionAlt\Validation\ObjectSchema;
use NotionAlt\Validation\StringSchema;
use NotionAlt\Validation\V;

/** Port of the read-link schemas in packages/shared/src/workspace.ts (ADR 0022). */
final class ShareLinkSchemas
{
    /** Longest validity the server accepts (days); `expiresAt: null` means no expiry. */
    public const MAX_VALID_DAYS = 3650;

    public static function createInput(): ObjectSchema
    {
        return V::object([
            'documentId' => V::uuid(),
            // ISO 8601 with time zone, e.g. `2026-11-09T12:00:00.000Z`; must lie in the future.
            'expiresAt' => V::string()->max(40)->regex('/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,9})?)?(Z|[+-]\\d{2}:\\d{2})$/D')->nullable(),
        ]);
    }

    public static function listQuery(): ObjectSchema
    {
        return V::object(['documentId' => V::uuid()->optional()]);
    }

    /** Route parameters of `/api/workspaces/:id/share-links/:linkId`. */
    public static function linkParams(): ObjectSchema
    {
        return V::object(['id' => V::uuid(), 'linkId' => V::uuid()]);
    }

    /** 32 random bytes as base64url (43 characters). */
    public static function token(): StringSchema
    {
        return V::string()->regex('/^[A-Za-z0-9_-]{43}$/D');
    }
}
