<?php

declare(strict_types=1);

namespace NotionAlt\Tests;

/** A temporary directory per test, removed afterwards. */
trait TempDir
{
    private ?string $tempDir = null;

    protected function tempDir(): string
    {
        if ($this->tempDir === null) {
            $dir = sys_get_temp_dir() . '/notion-alt-php-' . bin2hex(random_bytes(6));
            mkdir($dir, 0o777, true);
            $this->tempDir = $dir;
        }

        return $this->tempDir;
    }

    #[\PHPUnit\Framework\Attributes\After]
    protected function removeTempDir(): void
    {
        if ($this->tempDir === null) {
            return;
        }
        $items = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($this->tempDir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($items as $item) {
            \assert($item instanceof \SplFileInfo);
            if ($item->isDir()) {
                rmdir($item->getPathname());
            } else {
                unlink($item->getPathname());
            }
        }
        rmdir($this->tempDir);
        $this->tempDir = null;
    }
}
