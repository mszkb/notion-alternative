<?php

declare(strict_types=1);

namespace NotionAlt\Http;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Minimum log level of a request's log line. As route middleware,
 * `new LogLevel('warn')` keeps the request line ("request completed", info) of that route out of
 * the log.
 */
final class LogLevel implements MiddlewareInterface
{
    public function __construct(public string $level = 'info') {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $current = $request->getAttribute(RequestLogMiddleware::LOG_LEVEL_ATTRIBUTE);
        if ($current instanceof self) {
            $current->level = $this->level;
        }

        return $handler->handle($request);
    }
}
