<?php

declare(strict_types=1);

namespace NotionAlt\Attachments;

use NotionAlt\Auth\AuthContext;
use NotionAlt\Auth\RequireAuth;
use NotionAlt\Config\AttachmentsConfig;
use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Http\RawBody;
use NotionAlt\Shared\AttachmentSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Sync\Apply;
use NotionAlt\Validation\Validation;
use NotionAlt\Workspaces\Workspaces;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** Port of apps/server/src/attachments/routes.ts (ADR 0012). */
final class AttachmentRoutes
{
    /**
     * @param \Closure(): \PDO $db
     */
    private function __construct(
        private readonly \Closure $db,
        private readonly AttachmentsConfig $config,
        private readonly ContentStore $store,
    ) {}

    /**
     * @param RouteCollectorProxyInterface<null> $api
     * @param \Closure(): \PDO                   $db
     */
    public static function register(RouteCollectorProxyInterface $api, \Closure $db, AttachmentsConfig $config, ContentStore $store): void
    {
        $routes = new self($db, $config, $store);
        $auth = new RequireAuth($db);
        $api->get('/attachments/usage', $routes->usage(...))->add($auth);
        $api->put('/attachments/{id}/content', $routes->upload(...))
            ->add($auth)
            ->setArgument(JsonBodyMiddleware::RAW_BODY_LIMIT, (string) $config->maxBytes);
        $api->get('/attachments/{id}/content', $routes->download(...))->add($auth);
    }

    /** RFC 6266 filename for Content-Disposition, safe for any name. */
    public static function disposition(string $kind, string $name): string
    {
        // One `_` per UTF-16 code unit, like the JavaScript regex in the Node server.
        $fallback = preg_replace_callback(
            '/[^\x20-\x7e]|["\\\\]/u',
            static fn(array $match): string => str_repeat('_', mb_ord($match[0], 'UTF-8') > 0xFFFF ? 2 : 1),
            $name,
        ) ?? '';

        return "{$kind}; filename=\"{$fallback}\"; filename*=UTF-8''" . self::encodeUriComponent($name);
    }

    /** Like JavaScript's `encodeURIComponent`. */
    private static function encodeUriComponent(string $value): string
    {
        return strtr(rawurlencode($value), ['%21' => '!', '%27' => "'", '%28' => '(', '%29' => ')', '%2A' => '*']);
    }

    /** Used storage and limits, so clients can check before adding files (#64). */
    private function usage(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array{workspaceId: string} $input */
        $input = Validation::parseInput(AttachmentSchemas::usageQuery(), (object) $request->getQueryParams());
        $db = ($this->db)();
        if (Workspaces::findForUser($db, $input['workspaceId'], AuthContext::of($request)->userId()) === null) {
            throw new HttpError(404, 'not_found', 'Workspace not found');
        }

        return Json::respond($response, [
            ...Apply::attachmentUsage($db, $input['workspaceId']),
            'quotaBytes' => $this->config->workspaceQuotaBytes,
            'maxFileBytes' => $this->config->maxBytes,
        ]);
    }

    /** Uploads the content once the metadata was synced; size and SHA-256 must match. */
    /**
     * @param array<string, string> $args
     */
    private function upload(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $id = self::id($args);
        $db = ($this->db)();
        $row = $this->findOwn($db, $id, AuthContext::of($request)->userId());
        if ($row['deleted_at'] !== null) {
            throw new HttpError(410, 'deleted', 'Attachment was deleted');
        }
        if ($row['stored_at'] !== null) {
            return $response->withStatus(204);
        }
        $body = JsonBodyMiddleware::body($request);
        if (!$body instanceof RawBody) {
            throw new HttpError(415, 'unsupported_media_type', 'Send application/octet-stream');
        }
        if (\strlen($body->bytes) !== Row::int($row, 'size')) {
            throw new HttpError(400, 'size_mismatch', 'Size differs');
        }
        if (!hash_equals(Row::string($row, 'sha256'), hash('sha256', $body->bytes))) {
            throw new HttpError(400, 'checksum_mismatch', 'Checksum differs');
        }
        $this->store->put(Row::string($row, 'workspace_id'), $id, $body->bytes);
        Sql::run($db, 'update attachments set stored_at = ? where id = ?', [Ids::iso(Ids::nowMs()), $id]);

        return $response->withStatus(204);
    }

    /**
     * Serves the content. Only raster images inline; everything else (SVG, HTML, PDF, …) as a
     * download, never rendered in the app's origin (stored XSS).
     *
     * @param array<string, string> $args
     */
    private function download(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $id = self::id($args);
        $row = $this->findOwn(($this->db)(), $id, AuthContext::of($request)->userId());
        if ($row['stored_at'] === null) {
            throw new HttpError(404, 'not_uploaded', 'Content not uploaded yet or removed');
        }
        $content = $this->store->get(Row::string($row, 'workspace_id'), $id);
        if ($content === null) {
            throw new HttpError(404, 'not_uploaded', 'Content not found in storage');
        }
        $mimeType = Row::string($row, 'mime_type');
        $inline = \in_array($mimeType, AttachmentSchemas::INLINE_IMAGE_TYPES, true);

        return $response
            ->withHeader('Content-Type', $inline ? $mimeType : 'application/octet-stream')
            ->withHeader('Content-Length', (string) Row::int($row, 'size'))
            ->withHeader('Content-Disposition', self::disposition($inline ? 'inline' : 'attachment', Row::string($row, 'name')))
            ->withHeader('X-Content-Type-Options', 'nosniff')
            ->withHeader('Content-Security-Policy', "sandbox; default-src 'none'")
            // Not in the HTTP cache: it would outlive signing out and deleting local data. The app
            // keeps downloaded contents in IndexedDB anyway.
            ->withHeader('Cache-Control', 'no-store')
            ->withBody($content);
    }

    /**
     * @param array<string, string> $args
     */
    private static function id(array $args): string
    {
        /** @var array{id: string} $params */
        $params = Validation::parseInput(AttachmentSchemas::params(), (object) ['id' => $args['id'] ?? null]);

        return $params['id'];
    }

    /**
     * 404 for foreign attachments too: never reveal they exist.
     *
     * @return array<string, mixed>
     */
    private function findOwn(\PDO $db, string $id, string $userId): array
    {
        $rows = Sql::rows(
            $db,
            'select attachments.* from attachments
             inner join workspaces on workspaces.id = attachments.workspace_id
             where attachments.id = ? and workspaces.owner_id = ?',
            [$id, $userId],
        );
        if ($rows === []) {
            throw new HttpError(404, 'not_found', 'Attachment not found');
        }

        return $rows[0];
    }
}
