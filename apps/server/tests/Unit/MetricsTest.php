<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Metrics\Metrics;
use NotionAlt\Tests\TempDir;
use PHPUnit\Framework\TestCase;

/** Prometheus text from the `metrics` table (#127). */
final class MetricsTest extends TestCase
{
    use TempDir;

    public function testCountsAcrossInstancesAndRendersPrometheusText(): void
    {
        $path = $this->tempDir() . '/app.sqlite';
        $db = Database::open($path);
        (new Migrator($db))->migrateToLatest();
        $open = static fn(): \PDO => $db;
        // Two requests are two PHP processes: each its own Metrics instance.
        (new Metrics(true, $open, $path))->request('GET', '/api/workspaces/:id', 200, 0.25);
        $metrics = new Metrics(true, $open, $path);
        $metrics->request('GET', '/api/workspaces/:id', 200, 0.5);
        $metrics->inc('sync_push_operations_total', ['status' => 'applied'], 3);
        (new Metrics(false, $open, $path))->inc('sync_push_operations_total', ['status' => 'applied']);

        $text = $metrics->render();
        self::assertStringStartsWith("# HELP http_requests_total HTTP requests by method, route template and status code.\n# TYPE http_requests_total counter\n", $text);
        self::assertStringContainsString("http_requests_total{method=\"GET\",route=\"/api/workspaces/:id\",status=\"200\"} 2\n", $text);
        self::assertStringContainsString("http_request_duration_seconds_bucket{le=\"0.1\",method=\"GET\",route=\"/api/workspaces/:id\"} 0\n"
            . "http_request_duration_seconds_bucket{le=\"0.25\",method=\"GET\",route=\"/api/workspaces/:id\"} 1\n", $text);
        self::assertStringContainsString("http_request_duration_seconds_bucket{le=\"+Inf\",method=\"GET\",route=\"/api/workspaces/:id\"} 2\n"
            . "http_request_duration_seconds_sum{method=\"GET\",route=\"/api/workspaces/:id\"} 0.75\n"
            . "http_request_duration_seconds_count{method=\"GET\",route=\"/api/workspaces/:id\"} 2\n", $text);
        self::assertMatchesRegularExpression('/^sqlite_file_size_bytes\{file="db"\} [1-9]\d*$/m', $text);
        self::assertStringEndsWith("# TYPE sync_push_operations_total counter\nsync_push_operations_total{status=\"applied\"} 3\n", $text);
        // As `String(n)` in JavaScript.
        self::assertSame(
            ['0.005', '1', '+Inf', '1e-7', '0.00001', '0.30000000000000004', '123.5', '1e+21', '-2.5', '0', '100'],
            array_map(Metrics::format(...), [0.005, 1.0, INF, 1e-7, 0.00001, 0.1 + 0.2, 123.5, 1e21, -2.5, 0.0, 100.0]),
        );
    }
}
