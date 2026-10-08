<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/** zod's `z.boolean()` (no coercion: `"true"` is rejected). */
final class BooleanSchema extends Schema
{
    public function run(mixed $value, array $path, array &$issues): mixed
    {
        if (!\is_bool($value)) {
            $issues[] = self::invalidType('boolean', $value, $path);

            return null;
        }

        return $value;
    }
}
