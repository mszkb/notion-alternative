<?php

declare(strict_types=1);

namespace NotionAlt\Support;

/** Ids and timestamps in the formats of the Node server. */
final class Ids
{
    /** Like `crypto.randomUUID()`: random UUID v4, lowercase. */
    public static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = \chr((\ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = \chr((\ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);

        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-'
            . substr($hex, 16, 4) . '-' . substr($hex, 20);
    }

    /** Current time in milliseconds (`Date.now()`). */
    public static function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    /** Like `new Date(ms).toISOString()`, e.g. `2026-10-06T19:32:18.142Z`. */
    public static function iso(int $ms): string
    {
        $seconds = intdiv($ms, 1000);
        $millis = $ms % 1000;
        if ($millis < 0) {
            $seconds--;
            $millis += 1000;
        }

        return gmdate('Y-m-d\TH:i:s', $seconds) . \sprintf('.%03dZ', $millis);
    }

    /** Like `randomBytes(n).toString('base64url')` (no padding). */
    public static function base64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
