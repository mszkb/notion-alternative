<?php

declare(strict_types=1);

namespace NotionAlt\Sync;

use NotionAlt\Config\AttachmentsConfig;

/** Operator limits for attachments (#64); no feature locks, only capacity. */
final class AttachmentLimits
{
    public function __construct(
        /** null: unlimited. */
        public readonly ?int $maxBytes,
        public readonly ?int $workspaceQuotaBytes,
    ) {}

    public static function none(): self
    {
        return new self(null, null);
    }

    public static function fromConfig(AttachmentsConfig $config): self
    {
        return new self($config->maxBytes, $config->workspaceQuotaBytes);
    }
}
