<?php

declare(strict_types=1);

namespace NotionAlt\Metrics;

use NotionAlt\Http\AfterResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Interfaces\RouteInterface;
use Slim\Routing\RouteContext;

/**
 * Counts every request with its route template (never the concrete path), like the `onResponse`
 * hook of the Node server. Added twice: outside the error middleware (sees the final status) and
 * innermost with `$inner = true` (sees the matched route).
 */
final class MetricsMiddleware implements MiddlewareInterface
{
    private const ATTRIBUTE = 'notion-alt.metrics-route';

    public function __construct(
        private readonly Metrics $metrics,
        private readonly AfterResponse $after,
        private readonly bool $inner = false,
    ) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if (!$this->metrics->enabled) {
            return $handler->handle($request);
        }
        if ($this->inner) {
            $holder = $request->getAttribute(self::ATTRIBUTE);
            $route = $request->getAttribute(RouteContext::ROUTE);
            if ($holder instanceof \ArrayObject && $route instanceof RouteInterface) {
                // `/api/workspaces/{id}` → `/api/workspaces/:id`, as Fastify names it.
                $holder['route'] = preg_replace('/\{(\w+)\}/', ':$1', $route->getPattern());
            }

            return $handler->handle($request);
        }
        $start = hrtime(true);
        /** @var \ArrayObject<string, string|null> $holder */
        $holder = new \ArrayObject(['route' => null]);
        $response = $handler->handle($request->withAttribute(self::ATTRIBUTE, $holder));
        $seconds = (hrtime(true) - $start) / 1e9;
        $method = $request->getMethod();
        $route = $holder['route'] ?? 'unmatched';
        $status = $response->getStatusCode();
        $this->after->add(function () use ($method, $route, $status, $seconds): void {
            $this->metrics->request($method, $route, $status, $seconds);
        });

        return $response;
    }
}
