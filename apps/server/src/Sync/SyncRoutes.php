<?php

declare(strict_types=1);

namespace NotionAlt\Sync;

use NotionAlt\Auth\AuthContext;
use NotionAlt\Auth\RequireAuth;
use NotionAlt\Config\AttachmentsConfig;
use NotionAlt\Config\PushConfig;
use NotionAlt\Database\Row;
use NotionAlt\Devices\Devices;
use NotionAlt\Http\AfterResponse;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Metrics\Metrics;
use NotionAlt\Push\PushNotifier;
use NotionAlt\Push\PushRoutes;
use NotionAlt\Search\SearchIndex;
use NotionAlt\Shared\SyncSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Validation\Validation;
use NotionAlt\Workspaces\Workspaces;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** Sync API (ADR 0002): push, pull, log, snapshot and page contents on demand (ADR 0017). */
final class SyncRoutes
{
    /**
     * @param \Closure(): \PDO $db
     */
    private function __construct(
        private readonly \Closure $db,
        private readonly AttachmentsConfig $attachments,
        private readonly PushConfig $push,
        private readonly AfterResponse $after,
        private readonly Metrics $metrics,
    ) {}

    /**
     * @param RouteCollectorProxyInterface<null> $api
     * @param \Closure(): \PDO                   $db
     */
    public static function register(RouteCollectorProxyInterface $api, \Closure $db, AttachmentsConfig $attachments, PushConfig $push, AfterResponse $after, Metrics $metrics): void
    {
        $routes = new self($db, $attachments, $push, $after, $metrics);
        $auth = new RequireAuth($db);
        $api->post('/sync/push', $routes->push(...))->add($auth);
        $api->get('/sync/pull', $routes->pull(...))->add($auth);
        $api->get('/sync/log', $routes->log(...))->add($auth);
        $api->get('/sync/snapshot', $routes->snapshot(...))->add($auth);
        $api->get('/sync/documents/{id}', $routes->document(...))->add($auth);
        $api->post('/sync/documents', $routes->documents(...))->add($auth);
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
        // Tell the owner's other devices that changes are waiting (a hint only, ADR 0005).
        $changed = [];
        $statuses = [];
        foreach ($applied as $i => $result) {
            $status = (string) ($result['status'] ?? '');
            $statuses[$status] = ($statuses[$status] ?? 0) + 1;
            if (\in_array($result['status'] ?? null, ['applied', 'merged', 'conflict'], true)) {
                $changed[$operations[$i]->workspaceId] = $operations[$i]->deviceId;
            }
        }
        PushRoutes::afterChanges($db, $this->push, $this->after, $changed);
        if ($this->metrics->enabled) {
            $this->after->add(function () use ($statuses): void {
                foreach ($statuses as $status => $count) {
                    $this->metrics->inc('sync_push_operations_total', ['status' => (string) $status], $count);
                }
            });
        }

        return Json::respond($response, ['results' => $results]);
    }

    /** Delta sync: changes after the cursor, in `seq` order, page by page (ADR 0002). */
    private function pull(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{workspaceId: string, cursor: int, limit: int} $input */
        $input = Validation::parseInput(SyncSchemas::pullQuery(), (object) $request->getQueryParams());
        ['workspaceId' => $workspaceId, 'cursor' => $cursor, 'limit' => $limit] = $input;
        $userId = AuthContext::of($request)->userId();
        $workspace = Workspaces::findForUser($db, $workspaceId, $userId);
        if ($workspace === null) {
            throw new HttpError(404, 'not_found', 'Workspace not found');
        }
        // Devices pull regularly: a good moment to send bundled hints that are due by now.
        $this->after->add(function () use ($db): void {
            PushNotifier::flush($db, $this->push);
        });
        if ($cursor < $workspace['compacted_seq']) {
            // Changes after the cursor are gone: the client needs a full re-sync (snapshot).
            throw new HttpError(410, 'cursor_expired', 'Cursor is older than the change log');
        }
        if ($cursor > Changes::latestSeq($db, $workspaceId, $workspace['compacted_seq'])) {
            // The client saw changes this server does not have (restored from an older backup):
            // its state must be rebuilt from a snapshot, re-sending what the server lost.
            throw new HttpError(410, 'cursor_ahead', 'Cursor is ahead of the change log');
        }

        return Json::respond($response, self::changePage($db, $userId, $workspaceId, $cursor, $limit));
    }

    /**
     * Change log for the JSON export (ADR 0004): like pull, but starts at the oldest change still
     * kept instead of answering `410` after compaction.
     */
    private function log(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{workspaceId: string, cursor: int, limit: int} $input */
        $input = Validation::parseInput(SyncSchemas::logQuery(), (object) $request->getQueryParams());
        ['workspaceId' => $workspaceId, 'cursor' => $cursor, 'limit' => $limit] = $input;
        $userId = AuthContext::of($request)->userId();
        $workspace = Workspaces::findForUser($db, $workspaceId, $userId);
        if ($workspace === null) {
            throw new HttpError(404, 'not_found', 'Workspace not found');
        }

        return Json::respond($response, [
            ...self::changePage($db, $userId, $workspaceId, $cursor, $limit),
            'compactedSeq' => $workspace['compacted_seq'],
        ]);
    }

    /** Full re-sync: complete workspace including tombstones and the matching cursor. */
    private function snapshot(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{workspaceId: string, limit?: int, after?: string, content?: string} $input */
        $input = Validation::parseInput(SyncSchemas::snapshotQuery(), (object) $request->getQueryParams());
        $userId = AuthContext::of($request)->userId();
        $content = ($input['content'] ?? 'true') === 'true';
        // Paged (#97) unless an older client asks for everything at once.
        $snapshot = isset($input['limit'])
            ? Snapshot::loadPage($db, $userId, $input['workspaceId'], $input['limit'], $input['after'] ?? null, $content)
            : Snapshot::load($db, $userId, $input['workspaceId'], $content);
        if ($snapshot === null) {
            throw new HttpError(404, 'not_found', 'Workspace not found');
        }

        return Json::respond($response, $snapshot);
    }

    /**
     * One page with its blocks, for devices that load content on demand (ADR 0017).
     *
     * @param array<string, string> $args
     */
    private function document(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        /** @var array{id: string} $params */
        $params = Validation::parseInput(SyncSchemas::documentParams(), $args);
        /** @var array{workspaceId: string} $query */
        $query = Validation::parseInput(SyncSchemas::documentQuery(), (object) $request->getQueryParams());
        $result = Snapshot::loadDocument(($this->db)(), AuthContext::of($request)->userId(), $query['workspaceId'], $params['id']);
        if ($result === null) {
            throw new HttpError(404, 'not_found', 'Page not found');
        }

        return Json::respond($response, $result);
    }

    /** Several pages at once: "make everything available offline" and re-sync (ADR 0017). */
    private function documents(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array{workspaceId: string, ids: list<string>} $input */
        $input = Validation::parseInput(SyncSchemas::documentsInput(), JsonBodyMiddleware::body($request));
        $result = Snapshot::loadDocuments(($this->db)(), AuthContext::of($request)->userId(), $input['workspaceId'], $input['ids']);
        if ($result === null) {
            throw new HttpError(404, 'not_found', 'Workspace not found');
        }

        return Json::respond($response, $result);
    }

    /**
     * One page of changes after the cursor; one extra row tells whether another page follows.
     *
     * @return array{changes: list<array<string, mixed>>, cursor: int, hasMore: bool}
     */
    private static function changePage(\PDO $db, string $userId, string $workspaceId, int $cursor, int $limit): array
    {
        $rows = Changes::listSince($db, $userId, $workspaceId, $cursor, $limit + 1) ?? [];
        $page = \array_slice($rows, 0, $limit);
        $changes = array_map(Mapping::toChange(...), $page);

        return [
            'changes' => $changes,
            'cursor' => $page === [] ? $cursor : Row::int($page[\count($page) - 1], 'seq'),
            'hasMore' => \count($rows) > $limit,
        ];
    }
}
