<?php

declare(strict_types=1);

namespace NotionAlt\Shared;

use NotionAlt\Validation\ObjectSchema;
use NotionAlt\Validation\V;

/** Port of `searchQuerySchema` from packages/shared/src/workspace.ts (query of `GET /api/search`). */
final class SearchSchemas
{
    public static function query(): ObjectSchema
    {
        return V::object([
            'workspaceId' => V::uuid(),
            'q' => V::string()->trim()->min(1)->max(200),
        ]);
    }
}
