<?php

declare(strict_types=1);

namespace NotionAlt\Http;

/** A JSON body read but not yet decoded, see {@see JsonBodyMiddleware::DEFER_JSON}. */
final class DeferredJson
{
    public function __construct(public readonly string $raw) {}
}
