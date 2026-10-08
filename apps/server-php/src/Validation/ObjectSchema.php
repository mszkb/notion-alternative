<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/**
 * zod's `z.object({...})`: accepts a JSON object (`stdClass`) or an associative array and returns
 * an associative array. Unknown keys are dropped like in zod, or rejected after `strict()`.
 */
final class ObjectSchema extends Schema
{
    private bool $strict = false;

    /**
     * @param array<string, Schema> $shape
     */
    public function __construct(private readonly array $shape) {}

    public function strict(): self
    {
        $copy = clone $this;
        $copy->strict = true;

        return $copy;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function run(mixed $value, array $path, array &$issues): ?array
    {
        if ($value instanceof \stdClass) {
            $value = get_object_vars($value);
        } elseif (!\is_array($value) || array_is_list($value)) {
            // A PHP list (also `[]`) is a JSON array.
            $issues[] = self::invalidType('object', $value, $path);

            return null;
        }
        $result = [];
        foreach ($this->shape as $key => $schema) {
            $parsed = $schema->run(\array_key_exists($key, $value) ? $value[$key] : Undefined::Value, [...$path, $key], $issues);
            if ($parsed !== Undefined::Value) {
                $result[$key] = $parsed;
            }
        }
        if ($this->strict) {
            $unknown = array_values(array_diff(array_map('strval', array_keys($value)), array_keys($this->shape)));
            if ($unknown !== []) {
                $names = implode(', ', array_map(static fn(string $key): string => '"' . $key . '"', $unknown));
                $issues[] = new Issue($path, 'unrecognized_keys', (\count($unknown) === 1 ? 'Unrecognized key: ' : 'Unrecognized keys: ') . $names);
            }
        }

        return $result;
    }
}
