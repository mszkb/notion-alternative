<?php

declare(strict_types=1);

namespace NotionAlt\Logging;

/**
 * JSON lines in the format of the Node server's logger (pino): numeric `level`, `time` in
 * milliseconds, `msg`, plus fields. Written to stderr (CLI, built-in server) or `error_log()`.
 */
class Logger
{
    public const LEVELS = [
        'trace' => 10,
        'debug' => 20,
        'info' => 30,
        'warn' => 40,
        'error' => 50,
        'fatal' => 60,
        'silent' => PHP_INT_MAX,
    ];

    private readonly int $threshold;

    /** @var (callable(string): void)|null */
    private $writer;

    /**
     * @param (callable(string): void)|null $writer receives each line without newline (tests)
     */
    public function __construct(string $level = 'info', ?callable $writer = null)
    {
        $this->threshold = self::LEVELS[$level] ?? self::LEVELS['info'];
        $this->writer = $writer;
    }

    public function isEnabled(string $level): bool
    {
        return (self::LEVELS[$level] ?? 0) >= $this->threshold && $level !== 'silent';
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function log(string $level, string $msg, array $fields = []): void
    {
        if (!$this->isEnabled($level)) {
            return;
        }
        $line = ['level' => self::LEVELS[$level], 'time' => (int) floor(microtime(true) * 1000), 'pid' => getmypid()]
            + $fields
            + ['msg' => $msg];
        $this->write(json_encode($line, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR) ?: '{}');
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function info(string $msg, array $fields = []): void
    {
        $this->log('info', $msg, $fields);
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function warn(string $msg, array $fields = []): void
    {
        $this->log('warn', $msg, $fields);
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function error(string $msg, array $fields = []): void
    {
        $this->log('error', $msg, $fields);
    }

    /**
     * Serializes an exception like pino's `err` field.
     *
     * @return array{type: string, message: string, stack: string}
     */
    public static function serializeError(\Throwable $error): array
    {
        return [
            'type' => $error::class,
            'message' => $error->getMessage(),
            'stack' => $error::class . ': ' . $error->getMessage() . "\n" . $error->getTraceAsString(),
        ];
    }

    private function write(string $line): void
    {
        if ($this->writer !== null) {
            ($this->writer)($line);

            return;
        }
        if (\PHP_SAPI === 'cli' || \PHP_SAPI === 'cli-server') {
            file_put_contents('php://stderr', $line . "\n");

            return;
        }
        error_log($line);
    }
}
