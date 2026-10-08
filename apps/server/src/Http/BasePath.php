<?php

declare(strict_types=1);

namespace NotionAlt\Http;

/**
 * Where the app is mounted when it is not at the root of the host. Routes always start with
 * `/api`, so the part in front of it is stripped:
 *
 * - `php -S … public/index.php` or `public/` as document root: `/index.php` → base path ``
 * - shared hosting with `api/` in the web root: `/api/index.php` → ``
 * - same in a subdirectory: `/notes/api/index.php` → `/notes` (requests to `/notes/api/…`)
 * - `public/` as `/notes`: `/notes/index.php` → `/notes`
 */
final class BasePath
{
    /**
     * @param array<mixed> $server `$_SERVER`
     */
    public static function detect(array $server): string
    {
        if (\PHP_SAPI === 'cli-server') {
            return '';
        }
        $script = $server['SCRIPT_NAME'] ?? '';
        if (!\is_string($script) || $script === '') {
            return '';
        }
        $dir = rtrim(str_replace('\\', '/', \dirname($script)), '/');
        if (str_ends_with($dir, '/api')) {
            $dir = substr($dir, 0, -\strlen('/api'));
        }
        $path = parse_url(\is_string($server['REQUEST_URI'] ?? null) ? $server['REQUEST_URI'] : '/', PHP_URL_PATH);

        // Only a prefix of the request path can be stripped.
        return \is_string($path) && $dir !== '' && str_starts_with($path, $dir . '/') ? $dir : '';
    }
}
