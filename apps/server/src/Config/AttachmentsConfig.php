<?php

declare(strict_types=1);

namespace NotionAlt\Config;

final class AttachmentsConfig
{
    public function __construct(
        public readonly string $dir,
        public readonly int $maxBytes,
        /** Days a deleted attachment's file is kept (restore, conflicts). */
        public readonly int $retentionDays,
        /** Total size of a workspace's attachments; null = unlimited. */
        public readonly ?int $workspaceQuotaBytes,
        /** S3-compatible storage instead of the volume (`dir`). */
        public readonly ?S3Config $s3,
    ) {}
}
