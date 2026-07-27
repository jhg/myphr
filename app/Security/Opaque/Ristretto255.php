<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use SodiumException;

/**
 * Strict wrapper over the ristretto255 primitives in `ext-sodium`
 * (`docs/OPAQUE.md` §7.1).
 *
 * It adds to libsodium the checks RFC 9807 §10.7 requires for any remote
 * input and that the extension does not do on its own:
 *
 * - canonicity of the element encoding: `is_valid_point()` checks it in some
 *   libsodium versions and not in others, so delegating it would make the same
 *   application accept or reject alternative encodings depending on which
 *   library PHP was built against;
 * - explicit rejection of the neutral element (`is_valid_point()` returns
 *   `true` for 32 zero bytes);
 * - rejection of the zero scalar;
 * - canonicity of the scalar (`sodium_crypto_scalarmult_ristretto255_base()`
 *   does not reduce its input and would silently accept a scalar greater than
 *   or equal to the group order).
 *
 * Any `SodiumException` is translated into {@see InvalidPointException}, which
 * is a subtype of `InvalidMessageException` per `docs/OPAQUE.md` §18.
 */
final class Ristretto255
{
    /** Length of a serialized group element, in bytes (RFC 9496 §4). */
    public const int ELEMENT_BYTES = 32;

    /** Length of a serialized scalar, in bytes (RFC 9496 §4). */
    public const int SCALAR_BYTES = 32;

    /** Length of the uniform input to `from_hash` and `scalar_reduce`, in bytes. */
    public const int HASH_BYTES = 64;

    /**
     * Validates a group element received from a remote source
     * (RFC 9807 §10.7; `docs/OPAQUE.md` §7.1).
     *
     * It checks, in this order: exact length of 32 bytes, canonical encoding
     * and group membership via
     * `sodium_crypto_core_ristretto255_is_valid_point()`, and finally that it
     * is not the neutral element (32 zero bytes), which that function accepts.
     *
     * @param  string  $point  Serialized element, 32 binary bytes.
     *
     * @throws InvalidPointException If the length is not 32, if the encoding is
     *                               invalid or non-canonical, or if it is the identity.
     */
    public static function validatePoint(string $point): void
    {
        if (strlen($point) !== self::ELEMENT_BYTES) {
            throw new InvalidPointException('Ristretto255 element must be exactly 32 bytes.');
        }

        /**
         * Canonicity is checked here and **not** delegated to libsodium.
         *
         * `sodium_crypto_core_ristretto255_is_valid_point()` does not verify it in every version of
         * the library: with libsodium 1.0.20 it rejects a non-canonical encoding, and on the
         * continuous integration runner it accepts one. The same deployment, depending on which
         * libsodium PHP was built against, would allow alternative encodings of the same element,
         * which is exactly the property ristretto255 exists to provide: one and only one
         * representation per group element.
         *
         * It is the same criterion already applied to the neutral element a few lines below: what
         * RFC 9807 §10.7 requires of any remote input is checked here, not assumed.
         */
        if (! self::isCanonicalEncoding($point)) {
            throw new InvalidPointException('Ristretto255 element is not a canonical encoding.');
        }

        try {
            $isValid = sodium_crypto_core_ristretto255_is_valid_point($point);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 element rejected.', 0, $exception);
        }

        if ($isValid !== true) {
            throw new InvalidPointException('Ristretto255 element is not a valid canonical encoding.');
        }

        if (self::isIdentityElement($point)) {
            throw new InvalidPointException('Ristretto255 element is the identity element.');
        }
    }

    /**
     * Are these 32 bytes the canonical encoding of a field element (RFC 9496 §4.1)?
     *
     * That is: read little-endian, are they smaller than `p = 2^255 - 19`? That rules out in one go
     * both the high bit being set (everything from `2^255` up) and the nineteen-value gap between
     * `p` and `2^255`, which is the case that slips through when you only look at the high bit.
     *
     * The comparison is constant time, with no early exit. The element is public, so timing leaks
     * no secret, but a loop that breaks on the first differing byte invites being copied somewhere
     * it does matter.
     */
    private static function isCanonicalEncoding(string $point): bool
    {
        /** `p = 2^255 - 19` little-endian: 0xED, thirty 0xFF and 0x7F. */
        $prime = "\xed".str_repeat("\xff", 30)."\x7f";

        $borrow = 0;
        $stillEqual = 1;

        for ($i = self::ELEMENT_BYTES - 1; $i >= 0; $i--) {
            $difference = ord($point[$i]) - ord($prime[$i]);

            /** `>> 8` leaves all ones if the subtraction went negative, that is, if this byte is smaller. */
            $borrow |= ($difference >> 8) & $stillEqual;
            $stillEqual &= (((ord($point[$i]) ^ ord($prime[$i])) - 1) >> 8) & 1;
        }

        return ($borrow & 1) === 1;
    }

    /**
     * Validates a scalar (`docs/OPAQUE.md` §7.1).
     *
     * It checks the exact length of 32 bytes, that it is not zero and that it
     * is canonical, that is, smaller than the prime group order `L`.
     * Canonicity is verified by requiring that reducing the scalar modulo `L`
     * gives back the same value.
     *
     * @param  string  $scalar  Little-endian serialized scalar, 32 binary bytes.
     *
     * @throws InvalidPointException If the length is not 32, if it is zero or if it is not canonical.
     */
    public static function validateScalar(string $scalar): void
    {
        if (strlen($scalar) !== self::SCALAR_BYTES) {
            throw new InvalidPointException('Ristretto255 scalar must be exactly 32 bytes.');
        }

        if (self::isZeroScalar($scalar)) {
            throw new InvalidPointException('Ristretto255 scalar is zero.');
        }

        $reduced = self::scalarReduce($scalar.str_repeat("\x00", self::SCALAR_BYTES));

        if (! hash_equals($reduced, $scalar)) {
            throw new InvalidPointException('Ristretto255 scalar is not canonical (>= group order).');
        }
    }

    /**
     * Scalar multiplication over an arbitrary group element
     * (`sodium_crypto_scalarmult_ristretto255`).
     *
     * It validates the scalar and the element before operating. libsodium
     * throws if the result is the neutral element, which covers the RFC 9807
     * §10.7 requirement that the shared DH secret must not be the identity;
     * that case is also translated into {@see InvalidPointException}.
     *
     * @param  string  $scalar  Canonical non-zero scalar, 32 bytes.
     * @param  string  $point  Valid element other than the identity, 32 bytes.
     * @return string Resulting element, 32 bytes.
     *
     * @throws InvalidPointException If an input does not validate or if the result is the identity.
     */
    public static function scalarMultiply(string $scalar, string $point): string
    {
        self::validateScalar($scalar);
        self::validatePoint($point);

        try {
            $result = sodium_crypto_scalarmult_ristretto255($scalar, $point);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 scalar multiplication failed.', 0, $exception);
        }

        if (self::isIdentityElement($result)) {
            throw new InvalidPointException('Ristretto255 scalar multiplication yielded the identity element.');
        }

        return $result;
    }

    /**
     * Multiplication of the scalar by the generator
     * (`sodium_crypto_scalarmult_ristretto255_base`).
     *
     * The libsodium function **does not reduce** its input, so validating
     * canonicity beforehand is mandatory: a non-canonical scalar would produce
     * a public key `curve25519-dalek` rejects.
     *
     * @param  string  $scalar  Canonical non-zero scalar, 32 bytes.
     * @return string Resulting element, 32 bytes.
     *
     * @throws InvalidPointException If the scalar does not validate or if the result is the identity.
     */
    public static function scalarMultiplyBase(string $scalar): string
    {
        self::validateScalar($scalar);

        try {
            $result = sodium_crypto_scalarmult_ristretto255_base($scalar);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 base scalar multiplication failed.', 0, $exception);
        }

        if (self::isIdentityElement($result)) {
            throw new InvalidPointException('Ristretto255 base scalar multiplication yielded the identity element.');
        }

        return $result;
    }

    /**
     * Reduces 64 uniform bytes modulo the group order `L`
     * (`sodium_crypto_core_ristretto255_scalar_reduce`).
     *
     * This is the operation used by `HashToScalar` (RFC 9497 §4.1) and by
     * `DeriveKeyPair`; the result may be zero, which this function does not
     * check because it is also used to verify canonicity in
     * {@see validateScalar()}.
     *
     * @param  string  $wideScalar  Uniform input, exactly 64 binary bytes.
     * @return string Canonical scalar, 32 bytes.
     *
     * @throws InvalidPointException If the length is not 64 or if libsodium fails.
     */
    public static function scalarReduce(string $wideScalar): string
    {
        if (strlen($wideScalar) !== self::HASH_BYTES) {
            throw new InvalidPointException('Ristretto255 wide scalar must be exactly 64 bytes.');
        }

        try {
            return sodium_crypto_core_ristretto255_scalar_reduce($wideScalar);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 scalar reduction failed.', 0, $exception);
        }
    }

    /**
     * Multiplicative inverse of the scalar modulo `L`
     * (`sodium_crypto_core_ristretto255_scalar_invert`).
     *
     * Used by the OPRF client to unblind (RFC 9497 §3.3.1). The scalar must
     * validate first: zero has no inverse.
     *
     * @param  string  $scalar  Canonical non-zero scalar, 32 bytes.
     * @return string Inverse scalar, 32 bytes.
     *
     * @throws InvalidPointException If the scalar does not validate or if libsodium fails.
     */
    public static function scalarInvert(string $scalar): string
    {
        self::validateScalar($scalar);

        try {
            return sodium_crypto_core_ristretto255_scalar_invert($scalar);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 scalar inversion failed.', 0, $exception);
        }
    }

    /**
     * Maps 64 uniform bytes to a group element
     * (`sodium_crypto_core_ristretto255_from_hash`), that is, the
     * `hash_to_ristretto255` of RFC 9380 §B / RFC 9496 §4.3.4 used by
     * `HashToGroup` in RFC 9497 §4.1.
     *
     * @param  string  $uniformBytes  Uniform input, exactly 64 binary bytes.
     * @return string Group element, 32 bytes; never the identity.
     *
     * @throws InvalidPointException If the length is not 64, if libsodium fails
     *                               or if the result is the identity.
     */
    public static function pointFromHash(string $uniformBytes): string
    {
        if (strlen($uniformBytes) !== self::HASH_BYTES) {
            throw new InvalidPointException('Ristretto255 uniform input must be exactly 64 bytes.');
        }

        try {
            $point = sodium_crypto_core_ristretto255_from_hash($uniformBytes);
        } catch (SodiumException $exception) {
            throw new InvalidPointException('Ristretto255 hash-to-group failed.', 0, $exception);
        }

        if (self::isIdentityElement($point)) {
            throw new InvalidPointException('Ristretto255 hash-to-group yielded the identity element.');
        }

        return $point;
    }

    /**
     * Compares in constant time against 32 zero bytes, the encoding of the
     * neutral element, which `is_valid_point()` accepts as valid.
     *
     * @param  string  $point  Serialized element of 32 bytes.
     */
    private static function isIdentityElement(string $point): bool
    {
        return strlen($point) === self::ELEMENT_BYTES
            && hash_equals(str_repeat("\x00", self::ELEMENT_BYTES), $point);
    }

    /**
     * Compares in constant time against the zero scalar.
     *
     * @param  string  $scalar  Serialized scalar of 32 bytes.
     */
    private static function isZeroScalar(string $scalar): bool
    {
        return strlen($scalar) === self::SCALAR_BYTES
            && hash_equals(str_repeat("\x00", self::SCALAR_BYTES), $scalar);
    }
}
