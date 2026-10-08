<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\AppFactory;
use NotionAlt\Config\ConfigLoader;
use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Logging\Logger;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;
use Slim\Psr7\Factory\ServerRequestFactory;
use Slim\Psr7\Factory\StreamFactory;

/** Auth details the contract tests cannot see (database contents, legacy hashes). */
final class AuthTest extends TestCase
{
    private \PDO $db;

    protected function setUp(): void
    {
        $this->db = Database::open(':memory:');
        (new Migrator($this->db))->migrateToLatest();
    }

    /** Accounts of the former Node server need a new password (ADR 0018, `bin/console reset-password`). */
    public function testLoginWithANodeHashFails(): void
    {
        Sql::run(
            $this->db,
            "insert into users (id, email, password_hash, created_at) values ('u1', 'node@example.com', ?, '2026-01-01T00:00:00.000Z')",
            [PasswordTest::NODE_HASH],
        );

        $response = $this->post('/api/auth/login', ['email' => 'node@example.com', 'password' => PasswordTest::NODE_PASSWORD]);

        self::assertSame(401, $response->getStatusCode());
        self::assertStringContainsString('"code":"invalid_credentials"', (string) $response->getBody());
        self::assertSame([['password_hash' => PasswordTest::NODE_HASH]], Sql::rows($this->db, "select password_hash from users where id = 'u1'"));
    }

    public function testSessionCookieAndStoredSession(): void
    {
        $response = $this->post('/api/auth/register', ['email' => 'a@example.com', 'password' => 'a long passphrase']);

        self::assertSame(201, $response->getStatusCode());
        $cookie = $response->getHeaderLine('Set-Cookie');
        self::assertMatchesRegularExpression(
            '/^session=([A-Za-z0-9_-]{43}); Path=\/api; Expires=\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT; HttpOnly; SameSite=Strict$/',
            $cookie,
        );
        if (preg_match('/^session=([^;]+)/', $cookie, $match) !== 1) {
            self::fail('no session cookie');
        }
        $session = Sql::rows($this->db, 'select * from sessions')[0];
        self::assertSame(hash('sha256', $match[1]), $session['id']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/', Row::string($session, 'expires_at'));
        $user = Sql::rows($this->db, 'select * from users')[0];
        self::assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', Row::string($user, 'id'));
        self::assertSame(
            [['name' => 'Personal', 'owner_id' => $user['id']]],
            Sql::rows($this->db, 'select name, owner_id from workspaces'),
        );
    }

    public function testSecureCookieWhenConfigured(): void
    {
        $response = $this->post('/api/auth/register', ['email' => 'a@example.com', 'password' => 'a long passphrase'], ['COOKIE_SECURE' => 'true']);

        self::assertStringEndsWith('; SameSite=Strict; Secure', $response->getHeaderLine('Set-Cookie'));
    }

    public function testRateLimitAnswerHasRetryAfter(): void
    {
        for ($i = 0; $i < 3; $i++) {
            self::assertSame(401, $this->post('/api/auth/login', ['email' => 'x@example.com', 'password' => 'wrong'], ['LOGIN_MAX_FAILURES_PER_EMAIL' => '3'])->getStatusCode());
        }
        $blocked = $this->post('/api/auth/login', ['email' => 'x@example.com', 'password' => 'wrong'], ['LOGIN_MAX_FAILURES_PER_EMAIL' => '3']);

        self::assertSame(429, $blocked->getStatusCode());
        $retryAfter = (int) $blocked->getHeaderLine('Retry-After');
        self::assertGreaterThan(0, $retryAfter);
        self::assertSame(
            ['error' => ['code' => 'too_many_attempts', 'message' => 'Too many attempts, try again later', 'retryAfter' => $retryAfter]],
            json_decode((string) $blocked->getBody(), true),
        );
    }

    /**
     * @param array<string, mixed>  $body
     * @param array<string, string> $env
     */
    private function post(string $path, array $body, array $env = []): ResponseInterface
    {
        $db = $this->db;
        $config = ConfigLoader::load(['DATABASE_PATH' => ':memory:'] + $env, __DIR__);
        $app = AppFactory::create($config, new Logger('fatal', static function (): void {}), static fn(): \PDO => $db);
        $json = json_encode($body, JSON_THROW_ON_ERROR);
        $request = (new ServerRequestFactory())->createServerRequest('POST', 'http://localhost' . $path, ['REMOTE_ADDR' => '127.0.0.1'])
            ->withHeader('Content-Type', 'application/json')
            ->withHeader('Content-Length', (string) \strlen($json))
            ->withBody((new StreamFactory())->createStream($json));

        return $app->handle($request);
    }
}
