<?php

declare(strict_types=1);

namespace NotionAlt\Http;

/**
 * An error with an HTTP status, sent as `{"error":{"code","message",...details}}`
 * (same as `HttpError` in apps/server/src/errors.ts).
 */
final class HttpError extends \RuntimeException
{
    /**
     * @param array<string, mixed>  $details extra fields of the error object
     * @param array<string, string> $headers response headers, e.g. `Retry-After`
     */
    public function __construct(
        public readonly int $statusCode,
        public readonly string $errorCode,
        string $message,
        public readonly array $details = [],
        ?\Throwable $previous = null,
        public readonly array $headers = [],
    ) {
        parent::__construct($message, 0, $previous);
    }
}
