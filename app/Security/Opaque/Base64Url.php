<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * URL-safe Base64 **without padding** and with strict decoding
 * (`docs/OPAQUE.md` §5).
 *
 * It is the only HTTP transport format for OPAQUE messages. Strictness is not
 * a preference: `@serenity-kit/opaque` encodes with `URL_SAFE_NO_PAD` and
 * decodes with `DecodePaddingMode::RequireNone`, so accepting variants would
 * break interoperability on top of allowing several representations of the
 * same message.
 *
 * Rules applied when decoding:
 *
 * 1. Alphabet `A-Z a-z 0-9 - _` only: `=`, spaces, line breaks and the
 *    standard Base64 alphabet (`+`, `/`) are rejected.
 * 2. Congruent length: `strlen % 4 === 1` is impossible in Base64 and is
 *    rejected.
 * 3. Canonicity: the result is re-encoded and must match the input exactly,
 *    which rejects non-zero leftover bits in the last character.
 *
 * PHP's `base64_decode(..., strict: true)` covers none of the three: it
 * accepts padding, ignores whitespace and allows leftover bits.
 */
final class Base64Url
{
    /**
     * Alfabeto Base64 URL-safe (RFC 4648 §5).
     */
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    /**
     * Encodes binary bytes as base64url without padding.
     *
     * @param  string  $binary  Binary string of any length (may be empty).
     * @return string Only characters from the base64url alphabet, no `=`.
     */
    public static function encode(string $binary): string
    {
        return rtrim(strtr(base64_encode($binary), '+/', '-_'), '=');
    }

    /**
     * Decodes base64url without padding, strictly and canonically.
     *
     * @param  string  $encoded  String received over HTTP.
     * @param  string  $field  Field name, only for the error message.
     * @return string Decoded bytes.
     *
     * @throws InvalidMessageException If there are characters outside the
     *                                 alphabet, padding, whitespace, an
     *                                 impossible length, or the encoding is not
     *                                 canonical.
     */
    public static function decode(string $encoded, string $field = 'value'): string
    {
        if (strspn($encoded, self::ALPHABET) !== strlen($encoded)) {
            throw new InvalidMessageException("Field {$field} is not valid base64url.");
        }

        if (strlen($encoded) % 4 === 1) {
            throw new InvalidMessageException("Field {$field} has an impossible base64url length.");
        }

        $decoded = base64_decode(strtr($encoded, '-_', '+/'), true);

        if ($decoded === false) {
            throw new InvalidMessageException("Field {$field} is not valid base64url.");
        }

        if (self::encode($decoded) !== $encoded) {
            throw new InvalidMessageException("Field {$field} is not canonical base64url.");
        }

        return $decoded;
    }

    /**
     * Decodes and requires an exact binary length.
     *
     * It applies the `docs/OPAQUE.md` §5 rule of rejecting any unexpected
     * length **before** touching cryptography: message sizes are fixed in §6
     * and none of them is variable length.
     *
     * @param  string  $encoded  String received over HTTP.
     * @param  int<0, max>  $expectedLength  Required binary length, in bytes.
     * @param  string  $field  Field name, only for the error message.
     * @return string Decoded bytes, exactly `$expectedLength` long.
     *
     * @throws InvalidMessageException If the encoding is invalid or the length
     *                                 does not match.
     */
    public static function decodeExactly(string $encoded, int $expectedLength, string $field = 'value'): string
    {
        $decoded = self::decode($encoded, $field);

        BinaryCodec::ensureLength($decoded, $expectedLength, $field);

        return $decoded;
    }
}
