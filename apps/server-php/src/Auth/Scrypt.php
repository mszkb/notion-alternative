<?php

declare(strict_types=1);

namespace NotionAlt\Auth;

/**
 * Pure-PHP scrypt (RFC 7914) to verify the password hashes of the Node server
 * (`scrypt$N$r$p$salt$hash`, ADR 0018); PHP has no scrypt without an extension.
 *
 * Slow by nature (seconds for N=2^15, r=8): it runs once per account, the first successful
 * login replaces the hash with `password_hash()`.
 */
final class Scrypt
{
    /** Upper bound of N * r * p: 128 * N * r bytes stay within Node's default `maxmem` (128 MiB). */
    private const MAX_COST = 1 << 20;

    /**
     * Derives `$length` bytes; throws for parameters outside RFC 7914 or too costly.
     */
    public static function derive(string $password, string $salt, int $n, int $r, int $p, int $length): string
    {
        if ($n < 2 || ($n & ($n - 1)) !== 0 || $r < 1 || $p < 1 || $length < 1 || $length > 1024 || $n * $r * $p > self::MAX_COST) {
            throw new \InvalidArgumentException('Unsupported scrypt parameters');
        }
        $blockBytes = 128 * $r;
        $b = hash_pbkdf2('sha256', $password, $salt, 1, $p * $blockBytes, true);
        $mixed = '';
        for ($k = 0; $k < $p; $k++) {
            $mixed .= self::roMix(substr($b, $k * $blockBytes, $blockBytes), $n, $r);
        }

        return hash_pbkdf2('sha256', $password, $mixed, 1, $length, true);
    }

    private static function roMix(string $block, int $n, int $r): string
    {
        $x = array_values(self::words($block));
        // V holds packed strings: far less memory than N arrays of 32 r integers.
        $v = [];
        for ($i = 0; $i < $n; $i++) {
            $v[$i] = pack('V*', ...$x);
            $x = self::blockMix($x, $r);
        }
        $last = (2 * $r - 1) * 16;
        $mask = $n - 1;
        for ($i = 0; $i < $n; $i++) {
            $vj = self::words($v[$x[$last] & $mask]);
            foreach ($x as $index => $word) {
                $x[$index] = $word ^ $vj[$index + 1];
            }
            $x = self::blockMix($x, $r);
        }

        return pack('V*', ...$x);
    }

    /**
     * @return array<int, int> little-endian 32-bit words, keys from 1 (`unpack`)
     */
    private static function words(string $bytes): array
    {
        /** @var array<int, int>|false $words */
        $words = unpack('V*', $bytes);
        if ($words === false) {
            throw new \LogicException('unpack failed');
        }

        return $words;
    }

    /**
     * BlockMix with the Salsa20/8 core, unrolled for speed.
     *
     * @param list<int> $b
     *
     * @return list<int>
     */
    private static function blockMix(array $b, int $r): array
    {
        $blocks = 2 * $r;
        $o = ($blocks - 1) * 16;
        $x0 = $b[$o + 0];
        $x1 = $b[$o + 1];
        $x2 = $b[$o + 2];
        $x3 = $b[$o + 3];
        $x4 = $b[$o + 4];
        $x5 = $b[$o + 5];
        $x6 = $b[$o + 6];
        $x7 = $b[$o + 7];
        $x8 = $b[$o + 8];
        $x9 = $b[$o + 9];
        $x10 = $b[$o + 10];
        $x11 = $b[$o + 11];
        $x12 = $b[$o + 12];
        $x13 = $b[$o + 13];
        $x14 = $b[$o + 14];
        $x15 = $b[$o + 15];
        $y = [];
        for ($k = 0; $k < $blocks; $k++) {
            $q = $k * 16;
            $x0 ^= $b[$q + 0];
            $x1 ^= $b[$q + 1];
            $x2 ^= $b[$q + 2];
            $x3 ^= $b[$q + 3];
            $x4 ^= $b[$q + 4];
            $x5 ^= $b[$q + 5];
            $x6 ^= $b[$q + 6];
            $x7 ^= $b[$q + 7];
            $x8 ^= $b[$q + 8];
            $x9 ^= $b[$q + 9];
            $x10 ^= $b[$q + 10];
            $x11 ^= $b[$q + 11];
            $x12 ^= $b[$q + 12];
            $x13 ^= $b[$q + 13];
            $x14 ^= $b[$q + 14];
            $x15 ^= $b[$q + 15];
            $s0 = $x0;
            $s1 = $x1;
            $s2 = $x2;
            $s3 = $x3;
            $s4 = $x4;
            $s5 = $x5;
            $s6 = $x6;
            $s7 = $x7;
            $s8 = $x8;
            $s9 = $x9;
            $s10 = $x10;
            $s11 = $x11;
            $s12 = $x12;
            $s13 = $x13;
            $s14 = $x14;
            $s15 = $x15;
            for ($round = 0; $round < 4; $round++) {
                $t = ($x0 + $x12) & 0xffffffff;
                $x4 ^= (($t << 7) & 0xffffffff) | ($t >> 25);
                $t = ($x4 + $x0) & 0xffffffff;
                $x8 ^= (($t << 9) & 0xffffffff) | ($t >> 23);
                $t = ($x8 + $x4) & 0xffffffff;
                $x12 ^= (($t << 13) & 0xffffffff) | ($t >> 19);
                $t = ($x12 + $x8) & 0xffffffff;
                $x0 ^= (($t << 18) & 0xffffffff) | ($t >> 14);
                $t = ($x5 + $x1) & 0xffffffff;
                $x9 ^= (($t << 7) & 0xffffffff) | ($t >> 25);
                $t = ($x9 + $x5) & 0xffffffff;
                $x13 ^= (($t << 9) & 0xffffffff) | ($t >> 23);
                $t = ($x13 + $x9) & 0xffffffff;
                $x1 ^= (($t << 13) & 0xffffffff) | ($t >> 19);
                $t = ($x1 + $x13) & 0xffffffff;
                $x5 ^= (($t << 18) & 0xffffffff) | ($t >> 14);
                $t = ($x10 + $x6) & 0xffffffff;
                $x14 ^= (($t << 7) & 0xffffffff) | ($t >> 25);
                $t = ($x14 + $x10) & 0xffffffff;
                $x2 ^= (($t << 9) & 0xffffffff) | ($t >> 23);
                $t = ($x2 + $x14) & 0xffffffff;
                $x6 ^= (($t << 13) & 0xffffffff) | ($t >> 19);
                $t = ($x6 + $x2) & 0xffffffff;
                $x10 ^= (($t << 18) & 0xffffffff) | ($t >> 14);
                $t = ($x15 + $x11) & 0xffffffff;
                $x3 ^= (($t << 7) & 0xffffffff) | ($t >> 25);
                $t = ($x3 + $x15) & 0xffffffff;
                $x7 ^= (($t << 9) & 0xffffffff) | ($t >> 23);
                $t = ($x7 + $x3) & 0xffffffff;
                $x11 ^= (($t << 13) & 0xffffffff) | ($t >> 19);
                $t = ($x11 + $x7) & 0xffffffff;
                $x15 ^= (($t << 18) & 0xffffffff) | ($t >> 14);
                $t = ($x0 + $x3) & 0xffffffff;
                $x1 ^= (($t << 7) & 0xffffffff) | ($t >> 25);
                $t = ($x1 + $x0) & 0xffffffff;
                $x2 ^= (($t << 9) & 0xffffffff) | ($t >> 23);
                $t = ($x2 + $x1) & 0xffffffff;
                $x3 ^= (($t << 13) & 0xffffffff) | ($t >> 19);
                $t = ($x3 + $x2) & 0xffffffff;
                $x0 ^= (($t << 18) & 0xffffffff) | ($t >> 14);
                $t = ($x5 + $x4) & 0xffffffff;
                $x6 ^= (($t << 7) & 0xffffffff) | ($t >> 25);
                $t = ($x6 + $x5) & 0xffffffff;
                $x7 ^= (($t << 9) & 0xffffffff) | ($t >> 23);
                $t = ($x7 + $x6) & 0xffffffff;
                $x4 ^= (($t << 13) & 0xffffffff) | ($t >> 19);
                $t = ($x4 + $x7) & 0xffffffff;
                $x5 ^= (($t << 18) & 0xffffffff) | ($t >> 14);
                $t = ($x10 + $x9) & 0xffffffff;
                $x11 ^= (($t << 7) & 0xffffffff) | ($t >> 25);
                $t = ($x11 + $x10) & 0xffffffff;
                $x8 ^= (($t << 9) & 0xffffffff) | ($t >> 23);
                $t = ($x8 + $x11) & 0xffffffff;
                $x9 ^= (($t << 13) & 0xffffffff) | ($t >> 19);
                $t = ($x9 + $x8) & 0xffffffff;
                $x10 ^= (($t << 18) & 0xffffffff) | ($t >> 14);
                $t = ($x15 + $x14) & 0xffffffff;
                $x12 ^= (($t << 7) & 0xffffffff) | ($t >> 25);
                $t = ($x12 + $x15) & 0xffffffff;
                $x13 ^= (($t << 9) & 0xffffffff) | ($t >> 23);
                $t = ($x13 + $x12) & 0xffffffff;
                $x14 ^= (($t << 13) & 0xffffffff) | ($t >> 19);
                $t = ($x14 + $x13) & 0xffffffff;
                $x15 ^= (($t << 18) & 0xffffffff) | ($t >> 14);
            }
            $x0 = ($x0 + $s0) & 0xffffffff;
            $x1 = ($x1 + $s1) & 0xffffffff;
            $x2 = ($x2 + $s2) & 0xffffffff;
            $x3 = ($x3 + $s3) & 0xffffffff;
            $x4 = ($x4 + $s4) & 0xffffffff;
            $x5 = ($x5 + $s5) & 0xffffffff;
            $x6 = ($x6 + $s6) & 0xffffffff;
            $x7 = ($x7 + $s7) & 0xffffffff;
            $x8 = ($x8 + $s8) & 0xffffffff;
            $x9 = ($x9 + $s9) & 0xffffffff;
            $x10 = ($x10 + $s10) & 0xffffffff;
            $x11 = ($x11 + $s11) & 0xffffffff;
            $x12 = ($x12 + $s12) & 0xffffffff;
            $x13 = ($x13 + $s13) & 0xffffffff;
            $x14 = ($x14 + $s14) & 0xffffffff;
            $x15 = ($x15 + $s15) & 0xffffffff;
            $y[$k] = [$x0, $x1, $x2, $x3, $x4, $x5, $x6, $x7, $x8, $x9, $x10, $x11, $x12, $x13, $x14, $x15];
        }
        // Even blocks first, then odd ones.
        $out = [];
        for ($k = 0; $k < $blocks; $k += 2) {
            array_push($out, ...$y[$k]);
        }
        for ($k = 1; $k < $blocks; $k += 2) {
            array_push($out, ...$y[$k]);
        }

        return $out;
    }
}
