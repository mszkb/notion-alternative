<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

final class Issue
{
    /**
     * @param list<string|int> $path
     */
    public function __construct(
        public readonly array $path,
        public readonly string $code,
        public readonly string $message,
    ) {}

    /** The path as sent to clients, e.g. `operations.0.id` (like zod's `path.join('.')`). */
    public function pathString(): string
    {
        return implode('.', $this->path);
    }
}
