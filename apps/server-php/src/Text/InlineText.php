<?php

declare(strict_types=1);

namespace NotionAlt\Text;

/**
 * Port of `inlineToPlainText` from packages/shared/src/inline.ts: the visible text of the
 * Markdown-inline subset of `Block.content` (ADR 0008) without markup. Anything that does not form
 * valid syntax stays literal text. Works on bytes: all delimiters are ASCII, so positions agree
 * with the UTF-16 positions of the TypeScript version.
 */
final class InlineText
{
    private const ESCAPABLE = ['\\' => true, '*' => true, '_' => true, '`' => true, '[' => true, ']' => true];

    private const PAGE_LINK_PREFIX = 'page:';

    public static function toPlainText(string $source): string
    {
        return self::parseRange($source, 0, \strlen($source), true);
    }

    private static function parseRange(string $src, int $start, int $end, bool $allowLinks): string
    {
        $text = '';
        $i = $start;
        while ($i < $end) {
            $ch = $src[$i];
            if ($ch === '\\' && $i + 1 < $end && isset(self::ESCAPABLE[$src[$i + 1]])) {
                $text .= $src[$i + 1];
                $i += 2;
                continue;
            }
            if ($ch === '`') {
                $close = strpos($src, '`', $i + 1);
                if ($close !== false && $close < $end && $close > $i + 1) {
                    $text .= substr($src, $i + 1, $close - $i - 1);
                    $i = $close + 1;
                    continue;
                }
            }
            if ($ch === '*' && self::at($src, $i + 1) === '*') {
                $close = self::findClosing($src, $i + 2, $end, '**');
                if ($close !== -1 && $close > $i + 2 && self::flanking($src, $i + 2, $close)) {
                    $text .= self::parseRange($src, $i + 2, $close, $allowLinks);
                    $i = $close + 2;
                    continue;
                }
            } elseif ($ch === '*' || $ch === '_') {
                $close = self::findClosing($src, $i + 1, $end, $ch);
                if ($close !== -1 && $close > $i + 1 && self::flanking($src, $i + 1, $close)) {
                    $text .= self::parseRange($src, $i + 1, $close, $allowLinks);
                    $i = $close + 1;
                    continue;
                }
            }
            if ($ch === '[' && $allowLinks) {
                $link = self::parseLink($src, $i, $end);
                if ($link !== null) {
                    $text .= $link[0];
                    $i = $link[1];
                    continue;
                }
            }
            $text .= $ch;
            ++$i;
        }

        return $text;
    }

    private static function at(string $src, int $index): string
    {
        return $index < \strlen($src) ? $src[$index] : '';
    }

    /** Emphasis must not start or end with whitespace (`2 * 3 * 4` stays text). */
    private static function flanking(string $src, int $contentStart, int $contentEnd): bool
    {
        $content = substr($src, $contentStart, $contentEnd - $contentStart);

        return !Js::startsWithWhitespace($content) && !Js::endsWithWhitespace($content);
    }

    /** Finds the closing delimiter, skipping escapes, code spans and (for `*`) bold markers. */
    private static function findClosing(string $src, int $from, int $end, string $delim): int
    {
        $i = $from;
        while ($i < $end) {
            $ch = $src[$i];
            if ($ch === '\\') {
                $i += 2;
                continue;
            }
            if ($ch === '`') {
                $close = strpos($src, '`', $i + 1);
                if ($close !== false && $close < $end) {
                    $i = $close + 1;
                    continue;
                }
            }
            if ($delim === '_' && $ch === '_') {
                return $i;
            }
            if ($ch === '*' && $delim !== '_') {
                $double = self::at($src, $i + 1) === '*';
                if ($delim === '**' && $double) {
                    return $i;
                }
                if ($delim === '*' && !$double) {
                    return $i;
                }
                if ($delim === '*') {
                    // Skip a nested bold span as a unit.
                    $close = self::findClosing($src, $i + 2, $end, '**');
                    $i = $close === -1 ? $i + 2 : $close + 2;
                    continue;
                }
            }
            ++$i;
        }

        return -1;
    }

    /**
     * @return array{0: string, 1: int}|null plain text of the link and the position after it
     */
    private static function parseLink(string $src, int $start, int $end): ?array
    {
        // Find the matching `]` (no nested brackets), then `(href)`.
        $i = $start + 1;
        while ($i < $end && $src[$i] !== ']') {
            if ($src[$i] === '\\') {
                ++$i;
            } elseif ($src[$i] === '[') {
                return null;
            }
            ++$i;
        }
        if ($i >= $end || self::at($src, $i + 1) !== '(') {
            return null;
        }
        $textEnd = $i;
        $hrefStart = $i + 2;
        $hrefEnd = $hrefStart <= \strlen($src) ? strpos($src, ')', $hrefStart) : false;
        if ($hrefEnd === false || $hrefEnd >= $end) {
            return null;
        }
        $href = substr($src, $hrefStart, $hrefEnd - $hrefStart);
        if (Js::containsWhitespace($href)) {
            return null;
        }
        $next = $hrefEnd + 1;
        if (str_starts_with($href, self::PAGE_LINK_PREFIX)) {
            $documentId = substr($href, \strlen(self::PAGE_LINK_PREFIX));
            if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iD', $documentId) !== 1) {
                return null;
            }
            $title = preg_replace('/\\\\([\\\\*_`[\\]])/', '$1', substr($src, $start + 1, $textEnd - $start - 1));

            return [$title ?? '', $next];
        }
        if (!self::isSafeHref($href)) {
            return null;
        }

        return [self::parseRange($src, $start + 1, $textEnd, false), $next];
    }

    /**
     * Only http(s) and mailto links are links (`isSafeHref`). Approximates `new URL(href)`:
     * http(s) URLs need a host.
     */
    private static function isSafeHref(string $href): bool
    {
        if (preg_match('/^([a-zA-Z][a-zA-Z0-9+.\-]*):(.*)$/sD', $href, $match) !== 1) {
            return false;
        }
        $scheme = strtolower($match[1]);
        if ($scheme === 'mailto') {
            return true;
        }
        if ($scheme !== 'http' && $scheme !== 'https') {
            return false;
        }
        $authority = ltrim($match[2], '/\\');
        $authority = (string) preg_replace('#[/?\\\\\\#].*$#s', '', $authority);
        $at = strrpos($authority, '@');
        if ($at !== false) {
            $authority = substr($authority, $at + 1);
        }
        if (preg_match('/^(\[[0-9a-fA-F:.]+\]|[^:\[\]]+)(?::(\d*))?$/D', $authority, $parts) !== 1) {
            return false;
        }

        return !isset($parts[2]) || $parts[2] === '' || (int) $parts[2] <= 65535;
    }
}
