<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

use NotionAlt\Http\HttpError;

final class Validation
{
    /**
     * Parses untrusted input; responds with 400 `invalid_input` on failure (like `parseInput` in
     * apps/server/src/validation.ts).
     *
     * @throws HttpError
     */
    public static function parseInput(Schema $schema, mixed $input): mixed
    {
        $result = $schema->safeParse($input);
        if (!$result->success()) {
            throw new HttpError(400, 'invalid_input', 'Invalid input', [
                'issues' => array_map(
                    static fn(Issue $issue): array => ['path' => $issue->pathString(), 'message' => $issue->message],
                    $result->issues,
                ),
            ]);
        }

        return $result->data;
    }
}
