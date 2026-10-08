<?php

declare(strict_types=1);

namespace NotionAlt\Sync;

/** One client operation as accepted by `SyncSchemas::operation()` (shared `Operation` type). */
final class Operation
{
    public function __construct(
        public readonly string $opId,
        public readonly string $deviceId,
        public readonly string $workspaceId,
        public readonly string $entity,
        public readonly string $entityId,
        public readonly string $kind,
        public readonly ?int $baseRevision,
        /** The payload exactly as sent (objects as `stdClass`, so `{}` stays `{}`), stored unchanged. */
        public readonly \stdClass $payload,
        public readonly string $createdAt,
    ) {}

    /**
     * @param array<string, mixed> $input parsed by `SyncSchemas::operation()`
     */
    public static function fromInput(array $input): self
    {
        $payload = $input['payload'] ?? null;
        $baseRevision = $input['baseRevision'] ?? null;

        return new self(
            self::str($input, 'opId'),
            self::str($input, 'deviceId'),
            self::str($input, 'workspaceId'),
            self::str($input, 'entity'),
            self::str($input, 'entityId'),
            self::str($input, 'kind'),
            \is_int($baseRevision) ? $baseRevision : null,
            $payload instanceof \stdClass ? $payload : (object) (\is_array($payload) ? $payload : []),
            self::str($input, 'createdAt'),
        );
    }

    /**
     * Top-level payload fields.
     *
     * @return array<string, mixed>
     */
    public function fields(): array
    {
        $fields = [];
        foreach (get_object_vars($this->payload) as $name => $value) {
            $fields[(string) $name] = $value;
        }

        return $fields;
    }

    /** A payload field (undefined and null both as null). */
    public function field(string $name): mixed
    {
        return $this->fields()[$name] ?? null;
    }

    /** Whether the payload has the field (`!== undefined`). */
    public function has(string $name): bool
    {
        return \array_key_exists($name, $this->fields());
    }

    /**
     * @param array<string, mixed> $input
     */
    private static function str(array $input, string $key): string
    {
        $value = $input[$key] ?? null;

        return \is_string($value) ? $value : throw new \InvalidArgumentException("{$key} is not a string");
    }
}
