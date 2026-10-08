<?php

declare(strict_types=1);

namespace NotionAlt\Cli;

use NotionAlt\Attachments\ContentStore;
use NotionAlt\Attachments\Purge;
use NotionAlt\Config\Config;
use NotionAlt\Database\Sql;
use NotionAlt\Push\PushNotifier;
use NotionAlt\Search\SearchIndex;
use NotionAlt\Support\Ids;

/**
 * Periodic work without a long-running process (ADR 0018), for `bin/cron.php`: run it every
 * few minutes from the hoster's cron. Every task is also safe to skip: without the cron, requests
 * catch up on what they need (search index before a search, push hints after sync requests).
 */
final class Cron
{
    /**
     * @param null|\Closure(\NotionAlt\Push\PushRequest): int $send push transport (tests)
     *
     * @return array{sessions: int, authAttempts: int, pushHints: int, purgedAttachments: int}
     */
    public static function run(\PDO $db, Config $config, ?ContentStore $store = null, ?int $nowMs = null, ?\Closure $send = null): array
    {
        $now = $nowMs ?? Ids::nowMs();
        $sessions = Sql::run($db, 'delete from sessions where expires_at <= ?', [Ids::iso($now)])->rowCount();
        $attempts = Sql::run($db, 'delete from auth_attempts where reset_at <= ?', [$now])->rowCount();
        // Search entries a crash or an interrupted request left outdated (#99).
        SearchIndex::reindexMarked($db);
        $hints = PushNotifier::flush($db, $config->push, $now, $send);
        $purged = Purge::deletedAttachments(
            $db,
            $store ?? ContentStore::fromConfig($config->attachments),
            $config->attachments->retentionDays,
            $now,
        );

        return ['sessions' => $sessions, 'authAttempts' => $attempts, 'pushHints' => $hints, 'purgedAttachments' => $purged];
    }
}
