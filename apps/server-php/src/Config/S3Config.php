<?php

declare(strict_types=1);

namespace NotionAlt\Config;

final class S3Config
{
    public function __construct(
        public readonly string $endpoint,
        public readonly string $region,
        public readonly string $bucket,
        public readonly string $accessKeyId,
        #[\SensitiveParameter]
        public readonly string $secretAccessKey,
        public readonly bool $forcePathStyle,
    ) {}
}
