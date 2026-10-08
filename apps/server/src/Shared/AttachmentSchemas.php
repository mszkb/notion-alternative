<?php

declare(strict_types=1);

namespace NotionAlt\Shared;

use NotionAlt\Validation\ObjectSchema;
use NotionAlt\Validation\V;

/** Inputs of the attachment routes and `INLINE_IMAGE_TYPES` of packages/shared/src/content.ts. */
final class AttachmentSchemas
{
    /** Raster images that may be shown inline; everything else is only offered as download. */
    public const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

    public static function params(): ObjectSchema
    {
        return V::object(['id' => V::uuid()]);
    }

    public static function usageQuery(): ObjectSchema
    {
        return V::object(['workspaceId' => V::uuid()]);
    }
}
