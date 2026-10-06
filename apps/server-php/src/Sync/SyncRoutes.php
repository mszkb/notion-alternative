<?php

declare(strict_types=1);

namespace NotionAlt\Sync;

use NotionAlt\Auth\AuthContext;
use NotionAlt\Auth\RequireAuth;
use NotionAlt\Config\AttachmentsConfig;
use NotionAlt\Devices\Devices;
use NotionAlt\Http\Json;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Search\SearchIndex;
use NotionAlt\Shared\SyncSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Validation\Validation;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** Port of apps/server/src/sync/routes.ts (push so far; pull, log and snapshot follow in #122). */
final class SyncRoutes
{
    /**
     * @param \Closure(): \PDO $db
     */
    private function __construct(
        private readonly \Closure $db,
        private readonly AttachmentsConfig $attachments,
    ) {}

    /**
     * @param RouteCollectorProxyInterface<null> $api
     * @param \Closure(): \PDO                   $db
     */
    public static function register(RouteCollectorProxyInterface $api, \Closure $db, AttachmentsConfig $attachments): void
    {
        $routes = new self($db, $attachments);
        $auth = new RequireAuth($db);
        $api->post('/sync/push', $routes->push(...))->add($auth);
    }

    /**
     * Applies operations strictly in the given order, one transaction per batch with a savepoint
     * per operation (#95), so a failure in the middle keeps what was applied; resending is safe
     * (`duplicate`, T-OFF-05).
     */
    private function push(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{operations: list<array<string, mixed>>} $input */
        $input = Validation::parseInput(SyncSchemas::pushInput(), JsonBodyMiddleware::body($request));
        $operations = array_map(Operation::fromInput(...), $input['operations']);
        $userId = AuthContext::of($request)->userId();
        $now = Ids::iso(Ids::nowMs());
        $applied = Apply::batch($db, $userId, $operations, $now, AttachmentLimits::fromConfig($this->attachments));
        $results = [];
        foreach ($applied as $i => $result) {
            $results[] = ['opId' => $operations[$i]->opId, ...$result];
        }
        // Search entries of the changed pages, once per page instead of per operation (#99).
        SearchIndex::reindexMarked($db);
        $deviceIds = array_unique(array_map(static fn(Operation $op): string => $op->deviceId, $operations));
        foreach ($deviceIds as $deviceId) {
            Devices::touch($db, $userId, $deviceId, $now);
        }
        // TODO(#125): tell the owner's other devices that changes are waiting (a hint only,
        // ADR 0005) for each workspace with an applied, merged or conflicting operation.

        return Json::respond($response, ['results' => $results]);
    }
}
