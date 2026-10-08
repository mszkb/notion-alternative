<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/**
 * zod's `z.record(z.string(), z.unknown())`: any JSON object. The value is returned unchanged
 * (a `stdClass` stays one), so it encodes back to the same JSON, `{}` included.
 */
final class RecordSchema extends Schema
{
    public function run(mixed $value, array $path, array &$issues): mixed
    {
        if ($value instanceof \stdClass || (\is_array($value) && ($value === [] || !array_is_list($value)))) {
            return $value;
        }
        $issues[] = self::invalidType('record', $value, $path);

        return null;
    }
}
