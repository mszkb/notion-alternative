<?php

declare(strict_types=1);

namespace NotionAlt\Push;

use OpenSSLAsymmetricKey;

/**
 * VAPID key pair of an installation, stored as JSON in
 * `settings` (key `vapid`): `{"publicKey": <uncompressed point, base64url>, "privateKey": <PKCS#8 PEM>}`.
 */
final class VapidKeys
{
    public function __construct(
        /** Uncompressed public point, base64url (the browser's applicationServerKey). */
        public readonly string $publicKey,
        /** Private key as PEM (PKCS#8; SEC1 is read too). */
        #[\SensitiveParameter]
        public readonly string $privateKey,
    ) {}

    public static function generate(): self
    {
        $key = P256::generate();
        if (!openssl_pkey_export($key, $pem)) {
            throw new \RuntimeException('Could not export the VAPID key');
        }
        \assert(\is_string($pem));

        return new self(Base64Url::encode(P256::point($key)), $pem);
    }

    /** Parses the stored `settings.value`; throws if it is not a usable key pair. */
    public static function fromJson(string $json): self
    {
        $data = json_decode($json, true, 4, JSON_THROW_ON_ERROR);
        if (!\is_array($data) || !\is_string($data['publicKey'] ?? null) || !\is_string($data['privateKey'] ?? null)) {
            throw new \InvalidArgumentException('Invalid VAPID key pair');
        }
        $keys = new self($data['publicKey'], $data['privateKey']);
        if (Base64Url::decode($keys->publicKey) !== P256::point($keys->privateKey())) {
            throw new \InvalidArgumentException('VAPID public key does not match the private key');
        }

        return $keys;
    }

    /** The JSON stored in `settings` (`vapid`). */
    public function toJson(): string
    {
        return json_encode(
            ['publicKey' => $this->publicKey, 'privateKey' => $this->privateKey],
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES,
        );
    }

    public function privateKey(): OpenSSLAsymmetricKey
    {
        $key = openssl_pkey_get_private($this->privateKey);
        if ($key === false) {
            throw new \InvalidArgumentException('Invalid VAPID private key');
        }

        return $key;
    }
}
