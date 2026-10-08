<?php

declare(strict_types=1);

namespace NotionAlt\Auth;

use NotionAlt\Config\Config;
use NotionAlt\Database\Transaction;
use NotionAlt\Devices\Devices;
use NotionAlt\Http\ClientIp;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Logging\Logger;
use NotionAlt\Shared\AuthSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Validation\Undefined;
use NotionAlt\Validation\Validation;
use NotionAlt\Workspaces\Workspaces;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Interfaces\RouteCollectorProxyInterface;

/** Port of apps/server/src/auth/routes.ts. */
final class AuthRoutes
{
    private const DEFAULT_WORKSPACE_NAME = 'Personal';

    /**
     * @param \Closure(): \PDO $db
     */
    private function __construct(
        private readonly \Closure $db,
        private readonly Config $config,
        private readonly Logger $logger,
    ) {}

    /**
     * @param RouteCollectorProxyInterface<null> $api
     * @param \Closure(): \PDO                   $db
     */
    public static function register(RouteCollectorProxyInterface $api, \Closure $db, Config $config, Logger $logger): void
    {
        $routes = new self($db, $config, $logger);
        $auth = new RequireAuth($db);
        $api->get('/auth/status', $routes->status(...));
        $api->post('/auth/register', $routes->registerUser(...));
        $api->post('/auth/login', $routes->login(...));
        $api->post('/auth/logout', $routes->logout(...));
        $api->post('/auth/password', $routes->changePassword(...))->add($auth);
        $api->get('/auth/me', $routes->me(...))->add($auth);
    }

    private function status(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::respond($response, [
            'registrationOpen' => $this->config->allowRegistration || Users::count(($this->db)()) === 0,
        ]);
    }

    private function registerUser(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $db = ($this->db)();
        $ip = ClientIp::of($request);
        $byIp = $this->limiter($db, 'register_ip', $this->config->authRateLimit->registerMaxAttemptsPerIp);
        $this->enforceLimit([[$byIp, $ip]]);
        $byIp->record($ip);
        /** @var array{email: string, password: string} $input */
        $input = Validation::parseInput(AuthSchemas::registerInput(), JsonBodyMiddleware::body($request));
        $passwordHash = Password::hash($input['password']);

        $user = Transaction::run($db, function () use ($db, $input, $passwordHash): array {
            if (!$this->config->allowRegistration && Users::count($db) > 0) {
                throw new HttpError(403, 'registration_closed', 'Registration is closed');
            }
            if (Users::findByEmail($db, $input['email']) !== null) {
                throw new HttpError(409, 'email_taken', 'Email address is already registered');
            }
            $row = Users::insert($db, $input['email'], $passwordHash);
            Workspaces::insert($db, $row['id'], self::DEFAULT_WORKSPACE_NAME);

            return $row;
        });

        $response = $this->startSession($db, $response, $user['id']);
        $this->logger->info('user registered', ['userId' => $user['id']]);

        return Json::respond($response, ['user' => Users::toUser($user)], 201);
    }

    private function login(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{email: string, password: string} $input */
        $input = Validation::parseInput(AuthSchemas::loginInput(), JsonBodyMiddleware::body($request));
        $ip = ClientIp::of($request);
        [$byIp, $byEmail] = $this->loginLimiters($db);
        $this->enforceLimit([[$byIp, $ip], [$byEmail, $input['email']]]);

        $user = Users::findByEmail($db, $input['email']);
        $valid = Password::verify($input['password'], $user['password_hash'] ?? Password::dummyHash());
        if ($user === null || !$valid) {
            $byIp->record($ip);
            $byEmail->record($input['email']);

            throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
        }
        $byEmail->reset($input['email']);
        if (Password::needsRehash($user['password_hash'])) {
            // Lift hashes of older algorithms or options to the current ones.
            Users::updatePasswordHash($db, $user['id'], Password::hash($input['password']));
        }
        $response = $this->startSession($db, $response, $user['id']);

        return Json::respond($response, ['user' => Users::toUser($user)]);
    }

    private function logout(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $body = JsonBodyMiddleware::body($request);
        /** @var array{removeDevice?: bool} $input */
        $input = Validation::parseInput(AuthSchemas::logoutInput(), $body === Undefined::Value || $body === null ? new \stdClass() : $body);
        $token = RequireAuth::token($request);
        if ($token !== null) {
            $db = ($this->db)();
            if ($input['removeDevice'] ?? false) {
                // Shared computer: the device leaves the account as well (ends all its sessions).
                $session = Sessions::findUser($db, $token);
                if ($session !== null && $session['device_id'] !== null) {
                    Devices::revoke($db, $session['id'], $session['device_id'], Ids::iso(Ids::nowMs()));
                }
            }
            Sessions::delete($db, $token);
        }

        return $response
            ->withStatus(204)
            ->withAddedHeader('Set-Cookie', Sessions::COOKIE . '=; Path=/api; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    }

    private function changePassword(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $db = ($this->db)();
        /** @var array{currentPassword: string, newPassword: string} $input */
        $input = Validation::parseInput(AuthSchemas::changePasswordInput(), JsonBodyMiddleware::body($request));
        $auth = AuthContext::of($request);
        $email = $auth->user['email'];
        $ip = ClientIp::of($request);
        // Guessing the current password through a stolen session counts like failed logins.
        [$byIp, $byEmail] = $this->loginLimiters($db);
        $this->enforceLimit([[$byIp, $ip], [$byEmail, $email]]);

        $row = Users::findById($db, $auth->userId());
        if ($row === null || !Password::verify($input['currentPassword'], $row['password_hash'])) {
            $byIp->record($ip);
            $byEmail->record($email);

            throw new HttpError(400, 'invalid_current_password', 'Current password is incorrect');
        }
        $passwordHash = Password::hash($input['newPassword']);
        Transaction::run($db, static function () use ($db, $auth, $passwordHash): void {
            Users::updatePasswordHash($db, $auth->userId(), $passwordHash);
            // Other devices must sign in again; their local data and queues stay intact (local-first).
            Sessions::deleteOthers($db, $auth->userId(), $auth->token);
        });
        $byEmail->reset($email);
        $this->logger->info('password changed', ['userId' => $auth->userId()]);

        return $response->withStatus(204);
    }

    private function me(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::respond($response, ['user' => AuthContext::of($request)->user]);
    }

    private function startSession(\PDO $db, ResponseInterface $response, string $userId): ResponseInterface
    {
        $session = Sessions::create($db, $userId, $this->config->sessionTtlDays);
        $cookie = Sessions::COOKIE . '=' . $session['token']
            . '; Path=/api'
            . '; Expires=' . gmdate('D, d M Y H:i:s', intdiv($session['expiresAt'], 1000)) . ' GMT'
            . '; HttpOnly; SameSite=Strict'
            . ($this->config->cookieSecure ? '; Secure' : '');

        return $response->withAddedHeader('Set-Cookie', $cookie);
    }

    /**
     * @return array{AttemptLimiter, AttemptLimiter} failures per IP and per email
     */
    private function loginLimiters(\PDO $db): array
    {
        $limits = $this->config->authRateLimit;

        return [
            $this->limiter($db, 'login_ip', $limits->loginMaxFailuresPerIp),
            $this->limiter($db, 'login_email', $limits->loginMaxFailuresPerEmail),
        ];
    }

    private function limiter(\PDO $db, string $name, int $max): AttemptLimiter
    {
        return new AttemptLimiter($db, $name, $max, $this->config->authRateLimit->windowMinutes * 60_000);
    }

    /**
     * Rejects with 429 if any of the keys is blocked; same answer whether the account exists.
     *
     * @param list<array{AttemptLimiter, string}> $checks
     */
    private function enforceLimit(array $checks): void
    {
        $retryAfter = 0;
        foreach ($checks as [$limiter, $key]) {
            $retryAfter = max($retryAfter, $limiter->retryAfter($key));
        }
        if ($retryAfter > 0) {
            throw new HttpError(429, 'too_many_attempts', 'Too many attempts, try again later', ['retryAfter' => $retryAfter], headers: ['Retry-After' => (string) $retryAfter]);
        }
    }
}
