<?php

declare(strict_types=1);

namespace NotionAlt\Attachments;

use Psr\Http\Message\StreamInterface;

/** Objects `<workspace>/<id>` in an S3-compatible bucket (#63). */
final class S3Store extends ContentStore
{
    public function __construct(private readonly S3Client $client) {}

    public function kind(): string
    {
        return 's3';
    }

    public function put(string $workspaceId, string $id, string $data): void
    {
        $this->client->put(self::key($workspaceId, $id), $data);
    }

    public function get(string $workspaceId, string $id): ?StreamInterface
    {
        return $this->client->get(self::key($workspaceId, $id));
    }

    public function remove(string $workspaceId, string $id): void
    {
        $this->client->delete(self::key($workspaceId, $id));
    }
}
