<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/** zod's `.default(value)`: a missing value becomes `value` (not validated), others go on. */
final class DefaultSchema extends Schema
{
    public function __construct(
        private readonly Schema $inner,
        private readonly mixed $default,
    ) {}

    public function run(mixed $value, array $path, array &$issues): mixed
    {
        return $value === Undefined::Value ? $this->default : $this->inner->run($value, $path, $issues);
    }
}
