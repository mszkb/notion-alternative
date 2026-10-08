<?php

declare(strict_types=1);

namespace NotionAlt\Config;

final class PushConfig
{
    /**
     * @param list<string> $allowedHosts host names; `*.` allows subdomains
     */
    public function __construct(
        public readonly string $subject,
        public readonly array $allowedHosts,
    ) {}
}
