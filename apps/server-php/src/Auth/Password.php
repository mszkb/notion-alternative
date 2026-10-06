<?php

declare(strict_types=1);

namespace NotionAlt\Auth;

/**
 * Password hashes (ADR 0018): new ones via `password_hash()` (Argon2id, else bcrypt); the
 * `scrypt$N$r$p$salt$hash` hashes of the Node server are verified and replaced on login.
 */
final class Password
{
    /** Compared against when the user does not exist, so login timing does not reveal accounts. */
    private const DUMMY_ARGON2ID = '$argon2id$v=19$m=65536,t=4,p=1$YnlxNXpHSE9jRFMvRDdETw$h/9Rd6+V84pbaTJTGZERyICN4WeJsJF0LIyWNsP8Ny8';

    private const DUMMY_BCRYPT = '$2y$10$HoMTHpGs5TdJIJ6BNPSOc.BC.r4QWfEYhT75WvZG4T7sSbTkEDv72';

    public static function hash(string $password): string
    {
        return password_hash($password, self::algorithm());
    }

    /** A hash of the current algorithm that matches no real password. */
    public static function dummyHash(): string
    {
        return \defined('PASSWORD_ARGON2ID') ? self::DUMMY_ARGON2ID : self::DUMMY_BCRYPT;
    }

    public static function verify(string $password, string $stored): bool
    {
        if (str_starts_with($stored, 'scrypt$')) {
            return self::verifyScrypt($password, $stored);
        }

        return password_verify($password, $stored);
    }

    /** True for Node scrypt hashes and `password_hash()` hashes of older algorithms or options. */
    public static function needsRehash(string $stored): bool
    {
        return str_starts_with($stored, 'scrypt$') || password_needs_rehash($stored, self::algorithm());
    }

    private static function algorithm(): string
    {
        return \defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    }

    /** Port of `verifyPassword` in apps/server/src/auth/password.ts. */
    private static function verifyScrypt(string $password, string $stored): bool
    {
        $parts = explode('$', $stored);
        if (\count($parts) !== 6) {
            return false;
        }
        [, $n, $r, $p, $salt, $hash] = $parts;
        foreach ([$n, $r, $p] as $number) {
            if (!ctype_digit($number)) {
                return false;
            }
        }
        $saltBytes = base64_decode($salt, true);
        $expected = base64_decode($hash, true);
        if ($saltBytes === false || $expected === false || $salt === '' || $expected === '') {
            return false;
        }
        try {
            $actual = Scrypt::derive($password, $saltBytes, (int) $n, (int) $r, (int) $p, \strlen($expected));
        } catch (\InvalidArgumentException) {
            return false;
        }

        return hash_equals($expected, $actual);
    }
}
