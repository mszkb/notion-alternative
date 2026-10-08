<?php

declare(strict_types=1);

namespace NotionAlt\Push;

use OpenSSLAsymmetricKey;

/**
 * P-256 (prime256v1) helpers on ext-openssl: raw keys as Web Push uses them (uncompressed
 * points, 32-byte scalars) and ECDSA signatures in DER vs. IEEE P1363 (`r || s`) form.
 */
final class P256
{
    /** DER prefix of a SubjectPublicKeyInfo for an uncompressed P-256 point (RFC 5480). */
    private const SPKI_PREFIX = "\x30\x59\x30\x13\x06\x07\x2a\x86\x48\xce\x3d\x02\x01"
        . "\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07\x03\x42\x00";

    /** OID prime256v1 as context-specific [0] parameters of an ECPrivateKey (RFC 5915). */
    private const EC_PARAMETERS = "\xa0\x0a\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07";

    public static function generate(): OpenSSLAsymmetricKey
    {
        $key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        if ($key === false) {
            throw new \RuntimeException('Could not generate a P-256 key');
        }

        return $key;
    }

    /** Public key from an uncompressed point (65 bytes, 0x04 || x || y). */
    public static function publicKeyFromPoint(string $point): OpenSSLAsymmetricKey
    {
        if (\strlen($point) !== 65 || $point[0] !== "\x04") {
            throw new \InvalidArgumentException('Not an uncompressed P-256 point');
        }
        $key = openssl_pkey_get_public(self::pem('PUBLIC KEY', self::SPKI_PREFIX . $point));
        if ($key === false) {
            // Not on the curve.
            throw new \InvalidArgumentException('Invalid P-256 public key');
        }

        return $key;
    }

    /** Private key from its 32-byte scalar; OpenSSL derives the public point. */
    public static function privateKeyFromScalar(string $scalar): OpenSSLAsymmetricKey
    {
        if (\strlen($scalar) !== 32) {
            throw new \InvalidArgumentException('Not a P-256 private key');
        }
        $der = "\x30\x31\x02\x01\x01\x04\x20" . $scalar . self::EC_PARAMETERS;
        $key = openssl_pkey_get_private(self::pem('EC PRIVATE KEY', $der));
        if ($key === false) {
            throw new \InvalidArgumentException('Invalid P-256 private key');
        }

        return $key;
    }

    /** Uncompressed point of a P-256 key (public, or the public half of a private key). */
    public static function point(OpenSSLAsymmetricKey $key): string
    {
        $details = openssl_pkey_get_details($key);
        $ec = \is_array($details) ? ($details['ec'] ?? null) : null;
        if (
            !\is_array($ec) || ($ec['curve_name'] ?? null) !== 'prime256v1'
            || !\is_string($ec['x'] ?? null) || !\is_string($ec['y'] ?? null)
        ) {
            throw new \InvalidArgumentException('Not a P-256 key');
        }

        return "\x04" . self::pad32($ec['x']) . self::pad32($ec['y']);
    }

    /** ECDH shared secret (x coordinate, 32 bytes). */
    public static function sharedSecret(OpenSSLAsymmetricKey $privateKey, OpenSSLAsymmetricKey $peer): string
    {
        $secret = openssl_pkey_derive($peer, $privateKey, 32);
        if ($secret === false || \strlen($secret) !== 32) {
            throw new \RuntimeException('ECDH failed');
        }

        return $secret;
    }

    /** DER `SEQUENCE { INTEGER r, INTEGER s }` (OpenSSL) → `r || s` with 32 bytes each (JWS). */
    public static function derToRaw(string $der): string
    {
        $offset = 0;
        self::readHeader($der, $offset, 0x30);
        $r = self::readInteger($der, $offset);
        $s = self::readInteger($der, $offset);
        if ($offset !== \strlen($der)) {
            throw new \InvalidArgumentException('Trailing bytes in ECDSA signature');
        }

        return $r . $s;
    }

    /** `r || s` → DER, for `openssl_verify`. */
    public static function rawToDer(string $raw): string
    {
        if (\strlen($raw) !== 64) {
            throw new \InvalidArgumentException('Not a P-256 signature');
        }
        $body = self::derInteger(substr($raw, 0, 32)) . self::derInteger(substr($raw, 32));

        return "\x30" . self::derLength(\strlen($body)) . $body;
    }

    private static function pem(string $label, string $der): string
    {
        return "-----BEGIN {$label}-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END {$label}-----\n";
    }

    private static function pad32(string $bytes): string
    {
        $bytes = ltrim($bytes, "\x00");
        if (\strlen($bytes) > 32) {
            throw new \InvalidArgumentException('Value exceeds 32 bytes');
        }

        return str_pad($bytes, 32, "\x00", STR_PAD_LEFT);
    }

    private static function readHeader(string $der, int &$offset, int $tag): int
    {
        if ($offset + 2 > \strlen($der) || \ord($der[$offset]) !== $tag) {
            throw new \InvalidArgumentException('Malformed ECDSA signature');
        }
        $length = \ord($der[$offset + 1]);
        $offset += 2;
        if ($length === 0x81) {
            if ($offset >= \strlen($der)) {
                throw new \InvalidArgumentException('Malformed ECDSA signature');
            }
            $length = \ord($der[$offset]);
            $offset++;
        } elseif ($length > 0x7f) {
            throw new \InvalidArgumentException('Malformed ECDSA signature');
        }
        if ($offset + $length > \strlen($der)) {
            throw new \InvalidArgumentException('Malformed ECDSA signature');
        }

        return $length;
    }

    private static function readInteger(string $der, int &$offset): string
    {
        $length = self::readHeader($der, $offset, 0x02);
        $value = substr($der, $offset, $length);
        $offset += $length;

        return self::pad32($value);
    }

    private static function derInteger(string $unsigned): string
    {
        $value = ltrim($unsigned, "\x00");
        // Positive INTEGER: a set high bit needs a leading zero byte.
        if ($value === '' || \ord($value[0]) & 0x80) {
            $value = "\x00" . $value;
        }

        return "\x02" . self::derLength(\strlen($value)) . $value;
    }

    private static function derLength(int $length): string
    {
        return $length < 0x80 ? \chr($length) : "\x81" . \chr($length);
    }
}
