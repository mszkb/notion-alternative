<?php

declare(strict_types=1);

namespace NotionAlt\Config;

/** Server configuration (docs/operations/deployment.md). */
final class Config
{
    public function __construct(
        public readonly string $logLevel,
        public readonly string $databasePath,
        public readonly bool $allowRegistration,
        public readonly bool $cookieSecure,
        public readonly int $sessionTtlDays,
        public readonly bool $metricsEnabled,
        /** Request body limit of `POST /api/import`. */
        public readonly int $importMaxBytes,
        public readonly AttachmentsConfig $attachments,
        public readonly PushConfig $push,
        public readonly AuthRateLimitConfig $authRateLimit,
        /** Take the client address from `X-Forwarded-For` of a private-network proxy (rate limits). */
        public readonly bool $trustProxy = true,
    ) {}
}
