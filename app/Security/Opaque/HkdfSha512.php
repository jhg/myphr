<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use InvalidArgumentException;

/**
 * HKDF instantiated with HMAC-SHA-512, per RFC 5869.
 *
 * A manual implementation (we do not use `hash_hkdf()`) so the behaviour is
 * pinned by this code and not by how PHP's `hash` extension reads the spec.
 * Every input and output is a binary string: we never go through hexadecimal
 * representations or `mb_*` functions.
 *
 * @see https://www.rfc-editor.org/rfc/rfc5869 RFC 5869
 */
final class HkdfSha512
{
    /**
     * SHA-512 HashLen in bytes (RFC 5869 §2).
     */
    public const int HASH_LENGTH = 64;

    /**
     * SHA-512 internal block in bytes; size of the default zero salt.
     */
    public const int BLOCK_LENGTH = 128;

    /**
     * Maximum Expand output length: 255 * HashLen (RFC 5869 §2.3).
     */
    public const int MAX_OUTPUT_LENGTH = 255 * self::HASH_LENGTH;

    private function __construct() {}

    /**
     * HKDF-Extract (RFC 5869 §2.2).
     *
     * PRK = HMAC-SHA-512(key = salt, data = IKM)
     *
     * If `$salt` is the empty string it is replaced by HashLen (64) zero bytes,
     * exactly as RFC 5869 §2.2 requires ("if not provided, it is set to a string
     * of HashLen zeros").
     *
     * @param  string  $salt  Binary salt, optionally empty. Arbitrary length.
     * @param  string  $ikm  Binary Input Keying Material. Arbitrary length.
     * @return string Binary PRK of exactly 64 bytes.
     */
    public static function extract(string $salt, string $ikm): string
    {
        if ($salt === '') {
            $salt = str_repeat("\x00", self::HASH_LENGTH);
        }

        return hash_hmac('sha512', $ikm, $salt, true);
    }

    /**
     * HKDF-Expand (RFC 5869 §2.3).
     *
     * T(0) = ""
     * T(i) = HMAC-SHA-512(key = PRK, data = T(i-1) || info || I2OSP(i, 1))
     * OKM  = first L bytes of T(1) || T(2) || ... || T(N)
     *
     * The counter `i` takes a single byte, which limits N to 255 and therefore
     * L to 255 * 64 = 16320 bytes.
     *
     * @param  string  $prk  Binary pseudorandom key. RFC 5869 §2.3 requires at
     *                       least HashLen (64) bytes.
     * @param  string  $info  Binary context information, possibly empty.
     * @param  int  $length  L, output length in bytes. 1 <= L <= 16320.
     * @return string Binary OKM of exactly `$length` bytes.
     *
     * @throws InvalidArgumentException If `$length` is out of range. This is a
     *                                  caller error, never reachable from
     *                                  remote input.
     * @throws InvalidConfigurationException If `$prk` is shorter than HashLen
     *                                       bytes. A short PRK can only come
     *                                       from misconfigured static material
     *                                       (`oprf_seed`, say), so it belongs to
     *                                       the `docs/OPAQUE.md` §18 hierarchy
     *                                       and the HTTP layer collapses it with
     *                                       the rest of the subsystem errors.
     */
    public static function expand(string $prk, string $info, int $length): string
    {
        if ($length < 1 || $length > self::MAX_OUTPUT_LENGTH) {
            throw new InvalidArgumentException(
                'HKDF-Expand: the length must be between 1 and '.self::MAX_OUTPUT_LENGTH.' bytes, got '.$length.'.'
            );
        }

        if (strlen($prk) < self::HASH_LENGTH) {
            throw new InvalidConfigurationException(
                'HKDF-Expand: the PRK must be at least '.self::HASH_LENGTH.' bytes, got '.strlen($prk).'.'
            );
        }

        $blockCount = intdiv($length + self::HASH_LENGTH - 1, self::HASH_LENGTH);

        $okm = '';
        $previousBlock = '';

        for ($counter = 1; $counter <= $blockCount; $counter++) {
            $previousBlock = hash_hmac(
                'sha512',
                $previousBlock.$info.chr($counter),
                $prk,
                true
            );
            $okm .= $previousBlock;
        }

        return substr($okm, 0, $length);
    }
}
