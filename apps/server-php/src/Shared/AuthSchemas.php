<?php

declare(strict_types=1);

namespace NotionAlt\Shared;

use NotionAlt\Validation\ObjectSchema;
use NotionAlt\Validation\StringSchema;
use NotionAlt\Validation\V;

/** Port of packages/shared/src/auth.ts. */
final class AuthSchemas
{
    public const PASSWORD_MIN_LENGTH = 10;

    public const PASSWORD_MAX_LENGTH = 256;

    public static function email(): StringSchema
    {
        return V::string()->trim()->toLowerCase()->email()->max(254);
    }

    public static function password(): StringSchema
    {
        return V::string()->min(self::PASSWORD_MIN_LENGTH)->max(self::PASSWORD_MAX_LENGTH);
    }

    public static function registerInput(): ObjectSchema
    {
        return V::object([
            'email' => self::email(),
            'password' => self::password(),
        ]);
    }

    public static function loginInput(): ObjectSchema
    {
        return V::object([
            'email' => self::email(),
            // Do not enforce the length policy on login: it would leak the policy for existing accounts.
            'password' => V::string()->min(1)->max(self::PASSWORD_MAX_LENGTH),
        ]);
    }

    public static function changePasswordInput(): ObjectSchema
    {
        return V::object([
            'currentPassword' => V::string()->min(1)->max(self::PASSWORD_MAX_LENGTH),
            'newPassword' => self::password(),
        ]);
    }

    public static function logoutInput(): ObjectSchema
    {
        return V::object([
            // Also remove this device from the account (shared computers).
            'removeDevice' => V::boolean()->optional(),
        ]);
    }
}
