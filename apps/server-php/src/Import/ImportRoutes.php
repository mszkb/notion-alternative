<?php

declare(strict_types=1);

namespace NotionAlt\Import;

use NotionAlt\Auth\AuthContext;
use NotionAlt\Auth\RequireAuth;
use NotionAlt\Config\Config;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Logging\Logger;
use NotionAlt\Shared\ExportSchemas;
use NotionAlt\Validation\Validation;
use NotionAlt\Workspaces\Workspaces;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** `POST /api/import` (ADR 0004). */
final class ImportRoutes
{
    /**
     * @param \Closure(): \PDO $db
     */
    private function __construct(
        private readonly \Closure $db,
        private readonly Config $config,
        private readonly Logger $logger,
        private readonly ImportLock $lock,
    ) {}

    /**
     * @param RouteCollectorProxyInterface<null> $api
     * @param \Closure(): \PDO                   $db
     */
    public static function register(RouteCollectorProxyInterface $api, \Closure $db, Config $config, Logger $logger, ?ImportLock $lock = null): void
    {
        $routes = new self($db, $config, $logger, $lock ?? ImportLock::forDatabase($config->databasePath));
        $api->post('/import', $routes->import(...))
            ->add(new RequireAuth($db))
            ->setArgument(JsonBodyMiddleware::BODY_LIMIT, (string) $config->importMaxBytes);
    }

    /**
     * Imports a JSON export as a new workspace (ADR 0004). Attachment contents follow through
     * the normal upload. `409 ids_exist` if the data is already on this server.
     */
    private function import(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $userId = AuthContext::of($request)->userId();
        // One import at a time: each holds a whole workspace in memory.
        $result = $this->lock->run(function () use ($request, $userId): array {
            /** @var array{name: string, data: array{documents: list<array<string, mixed>>, blocks: list<array<string, mixed>>, tags: list<array<string, mixed>>, document_tags: list<array<string, mixed>>, attachments: list<array<string, mixed>>, history: array{compactedSeq: int, changes: list<array<string, mixed>>}|null}} $input */
            $input = Validation::parseInput(ExportSchemas::importInput(), JsonBodyMiddleware::body($request));

            return Import::workspace(($this->db)(), $userId, $input['name'], $input['data'], $this->config->attachments->workspaceQuotaBytes);
        });
        if ($result === false) {
            throw new HttpError(429, 'import_running', 'Another import is running');
        }
        $row = $result[0];
        $this->logger->info('workspace imported', ['workspaceId' => $row['id']]);

        return Json::respond($response, ['workspace' => Workspaces::toWorkspace($row)], 201);
    }
}
