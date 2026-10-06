<?php

declare(strict_types=1);

namespace NotionAlt\Http;

use NotionAlt\Validation\Undefined;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Parses request bodies like Fastify's default content-type parsers: `application/json` (decoded
 * with objects as `stdClass`) and `text/plain` (string); other types with a body are 415. The
 * decoded body is in the request attribute `body` (read it with {@see self::body()}); a request
 * without body has none, like `request.body === undefined`.
 */
final class JsonBodyMiddleware implements MiddlewareInterface
{
    public const ATTRIBUTE = 'body';

    /** Fastify's default `bodyLimit` as set in apps/server/src/app.ts. */
    public const DEFAULT_LIMIT = 1024 * 1024;

    private const INVALID_JSON = "Body is not valid JSON but content-type is set to 'application/json'";

    /** Methods Fastify parses a body for. */
    private const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'SEARCH', 'PROPFIND', 'PROPPATCH', 'LOCK', 'REPORT', 'MKCALENDAR'];

    public function __construct(private readonly int $limit = self::DEFAULT_LIMIT) {}

    /** The parsed body, or {@see Undefined::Value} if the request has none. */
    public static function body(ServerRequestInterface $request): mixed
    {
        $attributes = $request->getAttributes();

        return \array_key_exists(self::ATTRIBUTE, $attributes) ? $attributes[self::ATTRIBUTE] : Undefined::Value;
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if (!\in_array(strtoupper($request->getMethod()), self::BODY_METHODS, true)) {
            return $handler->handle($request);
        }
        $length = $request->getHeaderLine('Content-Length');
        if ($length !== '' && ctype_digit($length) && (int) $length > $this->limit) {
            throw self::tooLarge();
        }
        $raw = self::read($request, $this->limit);
        $contentType = $request->getHeaderLine('Content-Type');
        $mediaType = strtolower(trim(explode(';', $contentType, 2)[0]));

        if ($raw === '' && $mediaType !== 'application/json') {
            return $handler->handle($request);
        }
        if ($mediaType === 'application/json') {
            return $handler->handle($request->withAttribute(self::ATTRIBUTE, self::decode($raw)));
        }
        if ($mediaType === 'text/plain') {
            return $handler->handle($request->withAttribute(self::ATTRIBUTE, $raw));
        }

        throw new HttpError(415, 'bad_request', 'Unsupported Media Type');
    }

    private static function read(ServerRequestInterface $request, int $limit): string
    {
        $stream = $request->getBody();
        if ($stream->isSeekable()) {
            $stream->rewind();
        }
        $raw = '';
        while (!$stream->eof()) {
            $raw .= $stream->read(65536);
            if (\strlen($raw) > $limit) {
                throw self::tooLarge();
            }
        }

        return $raw;
    }

    private static function decode(string $raw): mixed
    {
        if ($raw === '') {
            throw new HttpError(400, 'bad_request', "Body cannot be empty when content-type is set to 'application/json'");
        }
        try {
            $value = json_decode($raw, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw new HttpError(400, 'bad_request', self::INVALID_JSON, [], $error);
        }
        if (self::hasPrototypeKeys($value)) {
            // Fastify (secure-json-parse) rejects prototype poisoning; same answer here.
            throw new HttpError(400, 'bad_request', self::INVALID_JSON);
        }

        return $value;
    }

    /** `__proto__` keys or `constructor.prototype`, anywhere in the document. */
    private static function hasPrototypeKeys(mixed $value): bool
    {
        if ($value instanceof \stdClass) {
            $properties = get_object_vars($value);
            if (\array_key_exists('__proto__', $properties)) {
                return true;
            }
            if (($properties['constructor'] ?? null) instanceof \stdClass
                && \array_key_exists('prototype', get_object_vars($properties['constructor']))) {
                return true;
            }
            $value = $properties;
        }
        if (\is_array($value)) {
            foreach ($value as $item) {
                if (self::hasPrototypeKeys($item)) {
                    return true;
                }
            }
        }

        return false;
    }

    private static function tooLarge(): HttpError
    {
        return new HttpError(413, 'bad_request', 'Request body is too large');
    }
}
