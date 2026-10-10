<?php

declare(strict_types=1);

namespace NotionAlt\Sharing;

use NotionAlt\Attachments\AttachmentRoutes;
use NotionAlt\Attachments\ContentStore;
use NotionAlt\Auth\AttemptLimiter;
use NotionAlt\Auth\AuthContext;
use NotionAlt\Auth\RequireAuth;
use NotionAlt\Config\Config;
use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Http\ClientIp;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Shared\AttachmentSchemas;
use NotionAlt\Shared\ShareLinkSchemas;
use NotionAlt\Shared\WorkspaceSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Validation\Validation;
use NotionAlt\Workspaces\Workspaces;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/**
 * Read links (ADR 0022). Members from `editor` up manage them below
 * `/api/workspaces/:id/share-links`; guests read the page below `/api/public/shares/:token`
 * without an account. Every invalid token gets the same 404, failures count per client address.
 *
 * @phpstan-import-type ShareLinkRow from ShareLinks
 */
final class ShareLinkRoutes
{
    /**
     * @param \Closure(): \PDO $db
     */
    private function __construct(
        private readonly \Closure $db,
        private readonly Config $config,
        private readonly ContentStore $store,
    ) {}

    /**
     * @param RouteCollectorProxyInterface<null> $api
     * @param \Closure(): \PDO                   $db
     */
    public static function register(RouteCollectorProxyInterface $api, \Closure $db, Config $config, ContentStore $store): void
    {
        $auth = new RequireAuth($db);
        $routes = new self($db, $config, $store);
        $api->get('/workspaces/{id}/share-links', $routes->list(...))->add($auth);
        $api->post('/workspaces/{id}/share-links', $routes->create(...))->add($auth);
        $api->delete('/workspaces/{id}/share-links/{linkId}', $routes->revoke(...))->add($auth);
        $api->get('/public/shares/{token}', $routes->show(...));
        $api->get('/public/shares/{token}/attachments/{attachmentId}', $routes->image(...));
    }

    /**
     * @param array<string, string> $args
     */
    private function list(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{id: string} $params */
        $params = Validation::parseInput(WorkspaceSchemas::params(), $args);
        /** @var array{documentId?: string} $query */
        $query = Validation::parseInput(ShareLinkSchemas::listQuery(), (object) $request->getQueryParams());
        self::require($db, $params['id'], AuthContext::of($request)->userId());
        $links = ShareLinks::list($db, $params['id'], $query['documentId'] ?? null);

        return Json::respond($response, ['links' => array_map(ShareLinks::toLink(...), $links)]);
    }

    /**
     * @param array<string, string> $args
     */
    private function create(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{id: string} $params */
        $params = Validation::parseInput(WorkspaceSchemas::params(), $args);
        /** @var array{documentId: string, expiresAt: ?string} $input */
        $input = Validation::parseInput(ShareLinkSchemas::createInput(), JsonBodyMiddleware::body($request));
        $userId = AuthContext::of($request)->userId();
        self::require($db, $params['id'], $userId);
        $expiresAt = $input['expiresAt'] === null ? null : self::expiry($input['expiresAt']);
        $page = Sql::rows(
            $db,
            'select 1 from documents where id = ? and workspace_id = ? and deleted_at is null',
            [$input['documentId'], $params['id']],
        );
        if ($page === []) {
            throw new HttpError(404, 'document_not_found', 'Page not found');
        }
        $created = ShareLinks::create($db, $params['id'], $input['documentId'], $userId, $expiresAt);

        return Json::respond($response, ['link' => ShareLinks::toLink($created['row']), 'token' => $created['token']], 201);
    }

    /**
     * @param array<string, string> $args
     */
    private function revoke(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{id: string, linkId: string} $params */
        $params = Validation::parseInput(ShareLinkSchemas::linkParams(), $args);
        self::require($db, $params['id'], AuthContext::of($request)->userId());
        if (!ShareLinks::delete($db, $params['id'], $params['linkId'])) {
            throw new HttpError(404, 'not_found', 'Link not found');
        }

        return $response->withStatus(204);
    }

    /**
     * The shared page for guests.
     *
     * @param array<string, string> $args
     */
    private function show(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $db = ($this->db)();
        $link = $this->resolve($db, $request, $args);

        return self::publicHeaders(Json::respond($response, ShareLinks::page($db, $link)));
    }

    /**
     * An image of the shared page, with the same headers as for members.
     *
     * @param array<string, string> $args
     */
    private function image(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $db = ($this->db)();
        $link = $this->resolve($db, $request, $args);
        /** @var array{id: string} $params */
        $params = Validation::parseInput(AttachmentSchemas::params(), (object) ['id' => $args['attachmentId'] ?? null]);
        $row = ShareLinks::image($db, $link, $params['id']);
        $content = $row === null ? null : $this->store->get($link['workspace_id'], $params['id']);
        if ($row === null || $content === null) {
            throw new HttpError(404, 'not_found', 'Not found');
        }

        return self::publicHeaders($response)
            ->withHeader('Content-Type', Row::string($row, 'mime_type'))
            ->withHeader('Content-Length', (string) Row::int($row, 'size'))
            ->withHeader('Content-Disposition', AttachmentRoutes::disposition('inline', Row::string($row, 'name')))
            ->withHeader('X-Content-Type-Options', 'nosniff')
            ->withHeader('Content-Security-Policy', "sandbox; default-src 'none'")
            ->withBody($content);
    }

    /**
     * The valid link of the token, or 404. Misses count per client address; once over the limit
     * the address gets 429 until the window ends.
     *
     * @param array<string, string> $args
     *
     * @return ShareLinkRow
     */
    private function resolve(\PDO $db, ServerRequestInterface $request, array $args): array
    {
        $ip = ClientIp::of($request, $this->config->trustProxy);
        $limiter = new AttemptLimiter(
            $db,
            'share_ip',
            $this->config->authRateLimit->loginMaxFailuresPerIp,
            $this->config->authRateLimit->windowMinutes * 60_000,
        );
        $retryAfter = $limiter->retryAfter($ip);
        if ($retryAfter > 0) {
            throw new HttpError(429, 'too_many_attempts', 'Too many attempts, try again later', ['retryAfter' => $retryAfter], headers: ['Retry-After' => (string) $retryAfter]);
        }
        $token = ShareLinkSchemas::token()->safeParse($args['token'] ?? null);
        $link = $token->success() && \is_string($token->data) ? ShareLinks::resolve($db, $token->data) : null;
        if ($link === null) {
            $limiter->record($ip);
            throw new HttpError(404, 'not_found', 'Link not found or no longer valid', headers: ['Cache-Control' => 'no-store', 'X-Robots-Tag' => 'noindex, nofollow']);
        }

        return $link;
    }

    /** Never cached, never indexed, no referrer to the links on the page (ADR 0022). */
    private static function publicHeaders(ResponseInterface $response): ResponseInterface
    {
        return $response
            ->withHeader('Cache-Control', 'no-store')
            ->withHeader('X-Robots-Tag', 'noindex, nofollow')
            ->withHeader('Referrer-Policy', 'no-referrer');
    }

    /** Members from `editor` up; 404 for non-members, 403 for readers and commenters. */
    private static function require(\PDO $db, string $workspaceId, string $userId): void
    {
        $found = Workspaces::findWithRole($db, $workspaceId, $userId);
        if ($found === null) {
            throw new HttpError(404, 'not_found', 'Workspace not found');
        }
        if (!Workspaces::atLeast($found['role'], 'editor')) {
            throw new HttpError(403, 'forbidden', 'Only editors and owners may manage read links');
        }
    }

    /** The expiry in epoch ms; it must lie in the future and at most MAX_VALID_DAYS ahead. */
    private static function expiry(string $value): int
    {
        try {
            $ms = (int) (new \DateTimeImmutable($value))->format('Uv');
        } catch (\Exception) {
            $ms = 0;
        }
        $now = Ids::nowMs();
        if ($ms <= $now || $ms > $now + ShareLinkSchemas::MAX_VALID_DAYS * 86_400_000) {
            throw new HttpError(400, 'invalid_input', 'Invalid input', [
                'issues' => [['path' => 'expiresAt', 'message' => 'Must lie in the future, at most ' . ShareLinkSchemas::MAX_VALID_DAYS . ' days ahead']],
            ]);
        }

        return $ms;
    }
}
