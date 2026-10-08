<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

use NotionAlt\Text\Js;

/**
 * zod's `z.string()`. Transforms and checks run in the order they were added (like zod), and all
 * checks run even if an earlier one failed. Lengths count Unicode code points (zod 4).
 */
final class StringSchema extends Schema
{
    /** zod 4's email pattern (`z.email()`). */
    private const EMAIL = "/^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$/D";

    /** zod 4's UUID pattern (`z.uuid()`, RFC 9562 versions 1-8 plus nil and max), without anchors. */
    public const UUID_PATTERN = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)';

    private const UUID = '/^' . self::UUID_PATTERN . '$/D';

    /** @var list<array{0: string, 1?: int|string, 2?: string}> */
    private array $steps = [];

    public function trim(): self
    {
        return $this->with(['trim']);
    }

    public function toLowerCase(): self
    {
        return $this->with(['lower']);
    }

    public function min(int $length): self
    {
        return $this->with(['min', $length]);
    }

    public function max(int $length): self
    {
        return $this->with(['max', $length]);
    }

    public function email(): self
    {
        return $this->with(['email']);
    }

    public function uuid(): self
    {
        return $this->with(['uuid']);
    }

    /** `.regex(pattern, message)`; `$pattern` is a PCRE pattern including delimiters. */
    public function regex(string $pattern, ?string $message = null): self
    {
        return $this->with($message === null ? ['regex', $pattern] : ['regex', $pattern, $message]);
    }

    /**
     * `z.url()`: what `new URL()` accepts, approximated: a scheme, and for the special schemes
     * (http, https, ws, wss, ftp) a host without spaces.
     */
    public function url(): self
    {
        return $this->with(['url']);
    }

    public function run(mixed $value, array $path, array &$issues): mixed
    {
        if (!\is_string($value)) {
            $issues[] = self::invalidType('string', $value, $path);

            return null;
        }
        foreach ($this->steps as $step) {
            $issue = null;
            switch ($step[0]) {
                case 'trim':
                    $value = Js::trim($value);
                    break;
                case 'lower':
                    $value = mb_strtolower($value, 'UTF-8');
                    break;
                case 'min':
                    $min = (int) ($step[1] ?? 0);
                    if (mb_strlen($value, 'UTF-8') < $min) {
                        $issue = new Issue($path, 'too_small', "Too small: expected string to have >={$min} characters");
                    }
                    break;
                case 'max':
                    $max = (int) ($step[1] ?? 0);
                    if (mb_strlen($value, 'UTF-8') > $max) {
                        $issue = new Issue($path, 'too_big', "Too big: expected string to have <={$max} characters");
                    }
                    break;
                case 'email':
                    if (preg_match(self::EMAIL, $value) !== 1) {
                        $issue = new Issue($path, 'invalid_format', 'Invalid email address');
                    }
                    break;
                case 'uuid':
                    if (preg_match(self::UUID, $value) !== 1) {
                        $issue = new Issue($path, 'invalid_format', 'Invalid UUID');
                    }
                    break;
                case 'regex':
                    if (preg_match((string) ($step[1] ?? ''), $value) !== 1) {
                        $issue = new Issue($path, 'invalid_format', (string) ($step[2] ?? 'Invalid string: must match pattern'));
                    }
                    break;
                case 'url':
                    if (!self::isUrl($value)) {
                        $issue = new Issue($path, 'invalid_format', 'Invalid URL');
                    }
                    break;
            }
            if ($issue !== null) {
                $issues[] = $issue;
            }
        }

        return $value;
    }

    private static function isUrl(string $value): bool
    {
        // `new URL()` strips leading and trailing C0 controls and spaces.
        $value = trim($value, "\x00..\x20");
        if (preg_match('/^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/sD', $value, $match) !== 1) {
            return false;
        }
        if (!\in_array(strtolower($match[1]), ['http', 'https', 'ws', 'wss', 'ftp'], true)) {
            return true;
        }
        // Special schemes need a host: `//host`, `/host` and `host` all work in WHATWG URLs.
        $rest = ltrim($match[2], '/\\');
        $authority = preg_split('#[/\\\\?\#]#', $rest, 2)[0] ?? '';
        $host = preg_replace('/^.*@/s', '', $authority) ?? '';
        $host = preg_replace('/:\d*$/D', '', $host) ?? '';

        return $host !== '' && preg_match('/[\x00-\x20#%\/:<>?@\[\\\\\]^|]/', $host) !== 1
            || preg_match('/^\[[0-9a-fA-F:.]+\]$/D', $host) === 1;
    }

    /**
     * @param array{0: string, 1?: int|string, 2?: string} $step
     */
    private function with(array $step): self
    {
        $copy = clone $this;
        $copy->steps[] = $step;

        return $copy;
    }
}
