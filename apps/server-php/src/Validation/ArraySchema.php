<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/** zod's `z.array(...)`: element issues first, then the length checks. */
final class ArraySchema extends Schema
{
    private ?int $min = null;

    private ?int $max = null;

    public function __construct(private readonly Schema $element) {}

    public function min(int $min): self
    {
        $copy = clone $this;
        $copy->min = $min;

        return $copy;
    }

    public function max(int $max): self
    {
        $copy = clone $this;
        $copy->max = $max;

        return $copy;
    }

    public function run(mixed $value, array $path, array &$issues): mixed
    {
        if (!\is_array($value) || !array_is_list($value)) {
            $issues[] = self::invalidType('array', $value, $path);

            return null;
        }
        $result = [];
        foreach ($value as $index => $item) {
            $result[] = $this->element->run($item, [...$path, $index], $issues);
        }
        $count = \count($value);
        if ($this->min !== null && $count < $this->min) {
            $issues[] = new Issue($path, 'too_small', "Too small: expected array to have >={$this->min} items");
        }
        if ($this->max !== null && $count > $this->max) {
            $issues[] = new Issue($path, 'too_big', "Too big: expected array to have <={$this->max} items");
        }

        return $result;
    }
}
