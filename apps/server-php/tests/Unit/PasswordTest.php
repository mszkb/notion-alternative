<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Auth\Password;
use NotionAlt\Auth\Scrypt;
use PHPUnit\Framework\TestCase;

final class PasswordTest extends TestCase
{
    /** Created by `hashPassword()` of apps/server/src/auth/password.ts (N=2^15, r=8, p=1). */
    public const NODE_HASH = 'scrypt$32768$8$1$jjgFGHmHv9sTTjm486RjyA==$rzgSAuM4Bdie69CjSef2wQslANQw0idBgkVXoHaYoEX2m2JuYRRK/zTQSoU1KBRmh2KXvhpygcPcZ0rDqDxvaQ==';

    public const NODE_PASSWORD = 'correct horse battery staple';

    public function testScryptMatchesTheRfc7914TestVectors(): void
    {
        self::assertSame(
            '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
            bin2hex(Scrypt::derive('', '', 16, 1, 1, 64)),
        );
        self::assertSame(
            'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
            bin2hex(Scrypt::derive('password', 'NaCl', 1024, 8, 16, 64)),
        );
    }

    public function testScryptRejectsUnsupportedParameters(): void
    {
        foreach ([[3, 8, 1], [0, 8, 1], [16, 0, 1], [16, 1, 0], [1 << 20, 8, 1]] as [$n, $r, $p]) {
            try {
                Scrypt::derive('x', 'y', $n, $r, $p, 64);
                self::fail("accepted N={$n} r={$r} p={$p}");
            } catch (\InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
    }

    public function testVerifiesAHashCreatedByTheNodeServer(): void
    {
        self::assertTrue(Password::verify(self::NODE_PASSWORD, self::NODE_HASH));
        self::assertTrue(Password::needsRehash(self::NODE_HASH));
    }

    public function testRejectsWrongPasswordsForNodeHashes(): void
    {
        // Cheap parameters: the result only has to differ.
        $salt = 'c2FsdHNhbHRzYWx0';
        $hash = base64_encode(Scrypt::derive('right', (string) base64_decode($salt, true), 16, 1, 1, 64));
        self::assertTrue(Password::verify('right', "scrypt\$16\$1\$1\${$salt}\${$hash}"));
        self::assertFalse(Password::verify('wrong', "scrypt\$16\$1\$1\${$salt}\${$hash}"));
    }

    public function testRejectsMalformedHashes(): void
    {
        foreach (['garbage', 'scrypt$', 'scrypt$x$8$1$c2FsdA==$aGFzaA==', 'scrypt$16$1$1$$aGFzaA==', 'scrypt$15$1$1$c2FsdA==$aGFzaA==', 'scrypt$16$1$1$c2FsdA==$!!'] as $stored) {
            self::assertFalse(Password::verify('x', $stored), $stored);
        }
    }

    public function testNewHashesUsePasswordHash(): void
    {
        $hash = Password::hash('a long passphrase');
        self::assertTrue(Password::verify('a long passphrase', $hash));
        self::assertFalse(Password::verify('another passphrase', $hash));
        self::assertFalse(Password::needsRehash($hash));
        self::assertNotSame($hash, Password::hash('a long passphrase'));
        self::assertSame(\defined('PASSWORD_ARGON2ID') ? 'argon2id' : '2y', password_get_info($hash)['algo']);
    }

    public function testTheDummyHashUsesTheCurrentAlgorithm(): void
    {
        self::assertFalse(Password::needsRehash(Password::dummyHash()));
        self::assertFalse(Password::verify('correct horse battery staple', Password::dummyHash()));
    }
}
