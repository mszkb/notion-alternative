<?php

declare(strict_types=1);

namespace NotionAlt\Metrics;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Logging\Logger;

/**
 * Prometheus metrics (text format 0.0.4) of apps/server/src/metrics/, kept in the table `metrics`
 * because PHP holds no counters between requests (ADR 0018). Only active with METRICS_ENABLED;
 * requests are recorded after the response. Labels must have low cardinality and never carry
 * personal data or content: route templates, status codes and fixed enums only.
 */
final class Metrics
{
    public const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

    public const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

    /** Families in the order of the Node registry (process and event-loop gauges have no PHP counterpart). */
    private const FAMILIES = [
        'http_requests_total' => ['counter', 'HTTP requests by method, route template and status code.'],
        'http_request_duration_seconds' => ['histogram', 'HTTP request duration by method and route template.'],
        'sqlite_file_size_bytes' => ['gauge', 'Size of the SQLite database files in bytes.'],
        'sync_push_operations_total' => ['counter', 'Operations received via sync push, by result status.'],
    ];

    /**
     * @param \Closure(): \PDO $db
     */
    public function __construct(
        public readonly bool $enabled,
        private readonly \Closure $db,
        private readonly string $databasePath,
        private readonly ?Logger $logger = null,
    ) {}

    /**
     * @param array<string, string> $labels
     */
    public function inc(string $name, array $labels = [], float $value = 1): void
    {
        if (!$this->enabled) {
            return;
        }
        $this->add([[$name, $labels, $value]]);
    }

    /**
     * One request: counter and duration histogram, written in one statement batch.
     */
    public function request(string $method, string $route, int $status, float $seconds): void
    {
        if (!$this->enabled) {
            return;
        }
        $series = [['http_requests_total', ['method' => $method, 'route' => $route, 'status' => (string) $status], 1.0]];
        $labels = ['method' => $method, 'route' => $route];
        foreach (self::DURATION_BUCKETS as $le) {
            if ($seconds <= $le) {
                $series[] = ['http_request_duration_seconds_bucket', [...$labels, 'le' => self::format($le)], 1.0];
            } else {
                // Present with 0 like in Node, so every bucket of a series is rendered.
                $series[] = ['http_request_duration_seconds_bucket', [...$labels, 'le' => self::format($le)], 0.0];
            }
        }
        $series[] = ['http_request_duration_seconds_bucket', [...$labels, 'le' => '+Inf'], 1.0];
        $series[] = ['http_request_duration_seconds_sum', $labels, $seconds];
        $series[] = ['http_request_duration_seconds_count', $labels, 1.0];
        $this->add($series);
    }

    public function render(): string
    {
        $rows = Sql::rows(($this->db)(), 'select name, labels, value from metrics order by rowid');
        /** @var array<string, list<string>> $lines */
        $lines = [];
        foreach ($rows as $row) {
            $name = Row::string($row, 'name');
            $family = preg_replace('/_(bucket|sum|count)$/D', '', $name) ?? $name;
            if (!isset(self::FAMILIES[$family]) || (self::FAMILIES[$family][0] !== 'histogram' && $family !== $name)) {
                $family = $name;
            }
            $labels = json_decode(Row::string($row, 'labels'), true);
            $value = $row['value'] ?? 0;
            $lines[$family][] = $name . self::labels(\is_array($labels) ? $labels : []) . ' ' . self::format(is_numeric($value) ? (float) $value : 0.0);
        }
        if ($this->databasePath !== ':memory:') {
            $lines['sqlite_file_size_bytes'] = [
                'sqlite_file_size_bytes{file="db"} ' . self::fileSize($this->databasePath),
                'sqlite_file_size_bytes{file="wal"} ' . self::fileSize($this->databasePath . '-wal'),
            ];
        }
        $out = [];
        foreach (self::FAMILIES as $family => [$type, $help]) {
            $out[] = "# HELP {$family} {$help}";
            $out[] = "# TYPE {$family} {$type}";
            // Histogram series: buckets, sum and count per label set, like the Node registry.
            $series = $lines[$family] ?? [];
            if ($type === 'histogram') {
                $series = self::groupHistogram($series);
            }
            array_push($out, ...$series);
        }

        return implode("\n", $out) . "\n";
    }

    /** Like `String(number)` in JavaScript for the values that occur here. */
    public static function format(float $value): string
    {
        if (is_nan($value)) {
            return 'NaN';
        }
        if (is_infinite($value)) {
            return $value > 0 ? '+Inf' : '-Inf';
        }
        // Shortest round-trip digits (serialize_precision -1), then JavaScript's Number#toString rules.
        if (preg_match('/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/D', json_encode($value, JSON_THROW_ON_ERROR), $m) !== 1) {
            return (string) $value;
        }
        $digits = $m[2] . ($m[3] ?? '');
        $point = \strlen($m[2]) + (int) ($m[4] ?? 0);
        while (\strlen($digits) > 1 && $digits[0] === '0') {
            $digits = substr($digits, 1);
            --$point;
        }
        $digits = rtrim($digits, '0');
        if ($digits === '') {
            return '0';
        }
        $k = \strlen($digits);
        $text = match (true) {
            $k <= $point && $point <= 21 => $digits . str_repeat('0', $point - $k),
            0 < $point && $point <= 21 => substr($digits, 0, $point) . '.' . substr($digits, $point),
            -6 < $point && $point <= 0 => '0.' . str_repeat('0', -$point) . $digits,
            default => ($k === 1 ? $digits : $digits[0] . '.' . substr($digits, 1))
                . 'e' . ($point - 1 >= 0 ? '+' : '-') . abs($point - 1),
        };

        return $m[1] . $text;
    }

    /**
     * @param list<array{string, array<string, string>, float}> $series
     */
    private function add(array $series): void
    {
        try {
            $db = ($this->db)();
            $statement = Sql::prepare(
                $db,
                'insert into metrics (name, labels, value) values (?, ?, ?)
                 on conflict (name, labels) do update set value = value + excluded.value',
            );
            $db->exec('begin immediate');
            try {
                foreach ($series as [$name, $labels, $value]) {
                    ksort($labels, SORT_STRING);
                    $statement->execute([$name, json_encode($labels, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_FORCE_OBJECT), $value]);
                }
                $db->exec('commit');
            } catch (\Throwable $error) {
                $db->exec('rollback');

                throw $error;
            }
        } catch (\Throwable $error) {
            // Metrics never break a request.
            $this->logger?->warn('metrics not recorded', ['err' => Logger::serializeError($error)]);
        }
    }

    /**
     * @param array<mixed> $labels
     */
    private static function labels(array $labels): string
    {
        if ($labels === []) {
            return '';
        }
        $parts = [];
        foreach ($labels as $key => $value) {
            $escaped = str_replace(['\\', "\n", '"'], ['\\\\', '\\n', '\\"'], \is_scalar($value) ? (string) $value : '');
            $parts[] = "{$key}=\"{$escaped}\"";
        }

        return '{' . implode(',', $parts) . '}';
    }

    /**
     * Orders histogram lines per label set: all buckets, then sum and count.
     *
     * @param list<string> $lines
     *
     * @return list<string>
     */
    private static function groupHistogram(array $lines): array
    {
        $groups = [];
        foreach ($lines as $line) {
            $key = preg_replace(['/^\w+?_(bucket|sum|count)/', '/,?le="[^"]*"/', '/ \S+$/D'], ['', '', ''], $line) ?? $line;
            $groups[$key][] = $line;
        }
        $out = [];
        foreach ($groups as $group) {
            $rank = static fn(string $line): int => str_contains($line, '_bucket') ? 0 : (str_contains($line, '_sum') ? 1 : 2);
            usort($group, static fn(string $a, string $b): int => $rank($a) <=> $rank($b));
            array_push($out, ...$group);
        }

        return $out;
    }

    private static function fileSize(string $file): int
    {
        $size = @filesize($file);

        return $size === false ? 0 : $size;
    }
}
