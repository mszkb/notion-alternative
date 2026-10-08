<?php

declare(strict_types=1);

namespace NotionAlt\Shared;

use NotionAlt\Validation\ObjectSchema;
use NotionAlt\Validation\StringSchema;
use NotionAlt\Validation\V;

/** Port of packages/shared/src/workspace.ts (input schemas). */
final class WorkspaceSchemas
{
    public static function name(): StringSchema
    {
        return V::string()->trim()->min(1)->max(100);
    }

    public static function createInput(): ObjectSchema
    {
        return V::object(['name' => self::name()]);
    }

    /** Route parameters of `/api/workspaces/:id`. */
    public static function params(): ObjectSchema
    {
        return V::object(['id' => V::uuid()]);
    }
}
