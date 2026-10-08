<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit\Push;

use NotionAlt\Config\PushConfig;
use NotionAlt\Database\Database;
use NotionAlt\Database\Migrator;
use NotionAlt\Database\Sql;
use NotionAlt\Push\Base64Url;
use NotionAlt\Push\P256;
use NotionAlt\Push\PushNotifier;
use NotionAlt\Push\PushRequest;
use NotionAlt\Support\Ids;
use NotionAlt\Tests\TempDir;
use PHPUnit\Framework\TestCase;

/** Bundling and failure handling of push hints (#125). */
final class PushNotifierTest extends TestCase
{
    use TempDir;

    private \PDO $db;

    private string $ws;

    private string $laptop;

    private string $phone;

    private PushConfig $config;

    /** @var list<PushRequest> */
    private array $sent = [];

    private int $status = 201;

    protected function setUp(): void
    {
        $this->db = Database::open($this->tempDir() . '/app.sqlite');
        (new Migrator($this->db))->migrateToLatest();
        $user = Ids::uuid();
        $this->ws = Ids::uuid();
        $this->laptop = Ids::uuid();
        $this->phone = Ids::uuid();
        $this->config = new PushConfig('mailto:admin@example.com', ['push.example']);
        Sql::run($this->db, "insert into users (id, email, password_hash, created_at) values (?, 'a@example.com', 'h', 'now')", [$user]);
        Sql::run($this->db, "insert into workspaces (id, name, owner_id, created_at) values (?, 'W', ?, 'now')", [$this->ws, $user]);
        foreach ([$this->laptop, $this->phone] as $device) {
            Sql::run($this->db, "insert into devices (id, user_id, name, created_at, last_seen_at, revoked_at) values (?, ?, 'd', 'now', 'now', null)", [$device, $user]);
            Sql::run(
                $this->db,
                "insert into push_subscriptions (endpoint, user_id, device_id, p256dh, auth, created_at, last_success_at, failures)
                 values (?, ?, ?, ?, ?, 'now', null, 0)",
                ["https://push.example/{$device}", $user, $device, Base64Url::encode(P256::point(P256::generate())), Base64Url::encode(random_bytes(16))],
            );
        }
    }

    public function testHintsOtherDevicesAndBundlesABurst(): void
    {
        $t = 1_000_000;
        self::assertSame(1, PushNotifier::notify($this->db, $this->ws, $this->laptop, $t));
        self::assertSame(1, $this->flush($t));
        self::assertSame("https://push.example/{$this->phone}", $this->sent[0]->url);

        // More changes right after: one hint at the end of the window, not one per change.
        PushNotifier::notify($this->db, $this->ws, $this->laptop, $t + 100);
        PushNotifier::notify($this->db, $this->ws, $this->laptop, $t + 500);
        self::assertSame($t + PushNotifier::BUNDLE_MS, PushNotifier::nextDue($this->db));
        self::assertSame(0, $this->flush($t + 1999));
        self::assertSame(1, $this->flush($t + 2000));
        self::assertSame(0, $this->flush($t + 9000));
        self::assertNull(PushNotifier::nextDue($this->db));

        // After a quiet period the next hint is due at once.
        PushNotifier::notify($this->db, $this->ws, $this->laptop, $t + 10_000);
        self::assertSame(1, $this->flush($t + 10_000));
        self::assertCount(3, $this->sent);
    }

    public function testDropsGoneAndRepeatedlyFailingSubscriptions(): void
    {
        $t = 1_000_000;
        $this->status = 500;
        for ($i = 0; $i < PushNotifier::MAX_FAILURES; ++$i) {
            PushNotifier::notify($this->db, $this->ws, $this->laptop, $t);
            $this->flush($t);
            $t += 10_000;
        }
        self::assertSame([], Sql::rows($this->db, 'select endpoint from push_subscriptions where device_id = ?', [$this->phone]));
        // The pending row went with the subscription.
        self::assertSame(0, PushNotifier::notify($this->db, $this->ws, $this->laptop, $t));

        $this->status = 410;
        PushNotifier::notify($this->db, $this->ws, $this->phone, $t);
        self::assertSame(1, $this->flush($t));
        self::assertSame([], Sql::rows($this->db, 'select endpoint from push_subscriptions'));
    }

    public function testSkipsHostsNoLongerAllowed(): void
    {
        PushNotifier::notify($this->db, $this->ws, $this->laptop, 5);
        $this->config = new PushConfig('mailto:admin@example.com', ['other.example']);
        self::assertSame(0, $this->flush(5));
        self::assertNull(PushNotifier::nextDue($this->db));
    }

    private function flush(int $now): int
    {
        return PushNotifier::flush($this->db, $this->config, $now, function (PushRequest $request): int {
            $this->sent[] = $request;

            return $this->status;
        });
    }
}
