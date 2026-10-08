<?php

declare(strict_types=1);

namespace NotionAlt\Push;

use NotionAlt\Config\PushConfig;
use NotionAlt\Database\Row;
use NotionAlt\Database\Sql;
use NotionAlt\Support\Ids;

/**
 * "Changes waiting" hints to the other devices of a workspace's owner (port of `PushNotifier` in
 * apps/server/src/push/service.ts). Data integrity never depends on it (principle 4).
 *
 * The Node server bundles the hints of a burst with a timer in memory. PHP has no timers between
 * requests, so pending hints are rows in `push_hints`: the first hint after a quiet period is
 * due at once, later ones within {@see self::BUNDLE_MS} of the last send are bundled into one
 * hint at the end of that window. {@see self::flush()} sends what is due; it runs after the
 * response of a sync request and in the cron (#127).
 */
final class PushNotifier
{
    /** Hints to one subscription are at least this far apart (Node: delay of the timer). */
    public const BUNDLE_MS = 2000;

    /** Subscriptions that keep failing are dropped; the device can subscribe again. */
    public const MAX_FAILURES = 5;

    /**
     * Changes in `$workspaceId` from `$originDeviceId`: schedule a hint for every other device
     * of the owner. Returns the number of scheduled subscriptions.
     */
    public static function notify(\PDO $db, string $workspaceId, string $originDeviceId, ?int $nowMs = null): int
    {
        $now = $nowMs ?? Ids::nowMs();
        $statement = Sql::run(
            $db,
            'insert into push_hints (endpoint, workspace_id, due_at, sent_at)
             select push_subscriptions.endpoint, workspaces.id, ?, null
             from push_subscriptions inner join workspaces on workspaces.owner_id = push_subscriptions.user_id
             where workspaces.id = ? and push_subscriptions.device_id != ?
             on conflict (endpoint) do update set
               workspace_id = excluded.workspace_id,
               due_at = coalesce(push_hints.due_at, max(excluded.due_at, coalesce(push_hints.sent_at, 0) + ?))',
            [$now, $workspaceId, $originDeviceId, self::BUNDLE_MS],
        );

        return $statement->rowCount();
    }

    /** Epoch ms of the next pending hint, or null if none is pending. */
    public static function nextDue(\PDO $db): ?int
    {
        $rows = Sql::rows($db, 'select min(due_at) as due from push_hints');
        $due = $rows[0]['due'] ?? null;

        return \is_int($due) ? $due : null;
    }

    /**
     * Sends every hint that is due. Each hint is claimed first, so concurrent flushes never send
     * one twice. Returns the number of sent requests.
     *
     * @param null|\Closure(PushRequest): int $send status of the push service, 0 on failure (tests)
     */
    public static function flush(\PDO $db, PushConfig $config, ?int $nowMs = null, ?\Closure $send = null): int
    {
        $now = $nowMs ?? Ids::nowMs();
        $due = Sql::rows($db, 'select endpoint, workspace_id, due_at from push_hints where due_at <= ? order by due_at', [$now]);
        if ($due === []) {
            return 0;
        }
        $send ??= PushSender::send(...);
        $keys = PushSettings::vapidKeys($db);
        $installation = PushSettings::installationId($db);
        $sent = 0;
        foreach ($due as $hint) {
            $endpoint = Row::string($hint, 'endpoint');
            $claimed = Sql::run(
                $db,
                'update push_hints set due_at = null, sent_at = ? where endpoint = ? and due_at = ?',
                [$now, $endpoint, Row::int($hint, 'due_at')],
            )->rowCount();
            if ($claimed !== 1) {
                continue;
            }
            $subscriptions = Sql::rows($db, 'select * from push_subscriptions where endpoint = ?', [$endpoint]);
            if ($subscriptions === [] || !PushRequest::isAllowedEndpoint($endpoint, $config->allowedHosts)) {
                continue;
            }
            $subscription = $subscriptions[0];
            try {
                // Keys that are not a valid curve point count as a failed send.
                $request = PushRequest::syncAvailable(
                    $endpoint,
                    Row::string($subscription, 'p256dh'),
                    Row::string($subscription, 'auth'),
                    $installation,
                    Row::string($hint, 'workspace_id'),
                    $keys,
                    $config->subject,
                );
                $status = $send($request);
                ++$sent;
            } catch (\InvalidArgumentException) {
                $status = 0;
            }
            $failures = Row::int($subscription, 'failures');
            if ($status >= 200 && $status < 300) {
                Sql::run($db, 'update push_subscriptions set last_success_at = ?, failures = 0 where endpoint = ?', [Ids::iso($now), $endpoint]);
            } elseif (PushRequest::isGone($status) || $failures + 1 >= self::MAX_FAILURES) {
                Sql::run($db, 'delete from push_subscriptions where endpoint = ?', [$endpoint]);
            } else {
                Sql::run($db, 'update push_subscriptions set failures = ? where endpoint = ?', [$failures + 1, $endpoint]);
            }
        }

        return $sent;
    }
}
