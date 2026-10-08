<?php

declare(strict_types=1);

namespace NotionAlt\Http;

use Psr\Http\Message\ServerRequestInterface;

/**
 * Client address for rate limits: exactly one proxy hop is trusted, and only if the connection
 * comes from a private or loopback address. The client is then the last entry
 * of `X-Forwarded-For`; earlier entries are client-controlled and ignored.
 */
final class ClientIp
{
    public static function of(ServerRequestInterface $request): string
    {
        $remote = $request->getServerParams()['REMOTE_ADDR'] ?? '';

        return self::resolve(\is_string($remote) ? $remote : '', $request->getHeaderLine('X-Forwarded-For'));
    }

    public static function resolve(string $remoteAddress, string $forwardedFor): string
    {
        if ($forwardedFor === '' || !self::isPrivateAddress($remoteAddress)) {
            return $remoteAddress;
        }
        $hops = explode(',', $forwardedFor);
        $last = trim($hops[\count($hops) - 1], " \t");

        return $last === '' ? $remoteAddress : $last;
    }

    /** Loopback, 10/8, 172.16/12, 192.168/16, fc00::/7 (also IPv4-mapped). */
    public static function isPrivateAddress(string $address): bool
    {
        $ip = (string) preg_replace('/^::ffff:/i', '', $address);
        if ($ip === '::1' || preg_match('/^f[cd][0-9a-f]{2}:/i', $ip) === 1) {
            return true;
        }
        $parts = explode('.', $ip);
        if (\count($parts) !== 4) {
            return false;
        }
        $numbers = [];
        foreach ($parts as $part) {
            // Decimal octets only.
            if (preg_match('/^\d{1,3}$/', $part) !== 1 || (int) $part > 255) {
                return false;
            }
            $numbers[] = (int) $part;
        }
        [$a, $b] = $numbers;

        return $a === 127 || $a === 10 || ($a === 172 && $b >= 16 && $b <= 31) || ($a === 192 && $b === 168);
    }
}
