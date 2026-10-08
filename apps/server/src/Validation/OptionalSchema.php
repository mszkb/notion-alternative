<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/** zod's `.optional()`: a missing value stays missing (the key is left out of the result). */
final class OptionalSchema extends Schema
{
    public function __construct(private readonly Schema $inner) {}

    public function run(mixed $value, array $path, array &$issues): mixed
    {
        return $value === Undefined::Value ? Undefined::Value : $this->inner->run($value, $path, $issues);
    }
}
