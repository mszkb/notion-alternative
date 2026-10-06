<?php

declare(strict_types=1);

namespace NotionAlt\Devices;

use NotionAlt\Auth\AuthContext;
use NotionAlt\Auth\RequireAuth;
use NotionAlt\Auth\Sessions;
use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Database\Transaction;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Logging\Logger;
use NotionAlt\Shared\DeviceSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Validation\Validation;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** Port of apps/server/src/devices/routes.ts. */
final class DeviceRoutes
{
    /**
     * @param \Closure(): \PDO $db
     */
    private function __construct(
        private readonly \Closure $db,
        private readonly Logger $logger,
    ) {}

    /**
     * @param RouteCollectorProxyInterface<null> $api
     * @param \Closure(): \PDO                   $db
     */
    public static function register(RouteCollectorProxyInterface $api, \Closure $db, Logger $logger): void
    {
        $routes = new self($db, $logger);
        $auth = new RequireAuth($db);
        $api->post('/devices', $routes->registerDevice(...))->add($auth);
        $api->get('/devices', $routes->list(...))->add($auth);
        $api->patch('/devices/{id}', $routes->rename(...))->add($auth);
        $api->delete('/devices/{id}', $routes->remove(...))->add($auth);
    }

    /**
     * Idempotent registration on every app start (also after starting offline). Links the
     * session to the device; the stored name wins over the client's default name.
     */
    private function registerDevice(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{id: string, name: string} $input */
        $input = Validation::parseInput(DeviceSchemas::registerInput(), JsonBodyMiddleware::body($request));
        $auth = AuthContext::of($request);
        $userId = $auth->userId();
        $sessionId = Sessions::id($auth->token);
        $now = Ids::iso(Ids::nowMs());

        $known = Devices::findById($db, $input['id']);
        if ($known !== null && $known['revoked_at'] !== null && $known['user_id'] === $userId) {
            $session = Sql::rows($db, 'select created_at from sessions where id = ?', [$sessionId]);
            if ($session === [] || Row::string($session[0], 'created_at') <= $known['revoked_at']) {
                // Removing a device ends its sessions; one it never registered with (signed in, then
                // offline) ends now, so only signing in again gets past a removal (#46).
                Sql::run($db, 'delete from sessions where id = ?', [$sessionId]);

                throw new HttpError(401, 'unauthorized', 'This device was removed; sign in again');
            }
        }

        [$row, $created] = Transaction::run($db, static function () use ($db, $input, $userId, $sessionId, $now): array {
            $existing = Devices::findById($db, $input['id']);
            if ($existing !== null && $existing['user_id'] !== $userId) {
                // Ids are random per browser profile and user; a clash means a forged or copied id.
                throw new HttpError(409, 'device_conflict', 'Device id belongs to another account');
            }
            if ($existing !== null && $existing['revoked_at'] !== null) {
                // Signed in again after the removal: the client continues under a new id (#46).
                throw new HttpError(403, 'device_revoked', 'This device was removed from the account');
            }
            if ($existing !== null) {
                Devices::touch($db, $userId, $existing['id'], $now);
            } else {
                Devices::insert($db, $userId, $input['id'], $input['name'], $now);
            }
            Devices::linkSession($db, $sessionId, $input['id']);
            $row = Devices::findById($db, $input['id']) ?? throw new \LogicException('device vanished');

            return [$row, $existing === null];
        });
        if ($created) {
            $this->logger->info('device registered', ['userId' => $userId, 'deviceId' => $row['id']]);
        }

        return Json::respond($response, ['device' => Devices::toDevice($row, $row['id'])], $created ? 201 : 200);
    }

    private function list(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $auth = AuthContext::of($request);
        $devices = array_map(
            static fn(array $row): array => Devices::toDevice($row, $auth->deviceId),
            Devices::listForUser(($this->db)(), $auth->userId()),
        );

        return Json::respond($response, ['devices' => $devices]);
    }

    /**
     * @param array<string, string> $args
     */
    private function rename(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{id: string} $params */
        $params = Validation::parseInput(DeviceSchemas::params(), $args);
        /** @var array{name: string} $input */
        $input = Validation::parseInput(DeviceSchemas::renameInput(), JsonBodyMiddleware::body($request));
        $auth = AuthContext::of($request);
        if (!Devices::rename($db, $auth->userId(), $params['id'], $input['name'])) {
            throw new HttpError(404, 'not_found', 'Device not found');
        }
        $row = Devices::findById($db, $params['id']) ?? throw new HttpError(404, 'not_found', 'Device not found');

        return Json::respond($response, ['device' => Devices::toDevice($row, $auth->deviceId)]);
    }

    /**
     * @param array<string, string> $args
     */
    private function remove(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        /** @var array{id: string} $params */
        $params = Validation::parseInput(DeviceSchemas::params(), $args);
        $auth = AuthContext::of($request);
        if ($params['id'] === $auth->deviceId) {
            // Removing the device in use would lock it out of syncing its own queue: sign out instead.
            throw new HttpError(409, 'current_device', 'The current device cannot be removed');
        }
        if (!Devices::revoke(($this->db)(), $auth->userId(), $params['id'], Ids::iso(Ids::nowMs()))) {
            throw new HttpError(404, 'not_found', 'Device not found');
        }
        $this->logger->info('device removed', ['userId' => $auth->userId(), 'deviceId' => $params['id']]);

        return $response->withStatus(204);
    }
}
