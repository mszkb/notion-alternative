<?php

declare(strict_types=1);

namespace NotionAlt\Push;

use NotionAlt\Auth\AuthContext;
use NotionAlt\Auth\RequireAuth;
use NotionAlt\Config\PushConfig;
use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Http\AfterResponse;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Shared\PushSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Validation\Validation;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** Port of apps/server/src/push/routes.ts. */
final class PushRoutes
{
    /** More than any person has devices; bounds the fan-out of one change. */
    public const MAX_SUBSCRIPTIONS_PER_USER = 20;

    /**
     * @param \Closure(): \PDO $db
     */
    private function __construct(
        private readonly \Closure $db,
        private readonly PushConfig $config,
    ) {}

    /**
     * @param RouteCollectorProxyInterface<null> $api
     * @param \Closure(): \PDO                   $db
     */
    public static function register(RouteCollectorProxyInterface $api, \Closure $db, PushConfig $config): void
    {
        $routes = new self($db, $config);
        $auth = new RequireAuth($db);
        $api->get('/push/public-key', $routes->publicKey(...))->add($auth);
        $api->post('/push/subscriptions', $routes->subscribe(...))->add($auth);
        $api->delete('/push/subscriptions', $routes->unsubscribe(...))->add($auth);
    }

    /**
     * After changes in workspaces (workspace id → device that made them): schedules hints for
     * the owner's other devices and sends them after the response (ADR 0005, a hint only).
     *
     * @param array<string, string> $changed
     */
    public static function afterChanges(\PDO $db, PushConfig $config, AfterResponse $after, array $changed): void
    {
        $scheduled = 0;
        foreach ($changed as $workspaceId => $deviceId) {
            $scheduled += PushNotifier::notify($db, (string) $workspaceId, $deviceId);
        }
        if ($scheduled > 0) {
            $after->add(static fn(bool $finished) => self::deliver($db, $config, $finished));
        }
    }

    /**
     * Sends due hints after the response. A hint bundled into the current window is waited for
     * only when the client already has its response (PHP-FPM); otherwise the next sync request
     * or the cron sends it.
     */
    public static function deliver(\PDO $db, PushConfig $config, bool $mayWait): void
    {
        PushNotifier::flush($db, $config);
        $next = PushNotifier::nextDue($db);
        if ($mayWait && $next !== null && $next - Ids::nowMs() <= PushNotifier::BUNDLE_MS) {
            usleep(max(0, $next - Ids::nowMs()) * 1000);
            PushNotifier::flush($db, $config);
        }
    }

    /** applicationServerKey for PushManager.subscribe(). */
    private function publicKey(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::respond($response, ['publicKey' => PushSettings::vapidKeys(($this->db)())->publicKey]);
    }

    /** Stores the subscription of the current device (after the user agreed in the app). */
    private function subscribe(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array{endpoint: string, keys: array{p256dh: string, auth: string}} $input */
        $input = Validation::parseInput(PushSchemas::subscriptionInput(), JsonBodyMiddleware::body($request));
        $auth = AuthContext::of($request);
        $userId = $auth->userId();
        if ($auth->deviceId === null) {
            throw new HttpError(409, 'device_not_registered', 'Register the device first');
        }
        if (!PushRequest::isAllowedEndpoint($input['endpoint'], $this->config->allowedHosts)) {
            throw new HttpError(400, 'endpoint_not_allowed', 'Push service is not allowed');
        }
        // Keys must work for encryption; checked now rather than failing on every later hint.
        try {
            WebPushCrypto::encrypt('{}', $input['keys']['p256dh'], $input['keys']['auth']);
        } catch (\InvalidArgumentException) {
            throw new HttpError(400, 'invalid_keys', 'Push subscription keys are invalid');
        }
        $db = ($this->db)();
        $existing = Sql::rows($db, 'select user_id from push_subscriptions where endpoint = ?', [$input['endpoint']]);
        // An endpoint belongs to whoever registered it first; it is never moved to another account.
        if ($existing !== [] && Row::string($existing[0], 'user_id') !== $userId) {
            throw new HttpError(409, 'endpoint_taken', 'Subscription belongs to another account');
        }
        if ($existing === []) {
            $count = Sql::rows($db, 'select count(*) as count from push_subscriptions where user_id = ?', [$userId]);
            if (Row::int($count[0] ?? [], 'count') >= self::MAX_SUBSCRIPTIONS_PER_USER) {
                throw new HttpError(409, 'too_many_subscriptions', 'Too many push subscriptions');
            }
        }
        Sql::run(
            $db,
            'insert into push_subscriptions (endpoint, user_id, device_id, p256dh, auth, created_at, last_success_at, failures)
             values (?, ?, ?, ?, ?, ?, null, 0)
             on conflict (endpoint) do update set device_id = excluded.device_id, p256dh = excluded.p256dh,
               auth = excluded.auth, failures = 0',
            [$input['endpoint'], $userId, $auth->deviceId, $input['keys']['p256dh'], $input['keys']['auth'], Ids::iso(Ids::nowMs())],
        );

        return $response->withStatus(204);
    }

    private function unsubscribe(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        /** @var array{endpoint: string} $input */
        $input = Validation::parseInput(PushSchemas::unsubscribeInput(), JsonBodyMiddleware::body($request));
        Sql::run(
            ($this->db)(),
            'delete from push_subscriptions where endpoint = ? and user_id = ?',
            [$input['endpoint'], AuthContext::of($request)->userId()],
        );

        return $response->withStatus(204);
    }
}
