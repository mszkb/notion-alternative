<?php

declare(strict_types=1);

namespace NotionAlt\Config;

final class AuthRateLimitConfig
{
    public function __construct(
        public readonly int $windowMinutes,
        public readonly int $loginMaxFailuresPerIp,
        public readonly int $loginMaxFailuresPerEmail,
        public readonly int $registerMaxAttemptsPerIp,
    ) {}
}
