<?php

declare(strict_types=1);

namespace NotionAlt\Attachments;

use Psr\Http\Message\StreamInterface;
use Slim\Psr7\Stream;

/** Files in `<dir>/<workspace>/<id>`, same layout as the Node server (shared data volume). */
final class VolumeStore extends ContentStore
{
    public function __construct(public readonly string $dir) {}

    public function kind(): string
    {
        return 'volume';
    }

    public function path(string $workspaceId, string $id): string
    {
        return $this->dir . '/' . self::key($workspaceId, $id);
    }

    /** Writes atomically (temp file + rename): a crash never leaves a half-written attachment. */
    public function put(string $workspaceId, string $id, string $data): void
    {
        $target = $this->path($workspaceId, $id);
        $dir = \dirname($target);
        if (!is_dir($dir) && !@mkdir($dir, 0o777, true) && !is_dir($dir)) {
            throw new \RuntimeException('Cannot create attachment directory');
        }
        $temp = $target . '.' . getmypid() . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($temp, $data) !== \strlen($data) || !@rename($temp, $target)) {
            @unlink($temp);

            throw new \RuntimeException('Cannot write attachment');
        }
    }

    public function get(string $workspaceId, string $id): ?StreamInterface
    {
        $handle = @fopen($this->path($workspaceId, $id), 'rb');

        return $handle === false ? null : new Stream($handle);
    }

    public function remove(string $workspaceId, string $id): void
    {
        $file = $this->path($workspaceId, $id);
        if (is_file($file)) {
            @unlink($file);
        }
    }
}
