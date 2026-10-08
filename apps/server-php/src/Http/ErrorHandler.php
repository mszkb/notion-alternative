<?php

declare(strict_types=1);

namespace NotionAlt\Http;

use NotionAlt\Logging\Logger;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Exception\HttpException;
use Slim\Exception\HttpMethodNotAllowedException;
use Slim\Exception\HttpNotFoundException;

/**
 * Error responses as in apps/server/src/app.ts: `HttpError` with its status and code, other 4xx
 * as `bad_request`, unknown routes as 404 `not_found` (also for a wrong method: Fastify has no
 * 405), everything else as a logged 500 `internal`.
 */
final class ErrorHandler
{
    public function __construct(
        private readonly ResponseFactoryInterface $responseFactory,
        private readonly Logger $logger,
    ) {}

    public function __invoke(ServerRequestInterface $request, \Throwable $error): ResponseInterface
    {
        [$status, $body] = $this->describe($error);

        $response = Json::respond($this->responseFactory->createResponse(), ['error' => $body], $status);
        foreach ($error instanceof HttpError ? $error->headers : [] as $name => $value) {
            $response = $response->withHeader($name, $value);
        }

        return $response;
    }

    /**
     * @return array{0: int, 1: array<string, mixed>}
     */
    public function describe(\Throwable $error): array
    {
        if ($error instanceof HttpError) {
            return [$error->statusCode, ['code' => $error->errorCode, 'message' => $error->getMessage()] + $error->details];
        }
        if ($error instanceof HttpNotFoundException || $error instanceof HttpMethodNotAllowedException) {
            return [404, ['code' => 'not_found', 'message' => 'Not found']];
        }
        if ($error instanceof HttpException && $error->getCode() >= 400 && $error->getCode() < 500) {
            return [$error->getCode(), ['code' => 'bad_request', 'message' => $error->getMessage()]];
        }
        $this->logger->error('unhandled error', ['err' => Logger::serializeError($error)]);

        return [500, ['code' => 'internal', 'message' => 'Internal server error']];
    }
}
