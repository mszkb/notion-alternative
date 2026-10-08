<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/** zod's `z.literal(value)` of an int or string. */
final class LiteralSchema extends Schema
{
    public function __construct(private readonly int|string $value) {}

    public function run(mixed $value, array $path, array &$issues): mixed
    {
        if ($value !== $this->value) {
            $expected = \is_string($this->value) ? '"' . $this->value . '"' : (string) $this->value;
            $issues[] = new Issue($path, 'invalid_value', "Invalid input: expected {$expected}");

            return null;
        }

        return $value;
    }
}
