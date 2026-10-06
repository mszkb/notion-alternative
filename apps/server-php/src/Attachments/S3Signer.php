<?php

declare(strict_types=1);

namespace NotionAlt\Attachments;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use NotionAlt\Config\S3Config;

/**
 * AWS Signature Version 4 (header-based) and S3 object URLs, without HTTP: port of the pure
 * parts of `apps/server/src/attachments/s3.ts` (no SDK, ADR 0007; S3-compatible stores, #63).
 */
final class S3Signer
{
    /** SHA-256 of an empty payload. */
    public const EMPTY_PAYLOAD_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    public static function sha256Hex(string $data): string
    {
        return hash('sha256', $data);
    }

    /**
     * Returns the headers to send, including `authorization` (all names lowercase). `host` is
     * signed but not returned: the HTTP client sets it from the URL.
     *
     * @param array<string, string> $headers headers to sign besides host, x-amz-date and x-amz-content-sha256
     *
     * @return array<string, string>
     */
    public static function signV4(
        string $method,
        string $url,
        array $headers,
        string $payloadHash,
        string $accessKeyId,
        #[\SensitiveParameter]
        string $secretAccessKey,
        string $region,
        string $service = 's3',
        ?DateTimeInterface $date = null,
    ): array {
        $parts = parse_url($url);
        if ($parts === false || !isset($parts['host'])) {
            throw new \InvalidArgumentException('Invalid S3 URL');
        }
        $amzDate = DateTimeImmutable::createFromInterface($date ?? new DateTimeImmutable())
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Ymd\THis\Z');
        $day = substr($amzDate, 0, 8);

        $signed = [];
        foreach ($headers as $name => $value) {
            $signed[strtolower($name)] = trim($value);
        }
        $signed['host'] = self::host($parts);
        $signed['x-amz-content-sha256'] = $payloadHash;
        $signed['x-amz-date'] = $amzDate;
        ksort($signed, SORT_STRING);
        $names = implode(';', array_keys($signed));

        $canonicalHeaders = '';
        foreach ($signed as $name => $value) {
            $canonicalHeaders .= "{$name}:{$value}\n";
        }
        $canonical = implode("\n", [
            $method,
            self::canonicalPath($parts['path'] ?? '/'),
            self::canonicalQuery($parts['query'] ?? ''),
            $canonicalHeaders,
            $names,
            $payloadHash,
        ]);
        $scope = "{$day}/{$region}/{$service}/aws4_request";
        $stringToSign = implode("\n", ['AWS4-HMAC-SHA256', $amzDate, $scope, self::sha256Hex($canonical)]);
        $key = hash_hmac('sha256', 'aws4_request', hash_hmac(
            'sha256',
            $service,
            hash_hmac('sha256', $region, hash_hmac('sha256', $day, "AWS4{$secretAccessKey}", true), true),
            true,
        ), true);
        $signature = hash_hmac('sha256', $stringToSign, $key);

        unset($signed['host']);
        $signed['authorization'] = "AWS4-HMAC-SHA256 Credential={$accessKeyId}/{$scope}, "
            . "SignedHeaders={$names}, Signature={$signature}";

        return $signed;
    }

    /** `https://bucket.host/key`, or `https://host/bucket/key` with `forcePathStyle` (MinIO, Garage). */
    public static function objectUrl(S3Config $config, string $key = ''): string
    {
        $base = parse_url($config->endpoint);
        if ($base === false || !isset($base['scheme'], $base['host'])) {
            throw new \InvalidArgumentException('Invalid S3 endpoint');
        }
        $scheme = strtolower($base['scheme']);
        $host = self::host($base);
        $path = implode('/', array_map(self::encodeSegment(...), explode('/', $key)));
        if ($config->forcePathStyle) {
            return "{$scheme}://{$host}/" . self::encodeSegment($config->bucket) . ($key !== '' ? "/{$path}" : '');
        }

        return "{$scheme}://{$config->bucket}.{$host}/{$path}";
    }

    /**
     * URL and signed headers for one S3 request (`PUT` with body, `GET`, `DELETE`; `PUT` on the
     * empty key creates the bucket).
     *
     * @return array{url: string, headers: array<string, string>}
     */
    public static function request(
        S3Config $config,
        string $method,
        string $key,
        ?string $body = null,
        ?DateTimeInterface $date = null,
    ): array {
        $url = self::objectUrl($config, $key);

        return [
            'url' => $url,
            'headers' => self::signV4(
                $method,
                $url,
                $body !== null ? ['content-type' => 'application/octet-stream'] : [],
                $body !== null ? self::sha256Hex($body) : self::EMPTY_PAYLOAD_HASH,
                $config->accessKeyId,
                $config->secretAccessKey,
                $config->region,
                date: $date,
            ),
        ];
    }

    /** RFC 3986 encoding of one path segment, as SigV4 requires (also `!'()*`). */
    public static function encodeSegment(string $segment): string
    {
        return rawurlencode($segment);
    }

    /**
     * Like `URL#host`: lowercase host name, port only if not the scheme's default.
     *
     * @param array{scheme?: string, host?: string, port?: int} $parts
     */
    private static function host(array $parts): string
    {
        $host = strtolower($parts['host'] ?? '');
        $port = $parts['port'] ?? null;
        $default = match (strtolower($parts['scheme'] ?? '')) {
            'https' => 443,
            'http' => 80,
            default => null,
        };

        return $port !== null && $port !== $default ? "{$host}:{$port}" : $host;
    }

    private static function canonicalPath(string $path): string
    {
        return implode('/', array_map(
            static fn(string $segment): string => self::encodeSegment(rawurldecode($segment)),
            explode('/', $path),
        ));
    }

    /** Query parameters as `URLSearchParams` reads them, re-encoded and sorted by name. */
    private static function canonicalQuery(string $query): string
    {
        $pairs = [];
        foreach (explode('&', $query) as $pair) {
            if ($pair === '') {
                continue;
            }
            [$name, $value] = array_pad(explode('=', $pair, 2), 2, '');
            $pairs[] = [self::encodeSegment(urldecode($name)), self::encodeSegment(urldecode($value))];
        }
        usort($pairs, static fn(array $a, array $b): int => strcmp($a[0], $b[0]));

        return implode('&', array_map(static fn(array $pair): string => "{$pair[0]}={$pair[1]}", $pairs));
    }
}
