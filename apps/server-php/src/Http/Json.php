<?php

declare(strict_types=1);

namespace NotionAlt\Http;

use Psr\Http\Message\ResponseInterface;

final class Json
{
    /** Like `JSON.stringify`: no escaped slashes or non-ASCII characters, `1.0` as `1`. */
    public const ENCODE_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR;

    public static function encode(mixed $value): string
    {
        return json_encode($value, self::ENCODE_FLAGS);
    }

    /** Writes `$data` as the JSON body (content type as sent by Fastify). */
    public static function respond(ResponseInterface $response, mixed $data, int $status = 200): ResponseInterface
    {
        $response->getBody()->write(self::encode($data));

        return $response
            ->withStatus($status)
            ->withHeader('Content-Type', 'application/json; charset=utf-8');
    }
}
