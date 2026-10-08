<?php

declare(strict_types=1);

namespace NotionAlt\Push;

/** Unpadded base64url (RFC 4648 §5). */
final class Base64Url
{
    public static function encode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    /** Lenient like `Buffer.from(s, 'base64url')`: padding is optional, invalid characters are skipped. */
    public static function decode(string $data): string
    {
        return (string) base64_decode(strtr($data, '-_', '+/'), false);
    }
}
