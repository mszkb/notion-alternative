<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/** zod's `.nullable()`. */
final class NullableSchema extends Schema
{
    public function __construct(private readonly Schema $inner) {}

    public function run(mixed $value, array $path, array &$issues): mixed
    {
        return $value === null ? null : $this->inner->run($value, $path, $issues);
    }
}
