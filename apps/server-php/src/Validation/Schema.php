<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/**
 * Base of the validation schemas, a small port of the zod schemas in packages/shared (ADR 0018).
 * Issue paths and codes match zod; messages follow zod's wording but are not part of the contract.
 */
abstract class Schema
{
    /**
     * Validates and transforms `$value`. Appends issues instead of throwing; the result is only
     * meaningful when no issue was added.
     *
     * @param list<string|int> $path
     * @param list<Issue>      $issues
     */
    abstract public function run(mixed $value, array $path, array &$issues): mixed;

    /** Like zod's `safeParse`. */
    public function safeParse(mixed $value): ParseResult
    {
        $issues = [];
        $data = $this->run($value, [], $issues);

        return new ParseResult($issues === [] ? $data : null, $issues);
    }

    public function optional(): OptionalSchema
    {
        return new OptionalSchema($this);
    }

    /** zod's `.default(value)`. */
    public function default(mixed $value): DefaultSchema
    {
        return new DefaultSchema($this, $value);
    }

    public function nullable(): NullableSchema
    {
        return new NullableSchema($this);
    }

    /** zod's name of the received type, e.g. in "expected string, received number". */
    public static function typeName(mixed $value): string
    {
        return match (true) {
            $value === Undefined::Value => 'undefined',
            $value === null => 'null',
            \is_string($value) => 'string',
            \is_int($value) => 'number',
            \is_float($value) => is_nan($value) ? 'nan' : 'number',
            \is_bool($value) => 'boolean',
            \is_array($value) => array_is_list($value) ? 'array' : 'object',
            default => 'object',
        };
    }

    /**
     * @param list<string|int> $path
     */
    protected static function invalidType(string $expected, mixed $value, array $path): Issue
    {
        return new Issue(
            $path,
            'invalid_type',
            \sprintf('Invalid input: expected %s, received %s', $expected, self::typeName($value)),
        );
    }
}
