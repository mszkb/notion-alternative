<?php

declare(strict_types=1);

namespace NotionAlt\Push;

use OpenSSLAsymmetricKey;

/**
 * One content-free push hint as HTTP request (RFC 8030/8291/8292), without sending it, and the
 * allowlist check of endpoints.
 */
final class PushRequest
{
    public const TTL_SECONDS = 24 * 60 * 60;

    /**
     * @param array<string, string> $headers
     */
    private function __construct(
        public readonly string $url,
        public readonly array $headers,
        public readonly string $body,
    ) {}

    /**
     * Builds the POST to the subscription endpoint. The payload is only the hint
     * `{"type":"sync_available","installation","workspace"}`, never content (sync invariant).
     *
     * @param int|null $now Unix time in seconds for the VAPID JWT
     * @param OpenSSLAsymmetricKey|null $serverKey fixed ephemeral key, for tests only
     * @param string|null $salt fixed salt, for tests only
     *
     * @throws \InvalidArgumentException for unusable subscription keys (the caller counts a failure)
     */
    public static function syncAvailable(
        string $endpoint,
        string $p256dh,
        string $auth,
        string $installation,
        string $workspace,
        VapidKeys $keys,
        string $subject,
        ?int $now = null,
        ?OpenSSLAsymmetricKey $serverKey = null,
        ?string $salt = null,
    ): self {
        $hint = json_encode(
            ['type' => 'sync_available', 'installation' => $installation, 'workspace' => $workspace],
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );

        return new self($endpoint, [
            'Authorization' => Vapid::authorization($endpoint, $keys, $subject, $now),
            'Content-Encoding' => 'aes128gcm',
            'Content-Type' => 'application/octet-stream',
            'TTL' => (string) self::TTL_SECONDS,
            'Urgency' => 'normal',
            // One pending hint per workspace is enough; newer ones replace older ones.
            'Topic' => substr(str_replace('-', '', $workspace), 0, 32),
        ], WebPushCrypto::encrypt($hint, $p256dh, $auth, $serverKey, $salt));
    }

    /**
     * Only https endpoints of known push services (the URL comes from the client: no SSRF).
     *
     * @param list<string> $allowedHosts host names; `*.` allows subdomains
     */
    public static function isAllowedEndpoint(string $endpoint, array $allowedHosts): bool
    {
        $parts = parse_url($endpoint);
        if (
            $parts === false || strtolower($parts['scheme'] ?? '') !== 'https'
            || isset($parts['user']) || isset($parts['pass']) || !isset($parts['host'])
        ) {
            return false;
        }
        $host = strtolower($parts['host']);
        foreach ($allowedHosts as $allowed) {
            if (str_starts_with($allowed, '*.') ? str_ends_with($host, substr($allowed, 1)) : $host === $allowed) {
                return true;
            }
        }

        return false;
    }

    /** `404`/`410`: the subscription is gone and gets deleted. */
    public static function isGone(int $status): bool
    {
        return $status === 404 || $status === 410;
    }
}
