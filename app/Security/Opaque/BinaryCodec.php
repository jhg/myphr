<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Binary helpers for the protocol (`docs/OPAQUE.md` §4 and §5).
 *
 * Every internal format is pure binary: string concatenation with exact
 * offsets, no JSON, no `serialize()` and no platform integers. That is why we
 * only use `strlen()` / `substr()` here (never `mb_*`), `pack('n')` for
 * big-endian uint16 and `chr()` for uint8, and every length is checked before
 * any slicing.
 *
 * Errors coming from remote data are `InvalidMessageException`; those coming
 * from incorrect internal use (out-of-range values, unsupported widths) are
 * `InvalidConfigurationException`, because they must not be collapsed into the
 * generic §18 authentication response.
 */
final class BinaryCodec
{
    /**
     * Binary concatenation, `concat(...)` from RFC 9807 §1.2.
     *
     * @param  string  ...$parts  Binary fragments in order.
     * @return string All of them concatenated.
     */
    public static function concat(string ...$parts): string
    {
        return implode('', $parts);
    }

    /**
     * `zeroes(n)` from RFC 9807 §1.2.
     *
     * @param  int<0, max>  $length  Number of zero bytes.
     * @return string String of `$length` `0x00` bytes.
     *
     * @throws InvalidConfigurationException If `$length` is negative.
     */
    public static function zeroes(int $length): string
    {
        if ($length < 0) {
            throw new InvalidConfigurationException("Zero-fill length must not be negative, got {$length}.");
        }

        return str_repeat("\0", $length);
    }

    /**
     * Requires an exact binary length.
     *
     * It must be called before slicing any received message
     * (`docs/OPAQUE.md` §4, §5).
     *
     * @param  string  $data  Binary string to check.
     * @param  int<0, max>  $expectedLength  Required length, in bytes.
     * @param  string  $field  Field name, only for the error message.
     *
     * @throws InvalidMessageException If the length does not match.
     */
    public static function ensureLength(string $data, int $expectedLength, string $field = 'value'): void
    {
        $actualLength = strlen($data);

        if ($actualLength !== $expectedLength) {
            throw new InvalidMessageException(
                "Field {$field} must be {$expectedLength} bytes, got {$actualLength}."
            );
        }
    }

    /**
     * Extracts `$length` bytes from `$offset`, checking the range first.
     *
     * It implements the offsets from `docs/OPAQUE.md` §6. It never returns a
     * string shorter than requested: if the message is truncated, it throws.
     *
     * @param  string  $data  Source binary string.
     * @param  int<0, max>  $offset  Starting offset in bytes.
     * @param  int<0, max>  $length  Number of bytes to extract.
     * @param  string  $field  Field name, only for the error message.
     * @return string Extracted bytes, exactly `$length` long.
     *
     * @throws InvalidMessageException If the range runs past the data.
     * @throws InvalidConfigurationException If `$offset` or `$length` are negative.
     */
    public static function slice(string $data, int $offset, int $length, string $field = 'value'): string
    {
        if ($offset < 0 || $length < 0) {
            throw new InvalidConfigurationException(
                "Slice bounds must not be negative, got offset {$offset} and length {$length}."
            );
        }

        if ($offset + $length > strlen($data)) {
            throw new InvalidMessageException(
                "Field {$field} is truncated: cannot read {$length} bytes at offset {$offset}."
            );
        }

        return substr($data, $offset, $length);
    }

    /**
     * `I2OSP(value, 1)` — 8-bit unsigned integer (RFC 8017 §4.1).
     *
     * @param  int<0, 255>  $value  Value to serialize.
     * @return string One byte.
     *
     * @throws InvalidConfigurationException If the value does not fit in 8 bits.
     */
    public static function i2osp1(int $value): string
    {
        if ($value < 0 || $value > 0xFF) {
            throw new InvalidConfigurationException("Value {$value} does not fit in a uint8.");
        }

        return chr($value);
    }

    /**
     * `I2OSP(value, 2)` — 16-bit big-endian unsigned integer (RFC 8017 §4.1).
     *
     * We use `pack('n')`, which is big-endian by definition and does not depend
     * on the platform, unlike `pack('L')` or `pack('S')`.
     *
     * @param  int<0, 65535>  $value  Value to serialize.
     * @return string Two big-endian bytes.
     *
     * @throws InvalidConfigurationException If the value does not fit in 16 bits.
     */
    public static function i2osp2(int $value): string
    {
        if ($value < 0 || $value > 0xFFFF) {
            throw new InvalidConfigurationException("Value {$value} does not fit in a uint16.");
        }

        return pack('n', $value);
    }

    /**
     * Serializes an RFC 8446 variable-length vector `<1..2^16-1>` as
     * `uint16_be(len) || bytes`.
     *
     * It is used by `CleartextCredentials` (RFC 9807 §4), by the preamble
     * (§6.4.2.1) and by the OPRF `Finalize` input (RFC 9497 §3.3.1).
     *
     * @param  string  $data  Binary content, 0 to 65535 bytes.
     * @return string `uint16_be(strlen($data)) || $data`.
     *
     * @throws InvalidConfigurationException If the content exceeds 65535 bytes.
     */
    public static function lengthPrefixed(string $data): string
    {
        return self::i2osp2(strlen($data)).$data;
    }

    /**
     * `xor(a, b)` from RFC 9807 §1.2 — byte-by-byte XOR.
     *
     * It is used for the `masked_response` of `CredentialResponse`
     * (`docs/OPAQUE.md` §6.2) and for `expand_message_xmd` (RFC 9380 §5.3.1).
     *
     * @param  string  $a  First binary operand.
     * @param  string  $b  Second binary operand, of the same length.
     * @return string Result, the same length as the operands.
     *
     * @throws InvalidMessageException If the lengths differ.
     */
    public static function xorStrings(string $a, string $b): string
    {
        if (strlen($a) !== strlen($b)) {
            throw new InvalidMessageException(
                'XOR operands must have the same length, got '.strlen($a).' and '.strlen($b).'.'
            );
        }

        return $a ^ $b;
    }

    /**
     * `ct_equal(a, b)` from RFC 9807 §1.2 — constant-time comparison
     * (RFC 9807 §9.1).
     *
     * The length check up front leaks nothing secret: protocol lengths are
     * public and fixed (§6).
     *
     * @param  string  $a  First binary operand.
     * @param  string  $b  Second binary operand.
     * @return bool `true` if they match in length and content.
     */
    public static function constantTimeEquals(string $a, string $b): bool
    {
        if (strlen($a) !== strlen($b)) {
            return false;
        }

        return sodium_memcmp($a, $b) === 0;
    }
}
