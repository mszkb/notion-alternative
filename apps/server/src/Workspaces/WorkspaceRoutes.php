<?php

declare(strict_types=1);

namespace NotionAlt\Workspaces;

use NotionAlt\Auth\AuthContext;
use NotionAlt\Auth\RequireAuth;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Shared\WorkspaceSchemas;
use NotionAlt\Validation\Validation;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** `GET/POST /api/workspaces`, `GET /api/workspaces/:id`. */
final class WorkspaceRoutes
{
    /**
     * @param RouteCollectorProxyInterface<null> $api
     * @param \Closure(): \PDO                   $db
     */
    public static function register(RouteCollectorProxyInterface $api, \Closure $db): void
    {
        $auth = new RequireAuth($db);

        $api->get('/workspaces', static function (ServerRequestInterface $request, ResponseInterface $response) use ($db): ResponseInterface {
            $rows = Workspaces::listForUser($db(), AuthContext::of($request)->userId());

            return Json::respond($response, ['workspaces' => array_map(
                static fn(array $found): array => Workspaces::toWorkspace($found['workspace'], $found['role']),
                $rows,
            )]);
        })->add($auth);

        $api->post('/workspaces', static function (ServerRequestInterface $request, ResponseInterface $response) use ($db): ResponseInterface {
            /** @var array{name: string} $input */
            $input = Validation::parseInput(WorkspaceSchemas::createInput(), JsonBodyMiddleware::body($request));
            $row = Workspaces::insert($db(), AuthContext::of($request)->userId(), $input['name']);

            return Json::respond($response, ['workspace' => Workspaces::toWorkspace($row, 'owner')], 201);
        })->add($auth);

        $api->get('/workspaces/{id}', static function (ServerRequestInterface $request, ResponseInterface $response, array $args) use ($db): ResponseInterface {
            /** @var array{id: string} $params */
            $params = Validation::parseInput(WorkspaceSchemas::params(), $args);
            $found = Workspaces::findWithRole($db(), $params['id'], AuthContext::of($request)->userId());
            // 404 instead of 403: do not reveal whether a foreign workspace exists.
            if ($found === null) {
                throw new HttpError(404, 'not_found', 'Workspace not found');
            }

            return Json::respond($response, ['workspace' => Workspaces::toWorkspace($found['workspace'], $found['role'])]);
        })->add($auth);
    }
}
