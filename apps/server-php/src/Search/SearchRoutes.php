<?php

declare(strict_types=1);

namespace NotionAlt\Search;

use NotionAlt\Auth\AuthContext;
use NotionAlt\Auth\RequireAuth;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Shared\SearchSchemas;
use NotionAlt\Validation\Validation;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** Port of apps/server/src/search/routes.ts. */
final class SearchRoutes
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
        $api->get('/search', $routes->search(...))->add(new RequireAuth($db));
    }

    /** Server-side full-text search (FTS5) in one of the user's workspaces. */
    private function search(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array{workspaceId: string, q: string} $input */
        $input = Validation::parseInput(SearchSchemas::query(), (object) $request->getQueryParams());
        $userId = AuthContext::of($request)->userId();
        $hits = SearchIndex::searchWorkspace(($this->db)(), $userId, $input['workspaceId'], $input['q']);
        if ($hits === null) {
            throw new HttpError(404, 'not_found', 'Workspace not found');
        }

        return Json::respond($response, ['hits' => $hits]);
    }
}
