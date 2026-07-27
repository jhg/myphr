<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use InvalidArgumentException;

/**
 * OPAQUE Expand-Label and Derive-Secret (RFC 9807 §6.4.2.1).
 *
 * It reuses the encoding of the TLS 1.3 `HkdfLabel` struct
 * (RFC 8446 §7.1) but with the label prefix `"OPAQUE-"` instead of
 * `"tls13 "`, and with no null terminator.
 *
 *   Expand-Label(Secret, Label, Context, Length) =
 *       Expand(Secret, CustomLabel, Length)
 *
 *   struct {
 *     uint16 length = Length;
 *     opaque label<8..255> = "OPAQUE-" + Label;
 *     opaque context<0..255> = Context;
 *   } CustomLabel;
 *
 *   Derive-Secret(Secret, Label, Transcript-Hash) =
 *       Expand-Label(Secret, Label, Transcript-Hash, Nx)
 *
 * Nx is the output length of the suite hash function; with
 * ristretto255-SHA512 it is 64 bytes.
 *
 * Integers are serialized big-endian with `pack('n', ...)` for uint16 and
 * `chr()` for uint8, never with `pack('L', ...)`, whose byte order depends on
 * the platform.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9807#section-6.4.2.1 RFC 9807 §6.4.2.1
 * @see https://www.rfc-editor.org/rfc/rfc8446#section-7.1 RFC 8446 §7.1
 */
final class ExpandLabel
{
    /**
     * Prefix RFC 9807 §6.4.2.1 prepends to every label.
     */
    public const string LABEL_PREFIX = 'OPAQUE-';

    /**
     * Nx of the ristretto255-SHA512 suite: the output length of Derive-Secret.
     */
    public const int SECRET_LENGTH = 64;

    /**
     * Largest value that fits in the uint8 length of the `label` and `context` fields.
     */
    private const int MAX_VECTOR_LENGTH = 255;

    /**
     * Largest value that fits in the uint16 `length` field.
     */
    private const int MAX_LENGTH_FIELD = 65535;

    private function __construct() {}

    /**
     * Expand-Label (RFC 9807 §6.4.2.1).
     *
     * It builds `CustomLabel` and passes it as `info` to HKDF-Expand-SHA-512.
     *
     * An empty context is encoded exactly as the RFC says: a uint8 with value
     * zero and not one byte more. It is neither replaced nor padded.
     *
     * @param  string  $secret  Binary secret used as the HKDF-Expand PRK;
     *                          at least 64 bytes.
     * @param  string  $label  ASCII label without the `"OPAQUE-"` prefix.
     *                         `strlen("OPAQUE-" . $label)` must be <= 255.
     * @param  string  $context  Binary context, possibly empty. Length <= 255.
     * @param  int  $length  Output length in bytes. 1 <= length <= 65535 and
     *                       <= 255 * 64 because of the HKDF-Expand limit.
     * @return string Binary derived material of exactly `$length` bytes.
     *
     * @throws InvalidArgumentException If a length exceeds what its encoding
     *                                  allows, or if HKDF-Expand rejects the
     *                                  parameters.
     */
    public static function expandLabel(string $secret, string $label, string $context, int $length): string
    {
        if ($length < 1 || $length > self::MAX_LENGTH_FIELD) {
            throw new InvalidArgumentException(
                'Expand-Label: the length must fit in a uint16 and be positive, got '.$length.'.'
            );
        }

        $prefixedLabel = self::LABEL_PREFIX.$label;
        $prefixedLabelLength = strlen($prefixedLabel);

        if ($prefixedLabelLength > self::MAX_VECTOR_LENGTH) {
            throw new InvalidArgumentException(
                'Expand-Label: the prefixed label is '.$prefixedLabelLength.' bytes long and does not fit in a uint8.'
            );
        }

        $contextLength = strlen($context);

        if ($contextLength > self::MAX_VECTOR_LENGTH) {
            throw new InvalidArgumentException(
                'Expand-Label: the context is '.$contextLength.' bytes long and does not fit in a uint8.'
            );
        }

        $customLabel = pack('n', $length)
            .chr($prefixedLabelLength)
            .$prefixedLabel
            .chr($contextLength)
            .$context;

        return HkdfSha512::expand($secret, $customLabel, $length);
    }

    /**
     * Derive-Secret (RFC 9807 §6.4.2.1).
     *
     * Equivalent to Expand-Label with the transcript hash as context and a
     * fixed length Nx = 64.
     *
     * @param  string  $secret  Binary secret used as PRK; at least 64 bytes.
     * @param  string  $label  ASCII label without the prefix, such as `"HandshakeSecret"`,
     *                         `"SessionKey"`, `"ServerMAC"`, `"ClientMAC"`.
     * @param  string  $transcriptHash  Transcript hash, or the empty string when
     *                                  the RFC passes an empty context (Km2 and Km3).
     * @return string Binary derived secret of exactly 64 bytes.
     *
     * @throws InvalidArgumentException If a length exceeds its encoding.
     */
    public static function deriveSecret(string $secret, string $label, string $transcriptHash): string
    {
        return self::expandLabel($secret, $label, $transcriptHash, self::SECRET_LENGTH);
    }
}
