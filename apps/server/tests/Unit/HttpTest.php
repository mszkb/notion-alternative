<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\AppFactory;
use NotionAlt\Config\ConfigLoader;
use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Http\BasePath;
use NotionAlt\Http\DeferredJson;
use NotionAlt\Http\HttpError;
use NotionAlt\Http\Json;
use NotionAlt\Http\JsonBodyMiddleware;
use NotionAlt\Http\RawBody;
use NotionAlt\Logging\Logger;
use NotionAlt\Shared\AuthSchemas;
use NotionAlt\Validation\Undefined;
use NotionAlt\Validation\Validation;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\App;
use Slim\Psr7\Factory\ServerRequestFactory;
use Slim\Psr7\Factory\StreamFactory;

/** HTTP basics of the API: status codes, error format, bodies, logs. */
final class HttpTest extends TestCase
{
    /** @var list<array<string, mixed>> */
    private array $logs = [];

    /**
     * Log lines written so far (a method, so PHPStan does not keep the narrowed type after a reset).
     *
     * @return list<array<string, mixed>>
     */
    private function logs(): array
    {
        return $this->logs;
    }

    public function testHealth(): void
    {
        $response = $this->request('GET', '/api/health');

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('application/json; charset=utf-8', $response->getHeaderLine('Content-Type'));
        self::assertSame('{"status":"ok"}', (string) $response->getBody());
        self::assertSame(200, $this->request('HEAD', '/api/health')->getStatusCode());
        self::assertSame(200, $this->request('GET', '/api/health?x=1')->getStatusCode());
        // Health checks are not in the info log.
        self::assertSame([], $this->logs);
    }

    public function testReady(): void
    {
        $response = $this->request('GET', '/api/ready');
        self::assertSame(200, $response->getStatusCode());
        self::assertSame('{"status":"ok","checks":{"database":"ok"}}', (string) $response->getBody());

        $broken = $this->app(static fn(): \PDO => throw new \RuntimeException('disk gone'));
        $response = $broken->handle(self::serverRequest('GET', '/api/ready'));
        self::assertSame(503, $response->getStatusCode());
        self::assertSame('{"status":"error","checks":{"database":"error"}}', (string) $response->getBody());
        self::assertSame('readiness check failed', $this->logs[0]['msg'] ?? null);
        self::assertSame(50, $this->logs[0]['level'] ?? null);
    }

    public function testUnknownRoutesAndWrongMethodsAre404(): void
    {
        foreach ([['GET', '/api/unknown'], ['GET', '/'], ['POST', '/api/health'], ['DELETE', '/api/health'], ['OPTIONS', '/api/health'], ['GET', '/api/health/'], ['GET', '/api/HEALTH']] as [$method, $path]) {
            $response = $this->request($method, $path);
            self::assertSame(404, $response->getStatusCode(), "{$method} {$path}");
            self::assertSame('{"error":{"code":"not_found","message":"Not found"}}', (string) $response->getBody());
        }
    }

    /** Routes with their own limit and octet-stream parser (attachment uploads). */
    /** Import: the JSON body is decoded only when the route asks, with the usual errors. */
    public function testDeferredJsonBodies(): void
    {
        $json = ['Content-Type' => 'application/json'];
        self::assertSame('{"deferred":true,"body":{"a":1}}', (string) $this->request('POST', '/api/deferred', '{"a":1}', $json)->getBody());
        $broken = $this->request('POST', '/api/deferred', '{"a"', $json);
        self::assertSame(400, $broken->getStatusCode());
        self::assertSame('{"error":{"code":"bad_request","message":"Body is not valid JSON but content-type is set to \'application/json\'"}}', (string) $broken->getBody());
        self::assertSame(400, $this->request('POST', '/api/deferred', '{"__proto__":{}}', $json)->getStatusCode());
    }

    public function testRawBodyRoutes(): void
    {
        $octet = ['Content-Type' => 'application/octet-stream'];
        self::assertSame('{"raw":"00ff"}', (string) $this->request('PUT', '/api/raw', "\x00\xff", $octet)->getBody());
        // An empty body with this content type is an empty RawBody, not a missing body.
        self::assertSame('{"raw":""}', (string) $this->request('PUT', '/api/raw', '', $octet)->getBody());
        self::assertSame('{"body":"ab"}', (string) $this->request('PUT', '/api/raw', 'ab', ['Content-Type' => 'text/plain'])->getBody());
        // The route's limit applies to every content type.
        foreach ([$octet, ['Content-Type' => 'text/plain']] as $headers) {
            $response = $this->request('PUT', '/api/raw', '12345', $headers);
            self::assertSame(413, $response->getStatusCode());
            self::assertSame('{"error":{"code":"bad_request","message":"Request body is too large"}}', (string) $response->getBody());
        }
        self::assertSame(415, $this->request('PUT', '/api/raw', 'ab', ['Content-Type' => 'image/png'])->getStatusCode());
        // Other routes still refuse octet-stream.
        self::assertSame(415, $this->request('POST', '/api/echo', 'ab', $octet)->getStatusCode());
    }

    public function testRequestLogWithoutQueryString(): void
    {
        $this->request('GET', '/api/unknown?q=secret+words');

        self::assertCount(1, $this->logs);
        $line = $this->logs[0];
        self::assertSame(30, $line['level']);
        self::assertSame('request completed', $line['msg']);
        self::assertSame(['method' => 'GET', 'url' => '/api/unknown'], $line['req']);
        self::assertSame(['statusCode' => 404], $line['res']);
        self::assertIsInt($line['time']);
        self::assertIsNumeric($line['responseTime']);
        self::assertStringNotContainsString('secret', Json::encode($line));
    }

    public function testBodyParsingErrors(): void
    {
        $json = ['Content-Type' => 'application/json'];
        $cases = [
            [$json, '{"a":', 400, '{"error":{"code":"bad_request","message":"Body is not valid JSON but content-type is set to \'application/json\'"}}'],
            [$json, '  ', 400, '{"error":{"code":"bad_request","message":"Body is not valid JSON but content-type is set to \'application/json\'"}}'],
            [$json, '', 400, '{"error":{"code":"bad_request","message":"Body cannot be empty when content-type is set to \'application/json\'"}}'],
            [$json, '{"__proto__":{"x":1}}', 400, '{"error":{"code":"bad_request","message":"Body is not valid JSON but content-type is set to \'application/json\'"}}'],
            [$json, '{"a":[{"constructor":{"prototype":{}}}]}', 400, '{"error":{"code":"bad_request","message":"Body is not valid JSON but content-type is set to \'application/json\'"}}'],
            [$json, Json::encode(['a' => str_repeat('x', 1024 * 1024)]), 413, '{"error":{"code":"bad_request","message":"Request body is too large"}}'],
            [['Content-Type' => 'application/xml'], '<a/>', 415, '{"error":{"code":"bad_request","message":"Unsupported Media Type"}}'],
            [[], 'abc', 415, '{"error":{"code":"bad_request","message":"Unsupported Media Type"}}'],
        ];
        foreach ($cases as [$headers, $body, $status, $expected]) {
            $response = $this->request('POST', '/api/echo', $body, $headers);
            self::assertSame($status, $response->getStatusCode(), $body);
            self::assertSame($expected, (string) $response->getBody(), $body);
        }
    }

    public function testParsedBodies(): void
    {
        $cases = [
            [['Content-Type' => 'application/json; charset=utf-8'], '{"a":[1,"ü/"]}', '{"body":{"a":[1,"ü/"]}}'],
            [['Content-Type' => 'Application/JSON'], 'null', '{"body":null}'],
            [['Content-Type' => 'text/plain'], 'hi', '{"body":"hi"}'],
            [[], '', '{"undefined":true}'],
            [['Content-Type' => 'application/xml'], '', '{"undefined":true}'],
        ];
        foreach ($cases as [$headers, $body, $expected]) {
            $response = $this->request('POST', '/api/echo', $body, $headers);
            self::assertSame(200, $response->getStatusCode(), $body);
            self::assertSame($expected, (string) $response->getBody(), $body);
        }
    }

    public function testValidationErrors(): void
    {
        $response = $this->request('POST', '/api/validate', '{"email":"  NOPE ","password":"short","extra":true}', ['Content-Type' => 'application/json']);
        self::assertSame(400, $response->getStatusCode());
        self::assertSame(
            '{"error":{"code":"invalid_input","message":"Invalid input","issues":[{"path":"email","message":"Invalid email address"},{"path":"password","message":"Too small: expected string to have >=10 characters"}]}}',
            (string) $response->getBody(),
        );

        $response = $this->request('POST', '/api/validate');
        self::assertSame(
            '{"error":{"code":"invalid_input","message":"Invalid input","issues":[{"path":"","message":"Invalid input: expected object, received undefined"}]}}',
            (string) $response->getBody(),
        );
    }

    public function testHttpErrorsAndUnexpectedErrors(): void
    {
        $response = $this->request('GET', '/api/limited');
        self::assertSame(429, $response->getStatusCode());
        self::assertSame('{"error":{"code":"too_many_attempts","message":"Too many attempts, try again later","retryAfter":60}}', (string) $response->getBody());

        $this->logs = [];
        $response = $this->request('GET', '/api/boom');
        self::assertSame(500, $response->getStatusCode());
        self::assertSame('{"error":{"code":"internal","message":"Internal server error"}}', (string) $response->getBody());
        $logs = $this->logs();
        self::assertSame('unhandled error', $logs[0]['msg'] ?? null);
        self::assertSame(50, $logs[0]['level'] ?? null);
        $err = $logs[0]['err'] ?? null;
        self::assertIsArray($err);
        self::assertSame('kaputt', $err['message'] ?? null);
        self::assertSame(['statusCode' => 500], $logs[1]['res'] ?? null);
    }

    public function testBasePath(): void
    {
        $app = $this->app(null, '/notes');
        self::assertSame(200, $app->handle(self::serverRequest('GET', '/notes/api/health'))->getStatusCode());
        self::assertSame(404, $app->handle(self::serverRequest('GET', '/api/health'))->getStatusCode());
    }

    public function testDetectsTheBasePath(): void
    {
        self::assertSame('', BasePath::detect(['SCRIPT_NAME' => '/index.php', 'REQUEST_URI' => '/api/health']));
        self::assertSame('', BasePath::detect(['SCRIPT_NAME' => '/api/index.php', 'REQUEST_URI' => '/api/health']));
        self::assertSame('/notes', BasePath::detect(['SCRIPT_NAME' => '/notes/api/index.php', 'REQUEST_URI' => '/notes/api/health?x=1']));
        self::assertSame('/notes', BasePath::detect(['SCRIPT_NAME' => '/notes/index.php', 'REQUEST_URI' => '/notes/api/health']));
        self::assertSame('', BasePath::detect(['SCRIPT_NAME' => '/other/index.php', 'REQUEST_URI' => '/api/health']));
        self::assertSame('', BasePath::detect([]));
    }

    /**
     * @param array<string, string> $headers
     */
    private function request(string $method, string $path, string $body = '', array $headers = []): ResponseInterface
    {
        return $this->app()->handle(self::serverRequest($method, $path, $body, $headers));
    }

    /**
     * @param (\Closure(): \PDO)|null $db
     *
     * @return App<null>
     */
    private function app(?\Closure $db = null, string $basePath = ''): App
    {
        $logger = new Logger('info', function (string $line): void {
            $decoded = json_decode($line, true, 512, JSON_THROW_ON_ERROR);
            \assert(\is_array($decoded));
            /** @var array<string, mixed> $decoded */
            $this->logs[] = $decoded;
        });
        $db ??= static function (): \PDO {
            $pdo = Database::open(':memory:');
            (new Migrator($pdo))->migrateToLatest();

            return $pdo;
        };
        $app = AppFactory::create(ConfigLoader::load(['DATABASE_PATH' => ':memory:'], __DIR__), $logger, $db, $basePath);
        // Routes for the tests of the shared middleware.
        $app->post('/api/echo', static function (ServerRequestInterface $request, ResponseInterface $response): ResponseInterface {
            $body = JsonBodyMiddleware::body($request);

            return Json::respond($response, $body === Undefined::Value ? ['undefined' => true] : ['body' => $body]);
        });
        $app->post('/api/validate', static function (ServerRequestInterface $request, ResponseInterface $response): ResponseInterface {
            return Json::respond($response, Validation::parseInput(AuthSchemas::registerInput(), JsonBodyMiddleware::body($request)));
        });
        $app->put('/api/raw', static function (ServerRequestInterface $request, ResponseInterface $response): ResponseInterface {
            $body = JsonBodyMiddleware::body($request);

            return Json::respond($response, $body instanceof RawBody ? ['raw' => bin2hex($body->bytes)] : ['body' => $body === Undefined::Value ? null : $body]);
        })->setArguments([JsonBodyMiddleware::BODY_LIMIT => '4', JsonBodyMiddleware::OCTET_STREAM => '1']);
        $app->post('/api/deferred', static function (ServerRequestInterface $request, ResponseInterface $response): ResponseInterface {
            $before = JsonBodyMiddleware::body($request) instanceof DeferredJson;

            return Json::respond($response, ['deferred' => $before, 'body' => JsonBodyMiddleware::decodedBody($request)]);
        })->setArgument(JsonBodyMiddleware::DEFER_JSON, '1');
        $app->get('/api/limited', static fn(): never => throw new HttpError(429, 'too_many_attempts', 'Too many attempts, try again later', ['retryAfter' => 60]));
        $app->get('/api/boom', static fn(): never => throw new \LogicException('kaputt'));

        return $app;
    }

    /**
     * @param array<string, string> $headers
     */
    private static function serverRequest(string $method, string $path, string $body = '', array $headers = []): ServerRequestInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest($method, 'http://localhost' . $path)
            ->withBody((new StreamFactory())->createStream($body));
        foreach ($headers as $name => $value) {
            $request = $request->withHeader($name, $value);
        }
        if ($body !== '') {
            $request = $request->withHeader('Content-Length', (string) \strlen($body));
        }

        return $request;
    }
}
