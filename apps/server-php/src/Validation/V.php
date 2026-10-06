<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/** Schema factory, the counterpart of zod's `z`. */
final class V
{
    public static function string(): StringSchema
    {
        return new StringSchema();
    }

    /** `z.email()`. */
    public static function email(): StringSchema
    {
        return (new StringSchema())->email();
    }

    /** `z.uuid()`. */
    public static function uuid(): StringSchema
    {
        return (new StringSchema())->uuid();
    }

    /** `z.number().int()`. */
    public static function int(): IntSchema
    {
        return new IntSchema();
    }

    public static function boolean(): BooleanSchema
    {
        return new BooleanSchema();
    }

    /**
     * @param list<string> $values
     */
    public static function enum(array $values): EnumSchema
    {
        return new EnumSchema($values);
    }

    public static function array(Schema $element): ArraySchema
    {
        return new ArraySchema($element);
    }

    /**
     * @param array<string, Schema> $shape
     */
    public static function object(array $shape): ObjectSchema
    {
        return new ObjectSchema($shape);
    }
}
