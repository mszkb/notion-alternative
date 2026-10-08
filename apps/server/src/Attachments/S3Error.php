<?php

declare(strict_types=1);

namespace NotionAlt\Attachments;

/** Errors never include credentials or signed headers. */
final class S3Error extends \RuntimeException
{
    public function __construct(public readonly int $status, string $operation)
    {
        parent::__construct("S3 {$operation} failed with status {$status}");
    }
}
