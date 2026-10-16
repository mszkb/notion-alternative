<?php

declare(strict_types=1);

namespace NotionAlt\Database\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\DBAL\Schema\Table;
use Doctrine\DBAL\Types\Types;
use NotionAlt\Database\Database;
use NotionAlt\Database\Migration;
use NotionAlt\Database\Sql;

/**
 * The schema after migration 0017 for MariaDB/MySQL, in one step (ADR 0024). The migrator records
 * it as 0001–0017, so both databases count migrations alike; from 0018 on, a migration serves both.
 *
 * Types: ids are UUIDs (`varchar(36)`), indexed texts get a `varchar` within InnoDB's key limit
 * (3072 bytes), other texts `text`, and texts that can get long (block content, the change log's
 * payload, conflict copies) `mediumtext`. Integers are `bigint` (millisecond timestamps).
 * Push endpoints are URLs of up to 2000 characters and the primary key, so they are ASCII.
 * `metrics` gets an `id` for the insertion order that SQLite keeps in its `rowid`.
 * The search index is a table with `FULLTEXT` indexes instead of FTS5.
 */
final class MysqlBase implements Migration
{
    /** The migrations this one stands for. */
    public const LAST = '0017_share_links';

    public function up(\PDO $db): void
    {
        $platform = Database::platform($db);
        /** @var list<string> $existing */
        $existing = Sql::run($db, 'select lower(table_name) from information_schema.tables where table_schema = database()')->fetchAll(\PDO::FETCH_COLUMN);
        // DDL commits at once on MariaDB/MySQL: after a failed attempt, create what is missing.
        $missing = array_values(array_filter(
            self::schema()->getTables(),
            static fn(Table $table): bool => !\in_array(strtolower($table->getObjectName()->toString()), $existing, true),
        ));
        foreach ($platform->getCreateTablesSQL($missing) as $statement) {
            $db->exec($statement);
        }
    }

    public static function schema(): Schema
    {
        $schema = new Schema();

        $users = self::table($schema, 'users');
        self::id($users);
        $users->addColumn('email', Types::STRING, ['length' => 254]);
        self::text($users, 'password_hash');
        self::time($users, 'created_at');
        $users->addUniqueIndex(['email'], 'users_email_unique');

        $workspaces = self::table($schema, 'workspaces');
        self::id($workspaces);
        self::text($workspaces, 'name');
        self::uuid($workspaces, 'owner_id');
        self::time($workspaces, 'created_at');
        $workspaces->addColumn('compacted_seq', Types::BIGINT, ['default' => 0]);
        $workspaces->addIndex(['owner_id'], 'workspaces_owner_id_idx');
        self::references($workspaces, 'owner_id', 'users');

        $sessions = self::table($schema, 'sessions');
        $sessions->addColumn('id', Types::STRING, ['length' => 64]);
        $sessions->setPrimaryKey(['id']);
        self::uuid($sessions, 'user_id');
        self::time($sessions, 'created_at');
        self::time($sessions, 'expires_at');
        self::uuid($sessions, 'device_id', true);
        $sessions->addIndex(['user_id'], 'sessions_user_id_idx');
        $sessions->addIndex(['device_id'], 'sessions_device_id_idx');
        self::references($sessions, 'user_id', 'users');

        $devices = self::table($schema, 'devices');
        self::id($devices);
        self::uuid($devices, 'user_id');
        self::text($devices, 'name');
        self::time($devices, 'created_at');
        self::time($devices, 'last_seen_at');
        self::time($devices, 'revoked_at', true);
        $devices->addIndex(['user_id'], 'devices_user_id_idx');
        self::references($devices, 'user_id', 'users');

        $documents = self::table($schema, 'documents');
        self::id($documents);
        self::workspace($documents);
        self::uuid($documents, 'parent_id', true);
        self::text($documents, 'title');
        self::text($documents, 'sort_key');
        $documents->addColumn('favorite', Types::BIGINT);
        self::time($documents, 'created_at');
        self::time($documents, 'updated_at');
        self::revision($documents);
        self::text($documents, 'icon', true);
        self::text($documents, 'cover', true);
        self::workspaceIndexes($documents, 'documents');

        $blocks = self::table($schema, 'blocks');
        self::id($blocks);
        self::workspace($blocks);
        self::uuid($blocks, 'document_id');
        $blocks->addColumn('type', Types::STRING, ['length' => 32]);
        self::longText($blocks, 'content');
        self::longText($blocks, 'attrs');
        self::text($blocks, 'sort_key');
        self::revision($blocks);
        $blocks->addIndex(['document_id'], 'blocks_document_id_idx');
        self::workspaceIndexes($blocks, 'blocks');

        $tags = self::table($schema, 'tags');
        self::id($tags);
        self::workspace($tags);
        self::text($tags, 'name');
        self::revision($tags);
        self::workspaceIndexes($tags, 'tags');

        $documentTags = self::table($schema, 'document_tags');
        self::id($documentTags);
        self::workspace($documentTags);
        self::uuid($documentTags, 'document_id');
        self::uuid($documentTags, 'tag_id');
        self::revision($documentTags);
        $documentTags->addIndex(['document_id'], 'document_tags_document_id_idx');
        self::workspaceIndexes($documentTags, 'document_tags');

        $changes = self::table($schema, 'changes');
        self::workspace($changes);
        $changes->addColumn('seq', Types::BIGINT);
        self::uuid($changes, 'op_id');
        self::uuid($changes, 'device_id');
        $changes->addColumn('entity', Types::STRING, ['length' => 32]);
        self::uuid($changes, 'entity_id');
        $changes->addColumn('kind', Types::STRING, ['length' => 32]);
        $changes->addColumn('revision', Types::BIGINT);
        self::longText($changes, 'payload');
        self::time($changes, 'applied_at');
        $changes->setPrimaryKey(['workspace_id', 'seq']);
        $changes->addUniqueIndex(['op_id'], 'changes_op_id_unique');
        $changes->addIndex(['entity', 'entity_id'], 'changes_entity_idx');

        $conflicts = self::table($schema, 'conflicts');
        self::id($conflicts);
        self::workspace($conflicts);
        self::uuid($conflicts, 'op_id');
        $conflicts->addColumn('entity', Types::STRING, ['length' => 32]);
        self::uuid($conflicts, 'entity_id');
        self::uuid($conflicts, 'document_id', true);
        self::text($conflicts, 'reason');
        $conflicts->addColumn('base_revision', Types::BIGINT, ['notnull' => false]);
        self::longText($conflicts, 'local');
        self::longText($conflicts, 'remote', true);
        self::time($conflicts, 'created_at');
        self::time($conflicts, 'resolved_at', true);
        self::text($conflicts, 'resolution', true);
        self::revision($conflicts);
        $conflicts->addUniqueIndex(['op_id'], 'conflicts_op_id_unique');
        self::workspaceIndexes($conflicts, 'conflicts');

        $subscriptions = self::table($schema, 'push_subscriptions');
        self::endpoint($subscriptions);
        $subscriptions->setPrimaryKey(['endpoint']);
        self::uuid($subscriptions, 'user_id');
        self::uuid($subscriptions, 'device_id');
        self::text($subscriptions, 'p256dh');
        self::text($subscriptions, 'auth');
        self::time($subscriptions, 'created_at');
        self::time($subscriptions, 'last_success_at', true);
        $subscriptions->addColumn('failures', Types::BIGINT, ['default' => 0]);
        $subscriptions->addIndex(['user_id'], 'push_subscriptions_user_id_idx');
        self::references($subscriptions, 'user_id', 'users');
        self::references($subscriptions, 'device_id', 'devices');

        $settings = self::table($schema, 'settings');
        $settings->addColumn('key', Types::STRING, ['length' => 191]);
        $settings->setPrimaryKey(['key']);
        self::text($settings, 'value');

        $attachments = self::table($schema, 'attachments');
        self::id($attachments);
        self::workspace($attachments);
        self::uuid($attachments, 'document_id');
        self::text($attachments, 'name');
        self::text($attachments, 'mime_type');
        $attachments->addColumn('size', Types::BIGINT);
        $attachments->addColumn('sha256', Types::STRING, ['length' => 64]);
        self::time($attachments, 'created_at');
        self::time($attachments, 'stored_at', true);
        self::revision($attachments);
        self::workspaceIndexes($attachments, 'attachments');

        $searchDocuments = self::table($schema, 'search_documents');
        $searchDocuments->addColumn('id', Types::BIGINT, ['autoincrement' => true]);
        $searchDocuments->setPrimaryKey(['id']);
        self::uuid($searchDocuments, 'document_id');
        $searchDocuments->addUniqueIndex(['document_id'], 'search_documents_document_id_unique');

        $searchIndex = self::table($schema, 'search_index');
        $searchIndex->addColumn('id', Types::BIGINT);
        $searchIndex->setPrimaryKey(['id']);
        self::uuid($searchIndex, 'document_id');
        self::uuid($searchIndex, 'workspace_id');
        // Case and accents do not matter, like FTS5 with `remove_diacritics` ("uber" finds "über").
        $searchText = ['platformOptions' => ['collation' => 'utf8mb4_unicode_ci']];
        $searchIndex->addColumn('title', Types::TEXT, ['length' => 65_535, ...$searchText]);
        $searchIndex->addColumn('body', Types::TEXT, ['length' => 16_777_215, ...$searchText]);
        $searchIndex->addIndex(['workspace_id'], 'search_index_workspace_id_idx');
        // Words may be spread over title and body; the title alone weighs ten times more.
        $searchIndex->addIndex(['title', 'body'], 'search_index_ft', ['fulltext']);
        $searchIndex->addIndex(['title'], 'search_index_title_ft', ['fulltext']);

        $searchDirty = self::table($schema, 'search_dirty');
        self::uuid($searchDirty, 'document_id');
        $searchDirty->setPrimaryKey(['document_id']);

        $attempts = self::table($schema, 'auth_attempts');
        $attempts->addColumn('key', Types::STRING, ['length' => 512]);
        $attempts->setPrimaryKey(['key']);
        $attempts->addColumn('count', Types::BIGINT);
        $attempts->addColumn('reset_at', Types::BIGINT);
        $attempts->addIndex(['reset_at'], 'auth_attempts_reset_at_idx');

        $hints = self::table($schema, 'push_hints');
        self::endpoint($hints);
        $hints->setPrimaryKey(['endpoint']);
        self::uuid($hints, 'workspace_id');
        $hints->addColumn('due_at', Types::BIGINT, ['notnull' => false]);
        $hints->addColumn('sent_at', Types::BIGINT, ['notnull' => false]);
        $hints->addIndex(['due_at'], 'push_hints_due_at_idx');
        self::references($hints, 'endpoint', 'push_subscriptions', 'endpoint');
        self::references($hints, 'workspace_id', 'workspaces');

        $metrics = self::table($schema, 'metrics');
        $metrics->addColumn('id', Types::BIGINT, ['autoincrement' => true]);
        $metrics->setPrimaryKey(['id']);
        $metrics->addColumn('name', Types::STRING, ['length' => 128]);
        $metrics->addColumn('labels', Types::STRING, ['length' => 600]);
        $metrics->addColumn('value', Types::FLOAT);
        $metrics->addUniqueIndex(['name', 'labels'], 'metrics_pk');

        $members = self::table($schema, 'workspace_members');
        self::workspace($members);
        self::uuid($members, 'user_id');
        $members->addColumn('role', Types::STRING, ['length' => 16]);
        self::time($members, 'added_at');
        $members->setPrimaryKey(['workspace_id', 'user_id']);
        $members->addIndex(['user_id'], 'workspace_members_user_id_idx');
        self::references($members, 'user_id', 'users');

        $links = self::table($schema, 'share_links');
        self::id($links);
        $links->addColumn('token_hash', Types::STRING, ['length' => 64]);
        self::workspace($links);
        self::uuid($links, 'document_id');
        self::uuid($links, 'created_by');
        self::time($links, 'created_at');
        self::time($links, 'expires_at', true);
        $links->addUniqueIndex(['token_hash'], 'share_links_token_hash_unique');
        $links->addIndex(['created_by'], 'share_links_created_by_idx');
        $links->addIndex(['workspace_id', 'document_id'], 'share_links_workspace_id_document_id_idx');
        self::references($links, 'created_by', 'users');

        return $schema;
    }

    private static function table(Schema $schema, string $name): Table
    {
        $table = $schema->createTable($name);
        $table->addOption('engine', 'InnoDB');
        $table->addOption('charset', 'utf8mb4');
        $table->addOption('collation', 'utf8mb4_bin');

        return $table;
    }

    private static function id(Table $table): void
    {
        self::uuid($table, 'id');
        $table->setPrimaryKey(['id']);
    }

    private static function uuid(Table $table, string $name, bool $nullable = false): void
    {
        $table->addColumn($name, Types::STRING, ['length' => 36, 'notnull' => !$nullable]);
    }

    /** ISO 8601 timestamps as text, like on SQLite. */
    private static function time(Table $table, string $name, bool $nullable = false): void
    {
        $table->addColumn($name, Types::STRING, ['length' => 40, 'notnull' => !$nullable]);
    }

    private static function text(Table $table, string $name, bool $nullable = false): void
    {
        $table->addColumn($name, Types::TEXT, ['length' => 65_535, 'notnull' => !$nullable]);
    }

    private static function longText(Table $table, string $name, bool $nullable = false): void
    {
        // A length above 65535 bytes makes DBAL choose `mediumtext`.
        $table->addColumn($name, Types::TEXT, ['length' => 16_777_215, 'notnull' => !$nullable]);
    }

    private static function revision(Table $table): void
    {
        $table->addColumn('revision', Types::BIGINT);
        self::time($table, 'deleted_at', true);
    }

    private static function workspace(Table $table): void
    {
        self::uuid($table, 'workspace_id');
        self::references($table, 'workspace_id', 'workspaces');
    }

    /** The index on `workspace_id` and the one on `(workspace_id, id)` for the paged snapshot (#97). */
    private static function workspaceIndexes(Table $table, string $name): void
    {
        $table->addIndex(['workspace_id'], "{$name}_workspace_id_idx");
        $table->addIndex(['workspace_id', 'id'], "{$name}_workspace_id_id_idx");
    }

    private static function endpoint(Table $table): void
    {
        $table->addColumn('endpoint', Types::STRING, [
            'length' => 2000,
            'platformOptions' => ['charset' => 'ascii', 'collation' => 'ascii_bin'],
        ]);
    }

    private static function references(Table $table, string $column, string $foreign, string $foreignColumn = 'id'): void
    {
        $table->addForeignKeyConstraint($foreign, [$column], [$foreignColumn], ['onDelete' => 'CASCADE'], "{$table->getObjectName()->toString()}_{$column}_fk");
    }
}
