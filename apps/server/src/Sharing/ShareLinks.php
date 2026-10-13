<?php

declare(strict_types=1);

namespace NotionAlt\Sharing;

use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Shared\AttachmentSchemas;
use NotionAlt\Support\Ids;
use NotionAlt\Workspaces\Workspaces;

/**
 * Read links for people without an account (ADR 0022). A link shows exactly one page; only the
 * SHA-256 of its token is stored. A link counts only while its creator is still at least `editor`
 * in the workspace and the page is not deleted.
 *
 * @phpstan-type ShareLinkRow array{id: string, workspace_id: string, document_id: string, created_by: string, created_at: string, expires_at: ?string}
 */
final class ShareLinks
{
    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    /**
     * Creates a link and returns it with the token (shown only this once).
     *
     * @return array{row: ShareLinkRow, token: string}
     */
    public static function create(\PDO $db, string $workspaceId, string $documentId, string $userId, ?int $expiresAtMs): array
    {
        $token = Ids::base64Url(random_bytes(32));
        $row = [
            'id' => Ids::uuid(),
            'workspace_id' => $workspaceId,
            'document_id' => $documentId,
            'created_by' => $userId,
            'created_at' => Ids::iso(Ids::nowMs()),
            'expires_at' => $expiresAtMs === null ? null : Ids::iso($expiresAtMs),
        ];
        Sql::run(
            $db,
            'insert into share_links (id, token_hash, workspace_id, document_id, created_by, created_at, expires_at)
             values (?, ?, ?, ?, ?, ?, ?)',
            [$row['id'], self::hash($token), $workspaceId, $documentId, $userId, $row['created_at'], $row['expires_at']],
        );

        return ['row' => $row, 'token' => $token];
    }

    /**
     * Links of a workspace, newest first, optionally of one page.
     *
     * @return list<ShareLinkRow>
     */
    public static function list(\PDO $db, string $workspaceId, ?string $documentId = null): array
    {
        $sql = 'select * from share_links where workspace_id = ?';
        $params = [$workspaceId];
        if ($documentId !== null) {
            $sql .= ' and document_id = ?';
            $params[] = $documentId;
        }
        $rows = Sql::rows($db, $sql . ' order by created_at desc, id', $params);

        return array_map(self::row(...), $rows);
    }

    /** Deletes a link of the workspace; false if there is none with this id. */
    public static function delete(\PDO $db, string $workspaceId, string $id): bool
    {
        return Sql::run($db, 'delete from share_links where workspace_id = ? and id = ?', [$workspaceId, $id])->rowCount() === 1;
    }

    /**
     * The link of a token if it is valid now: not expired, its creator still at least `editor`,
     * its page not deleted. One answer for every reason, so a guest learns nothing about why.
     *
     * @return ShareLinkRow|null
     */
    public static function resolve(\PDO $db, string $token): ?array
    {
        $rows = Sql::rows($db, 'select * from share_links where token_hash = ?', [self::hash($token)]);
        if ($rows === []) {
            return null;
        }
        $link = self::row($rows[0]);
        if ($link['expires_at'] !== null && $link['expires_at'] <= Ids::iso(Ids::nowMs())) {
            return null;
        }
        if (Workspaces::findForUser($db, $link['workspace_id'], $link['created_by'], 'editor') === null) {
            return null;
        }
        $page = Sql::rows(
            $db,
            'select 1 from documents where id = ? and workspace_id = ? and deleted_at is null',
            [$link['document_id'], $link['workspace_id']],
        );

        return $page === [] ? null : $link;
    }

    /**
     * What a guest sees of the page: no ids of blocks, the workspace or accounts (ADR 0022).
     *
     * @param ShareLinkRow $link
     *
     * @return array{page: array{title: string, icon: ?string, cover: ?string, updatedAt: string}, blocks: list<array{type: string, content: string, attrs: mixed}>}
     */
    public static function page(\PDO $db, array $link): array
    {
        $documents = Sql::rows($db, 'select title, icon, cover, updated_at from documents where id = ?', [$link['document_id']]);
        $document = $documents[0] ?? throw new \LogicException('Shared page vanished');
        $blocks = Sql::rows(
            $db,
            'select type, content, attrs from blocks
             where document_id = ? and workspace_id = ? and deleted_at is null order by sort_key, id',
            [$link['document_id'], $link['workspace_id']],
        );

        return [
            'page' => [
                'title' => Row::string($document, 'title'),
                'icon' => Row::nullableString($document, 'icon'),
                'cover' => Row::nullableString($document, 'cover'),
                'updatedAt' => Row::string($document, 'updated_at'),
            ],
            'blocks' => array_map(static fn(array $block): array => [
                'type' => Row::string($block, 'type'),
                'content' => Row::string($block, 'content'),
                'attrs' => json_decode(Row::string($block, 'attrs'), false, 512, JSON_THROW_ON_ERROR),
            ], $blocks),
        ];
    }

    /**
     * An image a guest may load: a raster image of the shared page, shown by one of its active
     * image blocks or as its cover. Files are never offered to guests.
     *
     * @param ShareLinkRow $link
     *
     * @return array<string, mixed>|null
     */
    public static function image(\PDO $db, array $link, string $attachmentId): ?array
    {
        $rows = Sql::rows(
            $db,
            'select * from attachments
             where id = ? and workspace_id = ? and document_id = ? and deleted_at is null and stored_at is not null',
            [$attachmentId, $link['workspace_id'], $link['document_id']],
        );
        if ($rows === [] || !\in_array(Row::string($rows[0], 'mime_type'), AttachmentSchemas::INLINE_IMAGE_TYPES, true)) {
            return null;
        }
        $shown = Sql::rows(
            $db,
            "select 1 from blocks
             where document_id = ? and workspace_id = ? and deleted_at is null and type = 'image'
               and json_extract(attrs, '$.attachmentId') = ?
             union all
             select 1 from documents where id = ? and cover = ?
             limit 1",
            [$link['document_id'], $link['workspace_id'], $attachmentId, $link['document_id'], 'attachment:' . $attachmentId],
        );

        return $shown === [] ? null : $rows[0];
    }

    /**
     * @param ShareLinkRow $row
     *
     * @return array{id: string, documentId: string, createdBy: string, createdAt: string, expiresAt: ?string, expired: bool}
     */
    public static function toLink(array $row): array
    {
        return [
            'id' => $row['id'],
            'documentId' => $row['document_id'],
            'createdBy' => $row['created_by'],
            'createdAt' => $row['created_at'],
            'expiresAt' => $row['expires_at'],
            'expired' => $row['expires_at'] !== null && $row['expires_at'] <= Ids::iso(Ids::nowMs()),
        ];
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return ShareLinkRow
     */
    private static function row(array $row): array
    {
        return [
            'id' => Row::string($row, 'id'),
            'workspace_id' => Row::string($row, 'workspace_id'),
            'document_id' => Row::string($row, 'document_id'),
            'created_by' => Row::string($row, 'created_by'),
            'created_at' => Row::string($row, 'created_at'),
            'expires_at' => Row::nullableString($row, 'expires_at'),
        ];
    }
}
