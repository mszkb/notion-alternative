<?php

declare(strict_types=1);

namespace NotionAlt\Attachments;

use NotionAlt\Config\S3Config;
use Psr\Http\Message\StreamInterface;
use Slim\Psr7\Stream;

/**
 * Minimal S3 client without SDK (ADR 0007, #63): signed requests
 * with {@see S3Signer}, sent with ext-curl. No redirects, 60 s timeout.
 */
final class S3Client
{
    /**
     * @param null|\Closure(string, string, array<string, string>, ?string, resource): int $transport
     *                                                                                                  sends method, URL, headers and body, writes the response body to the resource and
     *                                                                                                  returns the status (tests replace curl with it)
     */
    public function __construct(
        private readonly S3Config $config,
        private readonly ?\Closure $transport = null,
    ) {}

    public function createBucket(): void
    {
        $status = $this->send('PUT', '', null)[0];
        // 409: exists already (owned by us) – fine.
        if (!self::ok($status) && $status !== 409) {
            throw new S3Error($status, 'create bucket');
        }
    }

    public function put(string $key, string $body): void
    {
        $status = $this->send('PUT', $key, $body)[0];
        if (!self::ok($status)) {
            throw new S3Error($status, 'put');
        }
    }

    /** The object, or null if it does not exist. */
    public function get(string $key): ?StreamInterface
    {
        [$status, $body] = $this->send('GET', $key, null);
        if ($status === 404) {
            return null;
        }
        if (!self::ok($status)) {
            throw new S3Error($status, 'get');
        }
        rewind($body);

        return new Stream($body);
    }

    public function delete(string $key): void
    {
        $status = $this->send('DELETE', $key, null)[0];
        if (!self::ok($status) && $status !== 404) {
            throw new S3Error($status, 'delete');
        }
    }

    private static function ok(int $status): bool
    {
        return $status >= 200 && $status < 300;
    }

    /**
     * @param non-empty-string $method
     *
     * @return array{int, resource} status and response body (a temp stream)
     */
    private function send(string $method, string $key, ?string $body): array
    {
        $request = S3Signer::request($this->config, $method, $key, $body);
        $sink = fopen('php://temp', 'w+b');
        if ($sink === false) {
            throw new \RuntimeException('Cannot open temp stream');
        }
        $status = ($this->transport ?? self::curl(...))($method, $request['url'], $request['headers'], $body, $sink);

        return [$status, $sink];
    }

    /**
     * @param non-empty-string      $method
     * @param array<string, string> $headers
     * @param resource              $sink
     */
    private static function curl(string $method, string $url, array $headers, ?string $body, $sink): int
    {
        if (!\function_exists('curl_init')) {
            throw new \RuntimeException('ATTACHMENT_STORAGE=s3 needs the PHP extension curl');
        }
        $lines = [];
        foreach ($headers as $name => $value) {
            $lines[] = "{$name}: {$value}";
        }
        // No `Expect: 100-continue` round trip; not every S3-compatible store handles it.
        $lines[] = 'Expect:';
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_FILE => $sink,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        ]);
        if ($body !== null) {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        } elseif ($method === 'PUT') {
            curl_setopt($curl, CURLOPT_POSTFIELDS, '');
        }
        if (curl_exec($curl) === false) {
            $error = curl_error($curl);
            curl_close($curl);

            throw new \RuntimeException("S3 request failed: {$error}");
        }
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);

        return $status;
    }
}
