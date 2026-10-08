<?php

declare(strict_types=1);

namespace NotionAlt\Cli;

use NotionAlt\Attachments\S3Client;
use NotionAlt\Attachments\S3Store;
use NotionAlt\Attachments\VolumeStore;
use NotionAlt\Auth\Password;
use NotionAlt\Auth\Users;
use NotionAlt\Config\Config;
use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Http\Json;
use NotionAlt\Metrics\Metrics;
use NotionAlt\Shared\AuthSchemas;
use NotionAlt\Support\Ids;

/**
 * Commands of `bin/console` (one-off commands of apps/server/src/index.ts plus a password reset,
 * ADR 0018). Output is one JSON line on stdout, errors go to stderr; returns the exit code.
 */
final class Console
{
    public const USAGE = <<<'TXT'
        Usage: bin/console <command>
          migrate                         apply pending database migrations
          backup [target dir]             back up database and attachments (default: <data>/backups)
          restore <backup dir> [--force]  restore a backup (stop serving the app first)
          migrate-attachments-to-s3       copy attachment files from the volume to S3
          reset-password <email>          set a new password (read from stdin, or generated) and end all sessions
          metrics                         print the Prometheus metrics (METRICS_ENABLED)
        TXT;

    /** @var resource */
    private $stdout;

    /** @var resource */
    private $stderr;

    /** @var resource */
    private $stdin;

    /**
     * @param resource|null $stdout
     * @param resource|null $stderr
     * @param resource|null $stdin
     */
    public function __construct(private readonly Config $config, $stdout = null, $stderr = null, $stdin = null)
    {
        $this->stdout = $stdout ?? STDOUT;
        $this->stderr = $stderr ?? STDERR;
        $this->stdin = $stdin ?? STDIN;
    }

    /**
     * @param list<string> $args arguments after the script name
     */
    public function run(array $args): int
    {
        $command = $args[0] ?? '';
        $rest = \array_slice($args, 1);
        try {
            return match ($command) {
                'migrate' => $this->migrate(),
                'backup' => $this->backup($rest),
                'restore' => $this->restore($rest),
                'migrate-attachments-to-s3' => $this->migrateToS3(),
                'reset-password' => $this->resetPassword($rest),
                'metrics' => $this->metrics(),
                default => $this->usage(),
            };
        } catch (\Throwable $error) {
            fwrite($this->stderr, $error->getMessage() . "\n");

            return 1;
        }
    }

    private function migrate(): int
    {
        Database::assertFts5();
        $applied = (new Migrator(Database::open($this->config->databasePath)))->migrateToLatest();

        return $this->out(['migrations' => $applied]);
    }

    /**
     * @param list<string> $args
     */
    private function backup(array $args): int
    {
        $target = $args[0] ?? \dirname($this->config->databasePath) . '/backups';
        ['dir' => $dir, 'manifest' => $manifest] = Backup::create($this->config, $target);

        return $this->out(['dir' => $dir, 'files' => \count($manifest['files']), 'missing' => $manifest['missingAttachments']]);
    }

    /**
     * @param list<string> $args
     */
    private function restore(array $args): int
    {
        $dirs = array_values(array_filter($args, static fn(string $arg): bool => !str_starts_with($arg, '--')));
        if ($dirs === []) {
            fwrite($this->stderr, "Usage: restore <backup dir> [--force]\n");

            return 2;
        }
        $report = Backup::restore($this->config, $dirs[0], \in_array('--force', $args, true));

        return $this->out(['restored' => $dirs[0], 'attachments' => $report['attachments']]);
    }

    /** Copies every stored attachment to S3 and verifies the checksum (#63); idempotent. */
    private function migrateToS3(): int
    {
        $s3 = $this->config->attachments->s3;
        if ($s3 === null) {
            fwrite($this->stderr, "Set ATTACHMENT_STORAGE=s3 and the S3_* variables first.\n");

            return 1;
        }
        $db = $this->open();
        $from = new VolumeStore($this->config->attachments->dir);
        $to = new S3Store(new S3Client($s3));
        $report = ['copied' => 0, 'skipped' => 0, 'failed' => []];
        foreach (Sql::rows($db, 'select id, workspace_id, sha256 from attachments where stored_at is not null') as $row) {
            $id = Row::string($row, 'id');
            $workspaceId = Row::string($row, 'workspace_id');
            $source = $from->get($workspaceId, $id);
            if ($source === null) {
                ++$report['skipped'];

                continue;
            }
            $data = (string) $source;
            if (hash('sha256', $data) !== Row::string($row, 'sha256')) {
                $report['failed'][] = $id;

                continue;
            }
            $to->put($workspaceId, $id, $data);
            $copy = $to->get($workspaceId, $id);
            if ($copy !== null && hash('sha256', (string) $copy) === Row::string($row, 'sha256')) {
                ++$report['copied'];
            } else {
                $report['failed'][] = $id;
            }
        }
        $this->out($report);

        return $report['failed'] === [] ? 0 : 1;
    }

    /**
     * New password for an account (e.g. after the switch from Node, whose scrypt hashes are not
     * taken over, ADR 0018). Ends all sessions of the account.
     *
     * @param list<string> $args
     */
    private function resetPassword(array $args): int
    {
        $email = mb_strtolower(trim($args[0] ?? ''), 'UTF-8');
        if ($email === '') {
            fwrite($this->stderr, "Usage: reset-password <email>\n");

            return 2;
        }
        $db = $this->open();
        $user = Users::findByEmail($db, $email);
        if ($user === null) {
            fwrite($this->stderr, "No account with this email address.\n");

            return 1;
        }
        $generated = false;
        $password = $this->isInteractive() ? '' : rtrim((string) fgets($this->stdin), "\r\n");
        if ($password === '') {
            $password = Ids::base64Url(random_bytes(15));
            $generated = true;
        }
        $check = AuthSchemas::password()->safeParse($password);
        if (!$check->success()) {
            fwrite($this->stderr, 'Password does not meet the policy: ' . ($check->issues[0]->message ?? '') . "\n");

            return 1;
        }
        Users::updatePasswordHash($db, $user['id'], Password::hash($password));
        $sessions = Sql::run($db, 'delete from sessions where user_id = ?', [$user['id']])->rowCount();

        return $this->out($generated
            ? ['email' => $email, 'password' => $password, 'endedSessions' => $sessions]
            : ['email' => $email, 'endedSessions' => $sessions]);
    }

    /** The text of `GET /api/metrics`, e.g. for node_exporter's textfile collector. */
    private function metrics(): int
    {
        $db = $this->open();
        fwrite($this->stdout, (new Metrics(true, static fn(): \PDO => $db, $this->config->databasePath))->render());

        return 0;
    }

    private function isInteractive(): bool
    {
        return stream_isatty($this->stdin);
    }

    private function open(): \PDO
    {
        Database::assertFts5();
        $db = Database::open($this->config->databasePath);
        (new Migrator($db))->migrateToLatest();

        return $db;
    }

    /**
     * @param array<string, mixed> $data
     */
    private function out(array $data): int
    {
        fwrite($this->stdout, Json::encode($data) . "\n");

        return 0;
    }

    private function usage(): int
    {
        fwrite($this->stderr, self::USAGE . "\n");

        return 2;
    }
}
