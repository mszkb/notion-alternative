<?php

declare(strict_types=1);

namespace NotionAlt\Attachments;

use NotionAlt\Config\AttachmentsConfig;
use Psr\Http\Message\StreamInterface;

/** Where attachment contents live: data volume (default) or S3-compatible storage (#63). */
abstract class ContentStore
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

    /** 'volume' or 's3'. */
    abstract public function kind(): string;

    abstract public function put(string $workspaceId, string $id, string $data): void;

    /** Null if the object does not exist. */
    abstract public function get(string $workspaceId, string $id): ?StreamInterface;

    abstract public function remove(string $workspaceId, string $id): void;

    public static function fromConfig(AttachmentsConfig $config): self
    {
        return $config->s3 !== null ? new S3Store(new S3Client($config->s3)) : new VolumeStore($config->dir);
    }

    /** `<workspace>/<id>` (both UUIDs, never user-chosen names). */
    protected static function key(string $workspaceId, string $id): string
    {
        if (preg_match(self::UUID, $workspaceId) !== 1 || preg_match(self::UUID, $id) !== 1) {
            throw new \InvalidArgumentException('Invalid attachment path');
        }

        return "{$workspaceId}/{$id}";
    }
}
