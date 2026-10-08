<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/** zod's `z.enum([...])` of strings. */
final class EnumSchema extends Schema
{
    /**
     * @param list<string> $values
     */
    public function __construct(private readonly array $values) {}

    public function run(mixed $value, array $path, array &$issues): mixed
    {
        if (!\is_string($value) || !\in_array($value, $this->values, true)) {
            $options = implode('|', array_map(static fn(string $option): string => '"' . $option . '"', $this->values));
            $issues[] = new Issue($path, 'invalid_value', "Invalid option: expected one of {$options}");

            return null;
        }

        return $value;
    }
}
