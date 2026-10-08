<?php

declare(strict_types=1);

namespace NotionAlt\Auth;

/**
 * Password hashes (ADR 0018): `password_hash()` with Argon2id, else bcrypt. Hashes of other
 * formats (e.g. scrypt of the former Node server) never verify; such accounts get a new password
 * with `bin/console reset-password`.
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
        return password_verify($password, $stored);
    }

    /** True for `password_hash()` hashes of older algorithms or options. */
    public static function needsRehash(string $stored): bool
    {
        return password_needs_rehash($stored, self::algorithm());
    }

    private static function algorithm(): string
    {
        return \defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    }
}
