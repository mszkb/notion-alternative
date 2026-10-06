<?php

declare(strict_types=1);

namespace NotionAlt\Shared;

use NotionAlt\Validation\ObjectSchema;
use NotionAlt\Validation\StringSchema;
use NotionAlt\Validation\V;

/** Port of packages/shared/src/device.ts (input schemas). */
final class DeviceSchemas
{
    public const NAME_MAX_LENGTH = 100;

    public static function name(): StringSchema
    {
        return V::string()->trim()->min(1)->max(self::NAME_MAX_LENGTH);
    }

    /** Registration is idempotent: the client sends its stable device id on every start. */
    public static function registerInput(): ObjectSchema
    {
        return V::object(['id' => V::uuid(), 'name' => self::name()]);
    }

    public static function renameInput(): ObjectSchema
    {
        return V::object(['name' => self::name()]);
    }

    /** Route parameters of `/api/devices/:id` (apps/server/src/devices/routes.ts). */
    public static function params(): ObjectSchema
    {
        return V::object(['id' => V::uuid()]);
    }
}
