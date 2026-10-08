<?php

declare(strict_types=1);

namespace NotionAlt\Text;

/** String helpers with JavaScript semantics, so that PHP and the TypeScript code agree. */
final class Js
{
    /** Characters of JavaScript's `\s` and `String.prototype.trim` (for a PCRE class with /u). */
    public const WHITESPACE = '\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';

    /** `String.prototype.trim`. */
    public static function trim(string $value): string
    {
        $trimmed = preg_replace('/^[' . self::WHITESPACE . ']+|[' . self::WHITESPACE . ']+$/uD', '', $value);

        // Invalid UTF-8: fall back to ASCII whitespace.
        return $trimmed ?? trim($value, " \t\n\r\v\f");
    }

    /** Whether the string contains a character of JavaScript's `\s`. */
    public static function containsWhitespace(string $value): bool
    {
        return preg_match('/[' . self::WHITESPACE . ']/u', $value) === 1;
    }

    public static function startsWithWhitespace(string $value): bool
    {
        return preg_match('/^[' . self::WHITESPACE . ']/u', $value) === 1;
    }

    public static function endsWithWhitespace(string $value): bool
    {
        return preg_match('/[' . self::WHITESPACE . ']$/uD', $value) === 1;
    }
}
