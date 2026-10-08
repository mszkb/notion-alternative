<?php

declare(strict_types=1);

namespace NotionAlt\Sync;

/** Ends an operation with a final result (rejected or duplicate); rolls back its savepoint. */
final class Stop extends \RuntimeException
{
    /**
     * @param array<string, int|string> $result
     */
    public function __construct(public readonly array $result)
    {
        parent::__construct((string) $result['status']);
    }
}
