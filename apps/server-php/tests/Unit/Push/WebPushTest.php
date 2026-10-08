<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit\Push;

use NotionAlt\Push\Base64Url;
use NotionAlt\Push\P256;
use NotionAlt\Push\PushRequest;
use NotionAlt\Push\Vapid;
use NotionAlt\Push\VapidKeys;
use NotionAlt\Push\WebPushCrypto;
use PHPUnit\Framework\TestCase;

/** Port of apps/server/test/push-crypto.test.ts plus the pure parts of push.test.ts. */
final class WebPushTest extends TestCase
{
    // RFC 8291, Appendix A.
    private const RFC_PLAINTEXT = 'When I grow up, I want to be a watermelon';
    private const RFC_AS_PRIVATE = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
    private const RFC_UA_PUBLIC = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
    private const RFC_UA_PRIVATE = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94';
    private const RFC_AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';
    private const RFC_SALT = 'DGv6ra1nlYgDCS1FRnbzlw';
    private const RFC_BODY = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

    /** `JSON.stringify(generateVapidKeys())` from the Node server, as stored in `settings`. */
    private const NODE_VAPID = '{"publicKey":"BG4K-CjY_04Mt69wdHayTgphvPy7ZqgbfkGcBFb8m7hvOEyvs7jbSjk6WVM5_tL_QBilC5dW7ySVtNRCjHGTAIM","privateKey":"-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg31C0lPomjD0jsY/r\n/BDSuHGb2TQhqbRhUGVzmU41Jg+hRANCAARuCvgo2P9ODLevcHR2sk4KYbz8u2ao\nG35BnARW/Ju4bzhMr7O420o5OllTOf7S/0AYpQuXVu8klbTUQoxxkwCD\n-----END PRIVATE KEY-----\n"}';

    private const DEFAULT_ALLOWED_HOSTS = [
        'fcm.googleapis.com',
        'updates.push.services.mozilla.com',
        '*.push.apple.com',
        '*.notify.windows.com',
    ];

    public function testReproducesTheRfc8291TestVector(): void
    {
        $body = WebPushCrypto::encrypt(
            self::RFC_PLAINTEXT,
            self::RFC_UA_PUBLIC,
            self::RFC_AUTH,
            P256::privateKeyFromScalar(Base64Url::decode(self::RFC_AS_PRIVATE)),
            Base64Url::decode(self::RFC_SALT),
        );

        self::assertSame(self::RFC_BODY, Base64Url::encode($body));
    }

    public function testDecryptsTheRfcVectorOnTheUserAgentSide(): void
    {
        self::assertSame(
            self::RFC_PLAINTEXT,
            self::decrypt(Base64Url::decode(self::RFC_BODY), self::RFC_UA_PRIVATE, self::RFC_AUTH),
        );
    }

    public function testRoundTripsWithRandomKeysAndSalt(): void
    {
        $ua = P256::generate();
        $uaPrivate = self::scalar($ua);
        $auth = Base64Url::encode(str_repeat("\x07", 16));
        $body = WebPushCrypto::encrypt('{"type":"sync_available"}', Base64Url::encode(P256::point($ua)), $auth);

        self::assertSame('{"type":"sync_available"}', self::decrypt($body, Base64Url::encode($uaPrivate), $auth));
    }

    public function testRejectsMalformedSubscriptionKeys(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        WebPushCrypto::encrypt('x', 'AAAA', 'AAAA');
    }

    public function testRejectsAPointNotOnTheCurve(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        WebPushCrypto::encrypt('x', Base64Url::encode("\x04" . str_repeat("\x01", 64)), self::RFC_AUTH);
    }

    public function testRejectsMessagesLargerThanOneRecord(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        WebPushCrypto::encrypt(str_repeat('x', 4000), self::RFC_UA_PUBLIC, self::RFC_AUTH);
    }

    public function testSignsAnEs256JwtForThePushServiceOrigin(): void
    {
        $keys = VapidKeys::generate();
        $header = Vapid::authorization(
            'https://push.example.net/send/abc',
            $keys,
            'mailto:admin@example.com',
            1_700_000_000,
        );

        if (preg_match('/^vapid t=([^,]+), k=(.+)$/', $header, $match) !== 1) {
            self::fail("Unexpected header: {$header}");
        }
        self::assertSame($keys->publicKey, $match[2]);
        [$h, $c, $s] = explode('.', $match[1]);
        self::assertSame(['typ' => 'JWT', 'alg' => 'ES256'], json_decode(Base64Url::decode($h), true));
        self::assertSame(
            ['aud' => 'https://push.example.net', 'exp' => 1_700_000_000 + 43_200, 'sub' => 'mailto:admin@example.com'],
            json_decode(Base64Url::decode($c), true),
        );
        self::assertTrue(self::verify($keys->publicKey, "{$h}.{$c}", $s));
    }

    public function testLoadsAndUsesAKeyPairStoredByTheNodeServer(): void
    {
        $keys = VapidKeys::fromJson(self::NODE_VAPID);
        self::assertSame(
            'BG4K-CjY_04Mt69wdHayTgphvPy7ZqgbfkGcBFb8m7hvOEyvs7jbSjk6WVM5_tL_QBilC5dW7ySVtNRCjHGTAIM',
            $keys->publicKey,
        );
        self::assertSame(self::NODE_VAPID, $keys->toJson());

        $header = Vapid::authorization('https://fcm.googleapis.com/fcm/send/x', $keys, 'mailto:a@example.com');
        if (preg_match('/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=/', $header, $match) !== 1) {
            self::fail("Unexpected header: {$header}");
        }
        self::assertTrue(self::verify($keys->publicKey, "{$match[1]}.{$match[2]}", $match[3]));
    }

    public function testGeneratedKeysRoundTripThroughTheStoredFormat(): void
    {
        $keys = VapidKeys::generate();
        self::assertStringContainsString('-----BEGIN PRIVATE KEY-----', $keys->privateKey);
        self::assertSame(65, \strlen(Base64Url::decode($keys->publicKey)));
        self::assertEquals($keys, VapidKeys::fromJson($keys->toJson()));
    }

    public function testRejectsAStoredPairWhosePublicKeyDoesNotMatch(): void
    {
        $other = VapidKeys::generate();
        $json = json_encode(['publicKey' => $other->publicKey, 'privateKey' => VapidKeys::generate()->privateKey]);
        \assert(\is_string($json));

        $this->expectException(\InvalidArgumentException::class);
        VapidKeys::fromJson($json);
    }

    public function testOriginMatchesTheUrlApi(): void
    {
        self::assertSame('https://push.example.net', Vapid::origin('https://Push.Example.net:443/a?b#c'));
        self::assertSame('https://push.example.net:8443', Vapid::origin('https://push.example.net:8443/a'));
        self::assertSame('http://localhost:3000', Vapid::origin('http://localhost:3000/'));
    }

    public function testConvertsSignaturesBetweenDerAndRaw(): void
    {
        // r with a high bit (needs a 0x00 prefix in DER) and s with leading zeros.
        $raw = "\x80" . str_repeat("\x11", 31) . "\x00\x00" . str_repeat("\x22", 30);
        $der = P256::rawToDer($raw);
        self::assertSame('3043022100' . '80' . str_repeat('11', 31) . '021e' . str_repeat('22', 30), bin2hex($der));
        self::assertSame($raw, P256::derToRaw($der));
    }

    public function testBuildsAContentFreeSyncHint(): void
    {
        $keys = VapidKeys::fromJson(self::NODE_VAPID);
        $workspace = '0f8e2d4c-1a2b-4c3d-9e8f-001122334455';
        $request = PushRequest::syncAvailable(
            'https://fcm.googleapis.com/fcm/send/abc',
            self::RFC_UA_PUBLIC,
            self::RFC_AUTH,
            'install-1',
            $workspace,
            $keys,
            'mailto:admin@example.com',
            1_700_000_000,
        );

        self::assertSame('https://fcm.googleapis.com/fcm/send/abc', $request->url);
        self::assertSame(
            ['Authorization', 'Content-Encoding', 'Content-Type', 'TTL', 'Urgency', 'Topic'],
            array_keys($request->headers),
        );
        self::assertSame('aes128gcm', $request->headers['Content-Encoding']);
        self::assertSame('application/octet-stream', $request->headers['Content-Type']);
        self::assertSame('86400', $request->headers['TTL']);
        self::assertSame('normal', $request->headers['Urgency']);
        self::assertSame('0f8e2d4c1a2b4c3d9e8f001122334455', $request->headers['Topic']);
        self::assertStringStartsWith('vapid t=', $request->headers['Authorization']);
        self::assertStringEndsWith(', k=' . $keys->publicKey, $request->headers['Authorization']);

        self::assertSame(
            '{"type":"sync_available","installation":"install-1","workspace":"' . $workspace . '"}',
            self::decrypt($request->body, self::RFC_UA_PRIVATE, self::RFC_AUTH),
        );
    }

    public function testMatchesKnownPushServicesOnlyOverHttps(): void
    {
        $hosts = self::DEFAULT_ALLOWED_HOSTS;
        self::assertTrue(PushRequest::isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/abc', $hosts));
        self::assertTrue(PushRequest::isAllowedEndpoint('https://web.push.apple.com/abc', $hosts));
        self::assertTrue(PushRequest::isAllowedEndpoint('https://FCM.googleapis.com/x', $hosts));
        self::assertFalse(PushRequest::isAllowedEndpoint('https://push.apple.com.evil.net/abc', $hosts));
        self::assertFalse(PushRequest::isAllowedEndpoint('https://user:pw@fcm.googleapis.com/x', $hosts));
        self::assertFalse(PushRequest::isAllowedEndpoint('http://fcm.googleapis.com/x', $hosts));
        self::assertFalse(PushRequest::isAllowedEndpoint('https://127.0.0.1/x', $hosts));
        self::assertFalse(PushRequest::isAllowedEndpoint('not a url', $hosts));
        self::assertTrue(PushRequest::isGone(410));
        self::assertFalse(PushRequest::isGone(500));
    }

    /** User agent side of RFC 8291 (port of test/push-helpers.ts), to read what the server sends. */
    private static function decrypt(string $body, string $uaPrivate, string $auth): string
    {
        $salt = substr($body, 0, 16);
        $idlen = \ord($body[20]);
        $asPublic = substr($body, 21, $idlen);
        $ua = P256::privateKeyFromScalar(Base64Url::decode($uaPrivate));
        $shared = P256::sharedSecret($ua, P256::publicKeyFromPoint($asPublic));
        $keyInfo = "WebPush: info\x00" . P256::point($ua) . $asPublic;
        $ikm = hash_hkdf('sha256', $shared, 32, $keyInfo, Base64Url::decode($auth));
        $record = substr($body, 21 + $idlen);
        $plain = openssl_decrypt(
            substr($record, 0, -16),
            'aes-128-gcm',
            hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\x00", $salt),
            OPENSSL_RAW_DATA,
            hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\x00", $salt),
            substr($record, -16),
        );
        self::assertIsString($plain);
        self::assertSame("\x02", substr($plain, -1), 'missing record delimiter');

        return substr($plain, 0, -1);
    }

    private static function verify(string $publicKey, string $input, string $signature): bool
    {
        $key = P256::publicKeyFromPoint(Base64Url::decode($publicKey));

        return openssl_verify($input, P256::rawToDer(Base64Url::decode($signature)), $key, OPENSSL_ALGO_SHA256) === 1;
    }

    private static function scalar(\OpenSSLAsymmetricKey $key): string
    {
        $details = openssl_pkey_get_details($key);
        self::assertIsArray($details);
        self::assertIsArray($details['ec']);
        self::assertIsString($details['ec']['d']);

        return str_pad($details['ec']['d'], 32, "\x00", STR_PAD_LEFT);
    }
}
