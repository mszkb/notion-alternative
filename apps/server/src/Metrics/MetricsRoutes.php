<?php

declare(strict_types=1);

namespace NotionAlt\Metrics;

use NotionAlt\Http\LogLevel;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** `GET /api/metrics` (only registered with METRICS_ENABLED). */
final class MetricsRoutes
{
    /**
     * @param RouteCollectorProxyInterface<null> $api
     */
    public static function register(RouteCollectorProxyInterface $api, Metrics $metrics): void
    {
        $api->get('/metrics', static function (ServerRequestInterface $request, ResponseInterface $response) use ($metrics): ResponseInterface {
            $response->getBody()->write($metrics->render());

            return $response->withHeader('Content-Type', Metrics::CONTENT_TYPE);
        })->add(new LogLevel('warn'));
    }
}
