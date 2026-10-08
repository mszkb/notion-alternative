<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/** zod's `z.number().int()`: an integer within JavaScript's safe range (`1.0` counts as `1`). */
final class IntSchema extends Schema
{
    private const MAX_SAFE = 9007199254740991;

    private ?int $min = null;

    private ?int $max = null;

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
        if (\is_float($value) && is_finite($value) && floor($value) === $value && abs($value) <= self::MAX_SAFE) {
            $value = (int) $value;
        }
        if (\is_float($value) && is_finite($value) && floor($value) === $value) {
            $issues[] = $value > 0
                ? new Issue($path, 'too_big', 'Too big: expected int to be <=' . self::MAX_SAFE)
                : new Issue($path, 'too_small', 'Too small: expected int to be >=-' . self::MAX_SAFE);

            return null;
        }
        if (!\is_int($value)) {
            $issues[] = self::invalidType(\is_float($value) ? 'int' : 'number', $value, $path);

            return null;
        }
        if ($value > self::MAX_SAFE) {
            $issues[] = new Issue($path, 'too_big', 'Too big: expected int to be <=' . self::MAX_SAFE);
        } elseif ($value < -self::MAX_SAFE) {
            $issues[] = new Issue($path, 'too_small', 'Too small: expected int to be >=-' . self::MAX_SAFE);
        }
        if ($this->min !== null && $value < $this->min) {
            $issues[] = new Issue($path, 'too_small', "Too small: expected number to be >={$this->min}");
        }
        if ($this->max !== null && $value > $this->max) {
            $issues[] = new Issue($path, 'too_big', "Too big: expected number to be <={$this->max}");
        }

        return $value;
    }
}
