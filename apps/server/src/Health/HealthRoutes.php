<?php

declare(strict_types=1);

namespace NotionAlt\Health;

use NotionAlt\Http\Json;
use NotionAlt\Http\LogLevel;
use NotionAlt\Logging\Logger;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** Liveness (`/api/health`) and readiness with database check (`/api/ready`). */
final class HealthRoutes
{
    /**
     * @param RouteCollectorProxyInterface<null> $api
     * @param \Closure(): \PDO                                                   $db
     */
    public static function register(RouteCollectorProxyInterface $api, \Closure $db, Logger $logger): void
    {
        // Liveness: the process is up and serving requests.
        $api->get('/health', static fn(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface => Json::respond($response, ['status' => 'ok']))
            ->add(new LogLevel('warn'));

        // Readiness: dependencies (database) are usable.
        $api->get('/ready', static function (ServerRequestInterface $request, ResponseInterface $response) use ($db, $logger): ResponseInterface {
            try {
                $db()->query('select 1');

                return Json::respond($response, ['status' => 'ok', 'checks' => ['database' => 'ok']]);
            } catch (\Throwable $error) {
                $logger->error('readiness check failed', ['err' => Logger::serializeError($error)]);

                return Json::respond($response, ['status' => 'error', 'checks' => ['database' => 'error']], 503);
            }
        })->add(new LogLevel('warn'));
    }
}
