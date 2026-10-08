<?php

declare(strict_types=1);

namespace NotionAlt\Http;

use NotionAlt\Logging\Logger;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * One log line per request, like Fastify's "request completed" (method, path, status, time). The
 * query string is left out: search terms are page content and must not end up in logs.
 */
final class RequestLogMiddleware implements MiddlewareInterface
{
    public const LOG_LEVEL_ATTRIBUTE = 'logLevel';

    public function __construct(private readonly Logger $logger) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $start = hrtime(true);
        $level = new LogLevel();
        $response = $handler->handle($request->withAttribute(self::LOG_LEVEL_ATTRIBUTE, $level));
        if ((Logger::LEVELS[$level->level] ?? 0) > Logger::LEVELS['info']) {
            return $response;
        }
        $this->logger->info('request completed', [
            'req' => ['method' => $request->getMethod(), 'url' => $request->getUri()->getPath()],
            'res' => ['statusCode' => $response->getStatusCode()],
            'responseTime' => round((hrtime(true) - $start) / 1e6, 3),
        ]);

        return $response;
    }
}
