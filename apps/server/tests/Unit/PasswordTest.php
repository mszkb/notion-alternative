<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Auth\Password;
use PHPUnit\Framework\TestCase;

final class PasswordTest extends TestCase
{
    /** A hash of the former Node server (scrypt, N=2^15, r=8, p=1). */
    public const NODE_HASH = 'scrypt$32768$8$1$jjgFGHmHv9sTTjm486RjyA==$rzgSAuM4Bdie69CjSef2wQslANQw0idBgkVXoHaYoEX2m2JuYRRK/zTQSoU1KBRmh2KXvhpygcPcZ0rDqDxvaQ==';

    public const NODE_PASSWORD = 'correct horse battery staple';

    /** ADR 0018: scrypt hashes of the Node server are not taken over. */
    public function testNodeHashesNeverVerify(): void
    {
        self::assertFalse(Password::verify(self::NODE_PASSWORD, self::NODE_HASH));
        foreach (['garbage', '', 'scrypt$'] as $stored) {
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
