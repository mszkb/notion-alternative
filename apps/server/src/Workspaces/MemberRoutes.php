<?php

declare(strict_types=1);

namespace NotionAlt\Workspaces;

use NotionAlt\Auth\AuthContext;
use NotionAlt\Auth\RequireAuth;
use NotionAlt\Auth\Users;
use NotionAlt\Database\Transaction;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Shared\WorkspaceSchemas;
use NotionAlt\Validation\Validation;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/**
 * Members of a workspace (ADR 0014): `GET/POST /api/workspaces/:id/members`,
 * `PATCH/DELETE /api/workspaces/:id/members/:userId`. Everyone sees the members; only owners
 * add, change and remove them; every member except the creator may leave.
 *
 * @phpstan-import-type WorkspaceRow from Workspaces
 */
final class MemberRoutes
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
        $auth = new RequireAuth($db);
        $routes = new self($db);
        $api->get('/workspaces/{id}/members', $routes->list(...))->add($auth);
        $api->post('/workspaces/{id}/members', $routes->add(...))->add($auth);
        $api->patch('/workspaces/{id}/members/{userId}', $routes->update(...))->add($auth);
        $api->delete('/workspaces/{id}/members/{userId}', $routes->remove(...))->add($auth);
    }

    /**
     * @param array<string, string> $args
     */
    private function list(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{id: string} $params */
        $params = Validation::parseInput(WorkspaceSchemas::params(), $args);
        self::require($db, $params['id'], AuthContext::of($request)->userId(), 'reader');

        return Json::respond($response, ['members' => Members::list($db, $params['id'])]);
    }

    /**
     * Adds an existing account of this installation by e-mail address; no mail is sent.
     *
     * @param array<string, string> $args
     */
    private function add(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{id: string} $params */
        $params = Validation::parseInput(WorkspaceSchemas::params(), $args);
        /** @var array{email: string, role: string} $input */
        $input = Validation::parseInput(WorkspaceSchemas::addMemberInput(), JsonBodyMiddleware::body($request));
        $workspace = self::require($db, $params['id'], AuthContext::of($request)->userId(), 'owner');
        $user = Users::findByEmail($db, $input['email']);
        if ($user === null) {
            throw new HttpError(404, 'user_not_found', 'No account with this e-mail address on this server');
        }
        if ($user['id'] === $workspace['owner_id'] || !Members::add($db, $params['id'], $user['id'], $input['role'])) {
            throw new HttpError(409, 'already_member', 'The account already is a member');
        }

        return Json::respond($response, ['member' => Members::find($db, $params['id'], $user['id'])], 201);
    }

    /**
     * @param array<string, string> $args
     */
    private function update(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{id: string, userId: string} $params */
        $params = Validation::parseInput(WorkspaceSchemas::memberParams(), $args);
        /** @var array{role: string} $input */
        $input = Validation::parseInput(WorkspaceSchemas::updateMemberInput(), JsonBodyMiddleware::body($request));
        $member = Transaction::run($db, static function () use ($db, $params, $input, $request): array {
            self::require($db, $params['id'], AuthContext::of($request)->userId(), 'owner');
            self::changeable($db, $params['id'], $params['userId']);
            Members::setRole($db, $params['id'], $params['userId'], $input['role']);

            return Members::find($db, $params['id'], $params['userId']) ?? [];
        });

        return Json::respond($response, ['member' => $member]);
    }

    /**
     * Removes a member (owners) or leaves the workspace (every member but the creator). Copies
     * on the member's devices stay there: they cannot be deleted reliably (offline-first).
     *
     * @param array<string, string> $args
     */
    private function remove(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{id: string, userId: string} $params */
        $params = Validation::parseInput(WorkspaceSchemas::memberParams(), $args);
        $userId = AuthContext::of($request)->userId();
        Transaction::run($db, static function () use ($db, $params, $userId): void {
            self::require($db, $params['id'], $userId, $params['userId'] === $userId ? 'reader' : 'owner');
            self::changeable($db, $params['id'], $params['userId']);
            Members::remove($db, $params['id'], $params['userId']);
        });

        return $response->withStatus(204);
    }

    /**
     * The workspace if the user has at least `$minimum`: 404 for non-members (never reveal a
     * foreign workspace), 403 for members with a lower role.
     *
     * @return WorkspaceRow
     */
    private static function require(\PDO $db, string $workspaceId, string $userId, string $minimum): array
    {
        $found = Workspaces::findWithRole($db, $workspaceId, $userId);
        if ($found === null) {
            throw new HttpError(404, 'not_found', 'Workspace not found');
        }
        if (!Workspaces::atLeast($found['role'], $minimum)) {
            throw new HttpError(403, 'forbidden', 'Only owners may manage members');
        }

        return $found['workspace'];
    }

    /** The member exists and is not the creator, whose role is fixed. */
    private static function changeable(\PDO $db, string $workspaceId, string $userId): void
    {
        $member = Members::find($db, $workspaceId, $userId);
        if ($member === null) {
            throw new HttpError(404, 'not_found', 'Member not found');
        }
        if ($member['creator']) {
            throw new HttpError(409, 'creator_fixed', 'The creator of a workspace stays its owner');
        }
    }
}
