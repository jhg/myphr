<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use InvalidArgumentException;

/**
 * expand_message_xmd instantiated with SHA-512 (RFC 9380 §5.3.1).
 *
 * Instance parameters:
 * - H = SHA-512
 * - b_in_bytes = 64 (output size of H)
 * - s_in_bytes = 128 (input block size of H)
 *
 * Every string is binary. No `mb_*` functions are used.
 */
final class ExpandMessageXmdSha512
{
    /** SHA-512 output size in bytes (b_in_bytes, RFC 9380 §5.3.1). */
    private const int B_IN_BYTES = 64;

    /** SHA-512 input block size in bytes (s_in_bytes, RFC 9380 §5.3.1). */
    private const int S_IN_BYTES = 128;

    /** DST limit accepted by expand_message_xmd (RFC 9380 §5.3.1, step 2). */
    private const int MAX_DST_LENGTH = 255;

    /** Upper bound of len_in_bytes (RFC 9380 §5.3.1, step 2). */
    private const int MAX_LEN_IN_BYTES = 65535;

    /** Limit on the number of blocks ell (RFC 9380 §5.3.1, step 2). */
    private const int MAX_ELL = 255;

    /** 17-byte ASCII literal used to shrink oversized DSTs (RFC 9380 §5.3.3). */
    private const string OVERSIZE_DST_PREFIX = 'H2C-OVERSIZE-DST-';

    /**
     * Derives `len_in_bytes` uniform bytes from a message and a DST.
     *
     * Algorithm (RFC 9380 §5.3.1):
     *   DST_prime = DST || I2OSP(len(DST), 1)
     *   Z_pad     = I2OSP(0, 128)
     *   l_i_b_str = I2OSP(len_in_bytes, 2)
     *   msg_prime = Z_pad || msg || l_i_b_str || I2OSP(0, 1) || DST_prime
     *   b_0 = H(msg_prime)
     *   b_1 = H(b_0 || I2OSP(1, 1) || DST_prime)
     *   b_i = H(strxor(b_0, b_(i-1)) || I2OSP(i, 1) || DST_prime)   for i = 2..ell
     *   return substr(b_1 || ... || b_ell, 0, len_in_bytes)
     *
     * If `len(DST) > 255` the DST is first replaced by
     * `SHA-512("H2C-OVERSIZE-DST-" || DST)` (64 bytes), per RFC 9380 §5.3.3.
     *
     * @param  string  $message  msg: binary string of arbitrary length.
     * @param  string  $dst  DST: binary string (domain separation tag).
     * @param  int  $lengthInBytes  len_in_bytes: 0..65535, with ceil(len/64) <= 255.
     * @return string uniform_bytes: exactly `$lengthInBytes` bytes.
     *
     * @throws InvalidArgumentException if `$lengthInBytes` is negative, greater
     *                                  than 65535, or if ell > 255.
     */
    public static function expand(string $message, string $dst, int $lengthInBytes): string
    {
        if ($lengthInBytes < 0) {
            throw new InvalidArgumentException('len_in_bytes must not be negative.');
        }

        if ($lengthInBytes > self::MAX_LEN_IN_BYTES) {
            throw new InvalidArgumentException('len_in_bytes must not exceed '.self::MAX_LEN_IN_BYTES.'.');
        }

        $ell = intdiv($lengthInBytes + self::B_IN_BYTES - 1, self::B_IN_BYTES);

        if ($ell > self::MAX_ELL) {
            throw new InvalidArgumentException('ell must not exceed '.self::MAX_ELL.'.');
        }

        if ($ell === 0) {
            return '';
        }

        $dstPrime = self::dstPrime($dst);

        $messagePrime = str_repeat("\x00", self::S_IN_BYTES)
            .$message
            .pack('n', $lengthInBytes)
            .chr(0)
            .$dstPrime;

        $b0 = hash('sha512', $messagePrime, true);

        $previous = hash('sha512', $b0.chr(1).$dstPrime, true);
        $uniformBytes = $previous;

        for ($i = 2; $i <= $ell; $i++) {
            $previous = hash('sha512', self::xor($b0, $previous).chr($i).$dstPrime, true);
            $uniformBytes .= $previous;
        }

        return substr($uniformBytes, 0, $lengthInBytes);
    }

    /**
     * Builds DST_prime = DST || I2OSP(len(DST), 1) (RFC 9380 §5.3.1, step 3),
     * first applying the mandatory reduction from RFC 9380 §5.3.3 when the DST
     * is longer than 255 bytes.
     *
     * @param  string  $dst  Original DST, of any length.
     * @return string DST_prime, len(DST) + 1 bytes (256 at most).
     */
    private static function dstPrime(string $dst): string
    {
        if (strlen($dst) > self::MAX_DST_LENGTH) {
            $dst = hash('sha512', self::OVERSIZE_DST_PREFIX.$dst, true);
        }

        return $dst.chr(strlen($dst));
    }

    /**
     * Byte-by-byte XOR of two binary strings of the same length
     * (strxor, RFC 9380 §5.3.1, step 10).
     *
     * @param  string  $left  Binary string.
     * @param  string  $right  Binary string the same length as `$left`.
     * @return string Result, the same length as the inputs.
     *
     * @throws InvalidArgumentException if the lengths differ.
     */
    private static function xor(string $left, string $right): string
    {
        if (strlen($left) !== strlen($right)) {
            throw new InvalidArgumentException('strxor operands must have equal length.');
        }

        return $left ^ $right;
    }
}
