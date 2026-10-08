<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/**
 * zod's `z.coerce.number()` in front of another number schema: converts the input like
 * JavaScript's `Number(value)` (query parameters arrive as strings), then hands it on.
 */
final class CoerceNumberSchema extends Schema
{
    public function __construct(private readonly Schema $inner) {}

    public function run(mixed $value, array $path, array &$issues): mixed
    {
        $number = self::toNumber($value);
        if (\is_float($number) && is_nan($number)) {
            $issues[] = new Issue($path, 'invalid_type', 'Invalid input: expected number, received NaN');

            return null;
        }

        return $this->inner->run($number, $path, $issues);
    }

    /** JavaScript's `Number(value)` for the inputs a query string or JSON body can hold. */
    public static function toNumber(mixed $value): int|float
    {
        if ($value === null || $value === false) {
            return 0;
        }
        if ($value === true) {
            return 1;
        }
        if (\is_int($value) || \is_float($value)) {
            return $value;
        }
        if (\is_array($value)) {
            // `Number([])` is 0, `Number(['5'])` is 5, longer arrays are NaN.
            return match (\count($value)) {
                0 => 0,
                1 => self::toNumber(array_values($value)[0]),
                default => NAN,
            };
        }
        if (!\is_string($value)) {
            return NAN;
        }
        $text = trim($value, " \t\n\r\v\f");
        if ($text === '') {
            return 0;
        }
        if (preg_match('/^0([xob])([0-9a-f]+)$/i', $text, $match) === 1) {
            $base = ['x' => 16, 'o' => 8, 'b' => 2][strtolower($match[1])];
            $digits = strtolower($match[2]);
            if (strspn($digits, substr('0123456789abcdef', 0, $base)) !== \strlen($digits)) {
                return NAN;
            }

            return (int) base_convert($digits, $base, 10);
        }
        if (preg_match('/^[+-]?Infinity$/', $text) === 1) {
            return $text[0] === '-' ? -INF : INF;
        }
        if (preg_match('/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i', $text) !== 1) {
            return NAN;
        }
        if (preg_match('/^[+-]?\d{1,18}$/', $text) === 1) {
            return (int) $text;
        }

        return (float) $text;
    }
}
