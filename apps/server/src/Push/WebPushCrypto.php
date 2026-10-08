<?php

declare(strict_types=1);

namespace NotionAlt\Push;

use OpenSSLAsymmetricKey;

/**
 * Web Push message encryption (RFC 8291, aes128gcm per RFC 8188) on ext-openssl only (ADR 0005).
 */
final class WebPushCrypto
{
    public const RECORD_SIZE = 4096;

    /**
     * Encrypts a push message body as a single record.
     *
     * @param string $p256dh user agent public key (uncompressed P-256 point, base64url)
     * @param string $auth user agent authentication secret (16 bytes, base64url)
     * @param OpenSSLAsymmetricKey|null $serverKey ephemeral key; fixed only for test vectors
     * @param string|null $salt 16 bytes; fixed only for test vectors
     *
     * @throws \InvalidArgumentException for unusable subscription keys
     */
    public static function encrypt(
        string $plaintext,
        string $p256dh,
        string $auth,
        ?OpenSSLAsymmetricKey $serverKey = null,
        ?string $salt = null,
    ): string {
        $uaPublic = Base64Url::decode($p256dh);
        $authSecret = Base64Url::decode($auth);
        if (\strlen($uaPublic) !== 65 || \strlen($authSecret) !== 16) {
            throw new \InvalidArgumentException('Invalid push keys');
        }
        $uaKey = P256::publicKeyFromPoint($uaPublic);

        $serverKey ??= P256::generate();
        $asPublic = P256::point($serverKey);
        $sharedSecret = P256::sharedSecret($serverKey, $uaKey);
        $salt ??= random_bytes(16);
        if (\strlen($salt) !== 16) {
            throw new \InvalidArgumentException('Salt must be 16 bytes');
        }

        $keyInfo = "WebPush: info\x00" . $uaPublic . $asPublic;
        $ikm = hash_hkdf('sha256', $sharedSecret, 32, $keyInfo, $authSecret);
        $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\x00", $salt);
        $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\x00", $salt);

        // Last (and only) record: padding delimiter 0x02, no further padding.
        $tag = '';
        $ciphertext = openssl_encrypt($plaintext . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
        if ($ciphertext === false) {
            throw new \RuntimeException('AES-GCM encryption failed');
        }
        $encrypted = $ciphertext . $tag;
        if (\strlen($encrypted) + 86 > self::RECORD_SIZE) {
            throw new \InvalidArgumentException('Push message too large');
        }

        return $salt . pack('N', self::RECORD_SIZE) . \chr(\strlen($asPublic)) . $asPublic . $encrypted;
    }
}
