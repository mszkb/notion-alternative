<?php

declare(strict_types=1);

namespace NotionAlt\Http;

/** An `application/octet-stream` body (Fastify: `Buffer`), on routes that accept one. */
final class RawBody
{
    public function __construct(public readonly string $bytes) {}
}
