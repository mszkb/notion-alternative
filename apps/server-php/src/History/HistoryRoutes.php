<?php

declare(strict_types=1);

namespace NotionAlt\History;

use NotionAlt\Auth\AuthContext;
use NotionAlt\Auth\RequireAuth;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Validation\V;
use NotionAlt\Validation\Validation;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** `GET /api/documents/:id/history` and `…/history/:seq` (ADR 0013). */
final class HistoryRoutes
{
    /**
     * @param \Closure(): \PDO $db
     */
    private function __construct(private readonly \Closure $db) {}

    /**
     * @param RouteCollectorProxyInterface<null> $api
     * @param \Closure(): \PDO                   $db
     */
    public static function register(RouteCollectorProxyInterface $api, \Closure $db): void
    {
        $routes = new self($db);
        $auth = new RequireAuth($db);
        $api->get('/documents/{id}/history', $routes->versions(...))->add($auth);
        $api->get('/documents/{id}/history/{seq}', $routes->version(...))->add($auth);
    }

    /**
     * Versions (editing sessions) of a page, newest first (ADR 0013).
     *
     * @param array<string, string> $args
     */
    private function versions(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        /** @var array{id: string} $params */
        $params = Validation::parseInput(V::object(['id' => V::uuid()]), (object) ['id' => $args['id'] ?? null]);
        $workspaceId = self::workspaceId($request);
        $versions = History::listVersions(($this->db)(), AuthContext::of($request)->userId(), $workspaceId, $params['id']);
        if ($versions === null) {
            throw new HttpError(404, 'not_found', 'Page not found');
        }

        return Json::respond($response, ['versions' => $versions]);
    }

    /**
     * The page as it was after change `seq`.
     *
     * @param array<string, string> $args
     */
    private function version(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        /** @var array{id: string, seq: int} $params */
        $params = Validation::parseInput(
            V::object(['id' => V::uuid(), 'seq' => V::coerce(V::int()->min(1))]),
            (object) ['id' => $args['id'] ?? null, 'seq' => $args['seq'] ?? null],
        );
        $workspaceId = self::workspaceId($request);
        $state = History::versionState(($this->db)(), AuthContext::of($request)->userId(), $workspaceId, $params['id'], $params['seq']);
        if ($state === null) {
            throw new HttpError(404, 'not_found', 'Version not found');
        }

        return Json::respond($response, $state);
    }

    private static function workspaceId(ServerRequestInterface $request): string
    {
        /** @var array{workspaceId: string} $query */
        $query = Validation::parseInput(V::object(['workspaceId' => V::uuid()]), (object) $request->getQueryParams());

        return $query['workspaceId'];
    }
}
