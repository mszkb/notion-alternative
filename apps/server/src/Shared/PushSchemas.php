<?php

declare(strict_types=1);

namespace NotionAlt\Shared;

use NotionAlt\Validation\ObjectSchema;
use NotionAlt\Validation\V;

/** Port of packages/shared/src/push.ts (input schemas). */
final class PushSchemas
{
    public static function subscriptionInput(): ObjectSchema
    {
        return V::object([
            'endpoint' => V::string()->url()->max(2000),
            'keys' => V::object([
                // Base64url (RFC 8291): an uncompressed P-256 point (65 bytes, first byte 0x04 → "B")
                // and a 16-byte auth secret. Anything else could not be encrypted for later.
                'p256dh' => V::string()->regex('/^B[A-Za-z0-9_-]{86}=?$/D', 'expected a P-256 public key'),
                'auth' => V::string()->regex('/^[A-Za-z0-9_-]{22}(==)?$/D', 'expected a 16-byte secret'),
            ]),
        ]);
    }

    public static function unsubscribeInput(): ObjectSchema
    {
        return V::object(['endpoint' => V::string()->url()->max(2000)]);
    }
}
