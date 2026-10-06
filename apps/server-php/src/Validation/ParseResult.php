<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

final class ParseResult
{
    /**
     * @param list<Issue> $issues
     */
    public function __construct(
        public readonly mixed $data,
        public readonly array $issues,
    ) {}

    public function success(): bool
    {
        return $this->issues === [];
    }
}
