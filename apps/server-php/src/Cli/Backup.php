<?php

declare(strict_types=1);

namespace NotionAlt\Cli;

use NotionAlt\Attachments\VolumeStore;
use NotionAlt\Config\Config;
use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Support\Ids;

/**
 * Backup and restore (port of apps/server/src/backup/backup.ts, #75): the SQLite database with
 * `VACUUM INTO` (a consistent copy while the server runs) plus the attachment files of the
 * volume, and `manifest.json` in the same format as the Node server, so backups restore in both
 * directions as long as no newer migration ran. Not included: configuration and S3 contents.
 *
 * @phpstan-type Manifest array{format: string, version: int, createdAt: string, migration: ?string, attachmentStorage: string, files: list<array{path: string, size: int, sha256: string}>, missingAttachments: list<string>}
 */
final class Backup
{
    public const FORMAT = 'notion-alt-backup';

    /**
     * Sequence numbers handed out after a restore start this far above the restored state, so they
     * never repeat numbers that devices saw before the restore; every device re-syncs (410).
     */
    public const RESTORE_SEQ_GAP = 1_000_000;

    private const DATABASE_FILE = 'app.sqlite';
    private const ATTACHMENTS_FOLDER = 'attachments';

    /**
     * Creates `backup-<time>/` in `$targetRoot`.
     *
     * @return array{dir: string, manifest: Manifest}
     */
    public static function create(Config $config, string $targetRoot, ?int $nowMs = null): array
    {
        $now = Ids::iso($nowMs ?? Ids::nowMs());
        $dir = $targetRoot . '/backup-' . str_replace([':', '.'], '-', $now);
        $work = "{$dir}.partial";
        self::removeTree($work);
        self::mkdir($work);

        // 1. Database: a consistent copy even while the server writes.
        if (!is_file($config->databasePath)) {
            throw new \RuntimeException("{$config->databasePath} does not exist");
        }
        $source = Database::open($config->databasePath);
        Sql::run($source, 'vacuum into ?', ["{$work}/" . self::DATABASE_FILE]);
        unset($source);

        // 2. Attachment files referenced by the copied database (files never change after upload).
        $copy = new \PDO('sqlite:' . "{$work}/" . self::DATABASE_FILE, null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
        $last = Sql::rows($copy, 'select name from kysely_migration order by name desc limit 1');
        $migration = $last === [] ? null : Row::string($last[0], 'name');
        $attachments = [];
        // Databases from before attachments (migration 0008) have no such table.
        if (Sql::rows($copy, "select 1 from sqlite_master where type = 'table' and name = 'attachments'") !== []) {
            $attachments = Sql::rows($copy, 'select id, workspace_id from attachments where stored_at is not null');
        }
        unset($copy);
        $missing = [];
        $storage = $config->attachments->s3 !== null ? 's3' : 'volume';
        if ($storage === 'volume') {
            $volume = new VolumeStore($config->attachments->dir);
            foreach ($attachments as $attachment) {
                $id = Row::string($attachment, 'id');
                $workspaceId = Row::string($attachment, 'workspace_id');
                $target = "{$work}/" . self::ATTACHMENTS_FOLDER . "/{$workspaceId}/{$id}";
                self::mkdir(\dirname($target));
                if (!@copy($volume->path($workspaceId, $id), $target)) {
                    // Purged after deletion in the meantime, or lost: recorded, the backup goes on.
                    $missing[] = $id;
                }
            }
        }

        // 3. Manifest with checksums of every file.
        $files = [];
        foreach (self::walk($work, '') as $relative) {
            $full = "{$work}/{$relative}";
            $files[] = ['path' => $relative, 'size' => (int) filesize($full), 'sha256' => (string) hash_file('sha256', $full)];
        }
        usort($files, static fn(array $a, array $b): int => strcmp($a['path'], $b['path']));
        $manifest = [
            'format' => self::FORMAT,
            'version' => 1,
            'createdAt' => $now,
            'migration' => $migration,
            'attachmentStorage' => $storage,
            'files' => $files,
            'missingAttachments' => $missing,
        ];
        file_put_contents("{$work}/manifest.json", self::prettyJson($manifest) . "\n");
        // Only a complete backup gets the final name.
        if (!rename($work, $dir)) {
            throw new \RuntimeException("Cannot rename {$work}");
        }

        return ['dir' => $dir, 'manifest' => $manifest];
    }

    /**
     * Reads and checks a backup completely; throws with the first problem.
     *
     * @return Manifest
     */
    public static function verify(string $dir): array
    {
        $manifest = self::readManifest($dir);
        foreach ($manifest['files'] as $file) {
            if (\in_array('..', explode('/', $file['path']), true) || \in_array('', explode('/', $file['path']), true)) {
                throw new \RuntimeException("Unsafe path in backup: {$file['path']}");
            }
            $full = "{$dir}/{$file['path']}";
            if (!is_file($full)) {
                throw new \RuntimeException("File missing in backup: {$file['path']}");
            }
            if (filesize($full) !== $file['size'] || hash_file('sha256', $full) !== $file['sha256']) {
                throw new \RuntimeException("Checksum mismatch in backup: {$file['path']}");
            }
        }
        if (!\in_array(self::DATABASE_FILE, array_column($manifest['files'], 'path'), true)) {
            throw new \RuntimeException('Backup contains no database');
        }

        return $manifest;
    }

    /**
     * Restores a verified backup into the configured locations. The server must be stopped (or
     * the web server must not serve the app meanwhile). Refuses to replace an existing database
     * unless `$force`. Afterwards the database is migrated to the current version (T-MIG-01) and
     * sequence numbers are lifted so every device re-syncs and sends what the backup lacks.
     *
     * @return array{manifest: Manifest, attachments: int, migratedFrom: ?string}
     */
    public static function restore(Config $config, string $dir, bool $force = false): array
    {
        $manifest = self::verify($dir);
        $target = $config->databasePath;
        if (file_exists($target) && !$force) {
            throw new \RuntimeException("{$target} exists. Stop the server and pass --force to replace it.");
        }
        self::mkdir(\dirname($target));
        foreach (['', '-wal', '-shm'] as $suffix) {
            if (file_exists($target . $suffix)) {
                unlink($target . $suffix);
            }
        }
        if (!copy("{$dir}/" . self::DATABASE_FILE, "{$target}.restoring") || !rename("{$target}.restoring", $target)) {
            throw new \RuntimeException("Cannot write {$target}");
        }

        $attachments = 0;
        $volume = new VolumeStore($config->attachments->dir);
        foreach ($manifest['files'] as $file) {
            if (!str_starts_with($file['path'], self::ATTACHMENTS_FOLDER . '/')) {
                continue;
            }
            [, $workspaceId, $id] = array_pad(explode('/', $file['path']), 3, '');
            $volume->put($workspaceId, $id, (string) file_get_contents("{$dir}/{$file['path']}"));
            ++$attachments;
        }

        $db = Database::open($target);
        (new Migrator($db))->migrateToLatest();
        Sql::run(
            $db,
            'update workspaces set compacted_seq = max(
               compacted_seq,
               coalesce((select max(seq) from changes where changes.workspace_id = workspaces.id), 0)
             ) + ?',
            [self::RESTORE_SEQ_GAP],
        );

        return ['manifest' => $manifest, 'attachments' => $attachments, 'migratedFrom' => $manifest['migration']];
    }

    /** Like `JSON.stringify(value, null, 2)`. */
    public static function prettyJson(mixed $value): string
    {
        $json = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return preg_replace_callback('/^( +)/m', static fn(array $m): string => str_repeat(' ', intdiv(\strlen($m[1]), 2)), $json) ?? $json;
    }

    /**
     * @return Manifest
     */
    private static function readManifest(string $dir): array
    {
        $invalid = new \RuntimeException("{$dir}: no valid backup (manifest.json missing or invalid)");
        $raw = @file_get_contents("{$dir}/manifest.json");
        if ($raw === false) {
            throw $invalid;
        }
        try {
            $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw $invalid;
        }
        if (!\is_array($data) || ($data['format'] ?? null) !== self::FORMAT || ($data['version'] ?? null) !== 1
            || !\is_string($data['createdAt'] ?? null) || !\in_array($data['attachmentStorage'] ?? null, ['volume', 's3'], true)
            || !\array_key_exists('migration', $data) || !(\is_string($data['migration']) || $data['migration'] === null)
            || !\is_array($data['files'] ?? null) || !\is_array($data['missingAttachments'] ?? null)) {
            throw $invalid;
        }
        $files = [];
        foreach ($data['files'] as $file) {
            if (!\is_array($file) || !\is_string($file['path'] ?? null) || !\is_int($file['size'] ?? null) || !\is_string($file['sha256'] ?? null)) {
                throw $invalid;
            }
            $files[] = ['path' => $file['path'], 'size' => $file['size'], 'sha256' => $file['sha256']];
        }
        $missing = array_values(array_filter($data['missingAttachments'], \is_string(...)));

        return [
            'format' => self::FORMAT,
            'version' => 1,
            'createdAt' => $data['createdAt'],
            'migration' => $data['migration'],
            'attachmentStorage' => $data['attachmentStorage'],
            'files' => $files,
            'missingAttachments' => $missing,
        ];
    }

    /**
     * @return list<string> relative paths of all files below `$root/$folder`
     */
    private static function walk(string $root, string $folder): array
    {
        $paths = [];
        $entries = scandir($folder === '' ? $root : "{$root}/{$folder}") ?: [];
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $relative = $folder === '' ? $entry : "{$folder}/{$entry}";
            if (is_dir("{$root}/{$relative}")) {
                array_push($paths, ...self::walk($root, $relative));
            } else {
                $paths[] = $relative;
            }
        }

        return $paths;
    }

    private static function mkdir(string $dir): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0o777, true) && !is_dir($dir)) {
            throw new \RuntimeException("Cannot create {$dir}");
        }
    }

    private static function removeTree(string $path): void
    {
        if (is_dir($path) && !is_link($path)) {
            foreach (scandir($path) ?: [] as $entry) {
                if ($entry !== '.' && $entry !== '..') {
                    self::removeTree("{$path}/{$entry}");
                }
            }
            rmdir($path);
        } elseif (file_exists($path) || is_link($path)) {
            unlink($path);
        }
    }
}
