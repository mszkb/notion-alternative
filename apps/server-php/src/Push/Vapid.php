<?php

declare(strict_types=1);

namespace NotionAlt\Push;

/** VAPID authentication (RFC 8292): ES256 JWT for the push service origin, valid 12 h. */
final class Vapid
{
    public const VALIDITY_SECONDS = 12 * 60 * 60;

    /**
     * `Authorization` header value: `vapid t=<jwt>, k=<public key>`.
     *
     * @param int|null $now Unix time in seconds; current time if null
     */
    public static function authorization(string $endpoint, VapidKeys $keys, string $subject, ?int $now = null): string
    {
        $header = Base64Url::encode(self::json(['typ' => 'JWT', 'alg' => 'ES256']));
        $claims = Base64Url::encode(self::json([
            'aud' => self::origin($endpoint),
            'exp' => ($now ?? time()) + self::VALIDITY_SECONDS,
            'sub' => $subject,
        ]));
        $input = "{$header}.{$claims}";
        if (!openssl_sign($input, $der, $keys->privateKey(), OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('VAPID signing failed');
        }
        \assert(\is_string($der));
        // JWS wants the raw `r || s` form (like Node's dsaEncoding: 'ieee-p1363').
        $signature = Base64Url::encode(P256::derToRaw($der));

        return "vapid t={$input}.{$signature}, k={$keys->publicKey}";
    }

    /** Like `new URL(url).origin` for http(s): lowercase host, default port omitted. */
    public static function origin(string $url): string
    {
        $parts = parse_url($url);
        if ($parts === false) {
            throw new \InvalidArgumentException('Not an http(s) URL');
        }
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (($scheme !== 'https' && $scheme !== 'http') || $host === '') {
            throw new \InvalidArgumentException('Not an http(s) URL');
        }
        $port = $parts['port'] ?? null;
        $default = $scheme === 'https' ? 443 : 80;

        return "{$scheme}://{$host}" . ($port !== null && $port !== $default ? ":{$port}" : '');
    }

    /** @param array<string, mixed> $value */
    private static function json(array $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
