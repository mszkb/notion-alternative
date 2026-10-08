<?php

declare(strict_types=1);

namespace NotionAlt\History;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Workspaces\Workspaces;

/** Version history of a page from the change log (ADR 0013). */
final class History
{
    /** Changes of one device less than this apart form one version. */
    public const SESSION_GAP_MS = 10 * 60 * 1000;

    /**
     * Versions of a page, newest first; null if not the user's.
     *
     * @return list<array{seq: int, at: string, deviceId: string, changes: int}>|null
     */
    public static function listVersions(\PDO $db, string $userId, string $workspaceId, string $documentId, int $limit = 200): ?array
    {
        $changes = self::documentChanges($db, $userId, $workspaceId, $documentId);
        if ($changes === null) {
            return null;
        }
        $versions = [];
        $last = -1;
        foreach ($changes as $change) {
            $device = Row::string($change, 'device_id');
            $at = Row::string($change, 'applied_at');
            if ($last >= 0 && $versions[$last]['deviceId'] === $device && self::withinGap($versions[$last]['at'], $at)) {
                $versions[$last]['seq'] = Row::int($change, 'seq');
                $versions[$last]['at'] = $at;
                ++$versions[$last]['changes'];
            } else {
                $versions[] = ['seq' => Row::int($change, 'seq'), 'at' => $at, 'deviceId' => $device, 'changes' => 1];
                ++$last;
            }
        }

        return \array_slice(array_reverse($versions), 0, $limit);
    }

    /**
     * Page and blocks as they were after change `$seq`; null if unknown or not the user's.
     *
     * @return array{seq: int, document: array{id: string, title: string, parentId: ?string, favorite: bool, deletedAt: ?string}, blocks: list<array{id: string, type: string, content: string, attrs: mixed, sortKey: string}>}|null
     */
    public static function versionState(\PDO $db, string $userId, string $workspaceId, string $documentId, int $seq): ?array
    {
        $changes = self::documentChanges($db, $userId, $workspaceId, $documentId);
        if ($changes === null) {
            return null;
        }
        $document = null;
        /** @var array<string, array<string, mixed>> $blocks */
        $blocks = [];
        foreach ($changes as $change) {
            if (Row::int($change, 'seq') > $seq) {
                break;
            }
            if (Row::string($change, 'entity') === 'document') {
                $document = self::fold($change, $document);
            } else {
                $id = Row::string($change, 'entity_id');
                $next = self::fold($change, $blocks[$id] ?? null);
                if ($next !== null) {
                    $blocks[$id] = $next;
                }
            }
        }
        if ($document === null) {
            return null;
        }
        $result = [];
        foreach ($blocks as $block) {
            if (self::truthy($block['deletedAt'] ?? null)) {
                continue;
            }
            $attrs = $block['attrs'] ?? null;
            $result[] = [
                'id' => self::jsString($block['id'] ?? null),
                'type' => self::jsString($block['type'] ?? null),
                'content' => self::jsString($block['content'] ?? ''),
                'attrs' => $attrs ?? new \stdClass(),
                'sortKey' => self::jsString($block['sortKey'] ?? null),
            ];
        }
        // compareBySortKey: by sort key, then id (code unit order; keys and ids are ASCII).
        usort($result, static fn(array $a, array $b): int => [$a['sortKey'], $a['id']] <=> [$b['sortKey'], $b['id']]);
        $parentId = $document['parentId'] ?? null;
        $deletedAt = $document['deletedAt'] ?? null;

        return [
            'seq' => $seq,
            'document' => [
                'id' => $documentId,
                'title' => self::jsString($document['title'] ?? ''),
                'parentId' => \is_string($parentId) ? $parentId : null,
                'favorite' => self::truthy($document['favorite'] ?? null),
                'deletedAt' => \is_string($deletedAt) ? $deletedAt : null,
            ],
            'blocks' => $result,
        ];
    }

    /**
     * All change-log entries of a page and its blocks, oldest first; null if not the user's.
     *
     * @return list<array<string, mixed>>|null
     */
    private static function documentChanges(\PDO $db, string $userId, string $workspaceId, string $documentId): ?array
    {
        if (Workspaces::findForUser($db, $workspaceId, $userId) === null) {
            return null;
        }
        if (Sql::rows($db, 'select id from documents where id = ? and workspace_id = ?', [$documentId, $workspaceId]) === []) {
            return null;
        }

        return Sql::rows(
            $db,
            "select * from changes where workspace_id = ? and (
               (entity = 'document' and entity_id = ?)
               or (entity = 'block' and entity_id in (select id from blocks where document_id = ?))
             ) order by seq",
            [$workspaceId, $documentId, $documentId],
        );
    }

    /**
     * One change applied to the entity's state (`fold` in history.ts).
     *
     * @param array<string, mixed>      $change
     * @param array<string, mixed>|null $current
     *
     * @return array<string, mixed>|null
     */
    private static function fold(array $change, ?array $current): ?array
    {
        $decoded = json_decode(Row::string($change, 'payload'), false, 512, JSON_THROW_ON_ERROR);
        /** @var array<string, mixed> $payload JSON object keys */
        $payload = $decoded instanceof \stdClass ? get_object_vars($decoded) : [];
        $kind = Row::string($change, 'kind');
        if ($kind === 'create') {
            // `{ id, ...payload, deletedAt: null }`: a payload `id` overrides, its position stays.
            return [...['id' => Row::string($change, 'entity_id')], ...$payload, 'deletedAt' => null];
        }
        if ($current === null) {
            return null;
        }

        return match ($kind) {
            'delete' => [...$current, 'deletedAt' => Row::string($change, 'applied_at')],
            'restore' => [...$current, 'deletedAt' => null],
            default => [...$current, ...$payload],
        };
    }

    /** `Date.parse(at) - Date.parse(lastAt) <= SESSION_GAP_MS`; unparsable dates are never close. */
    private static function withinGap(string $lastAt, string $at): bool
    {
        $from = self::parseMs($lastAt);
        $to = self::parseMs($at);

        return $from !== null && $to !== null && $to - $from <= self::SESSION_GAP_MS;
    }

    private static function parseMs(string $iso): ?int
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/D', $iso) !== 1) {
            return null;
        }
        try {
            return (int) (new \DateTimeImmutable($iso))->format('Uv');
        } catch (\Exception) {
            return null;
        }
    }

    /** JavaScript truthiness of a JSON value. */
    private static function truthy(mixed $value): bool
    {
        return !($value === null || $value === false || $value === 0 || $value === 0.0 || $value === '');
    }

    /** `String(value)` for JSON scalars (objects as in JavaScript would never occur here). */
    private static function jsString(mixed $value): string
    {
        return match (true) {
            \is_string($value) => $value,
            $value === null => 'null',
            \is_bool($value) => $value ? 'true' : 'false',
            \is_int($value), \is_float($value) => json_encode($value, JSON_THROW_ON_ERROR),
            default => '[object Object]',
        };
    }
}
