<?php

declare(strict_types=1);

namespace NotionAlt\Sync;

/** Raised before anything is written; turned into a conflict object, not a rollback. */
final class ConflictFound extends \RuntimeException
{
    public function __construct(
        public readonly int $currentRevision,
        /** 'changed', 'deleted' or 'parent_deleted' (ConflictReason). */
        public readonly string $reason,
    ) {
        parent::__construct('conflict');
    }
}
