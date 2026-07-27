<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `RegistrationRecord` — the user's persisted credential
 * (RFC 9807 §5.1 / `docs/OPAQUE.md` §6.1).
 *
 * ```
 * RegistrationRecord (192 bytes)
 *   [0..31]    client_public_key[Npk=32]
 *   [32..95]   masking_key[Nh=64]
 *   [96..191]  envelope[Nn+Nm = 32+64 = 96]
 * ```
 *
 * The object is immutable and validates the exact lengths in the constructor.
 * The client public key is validated as a group element because it comes from
 * the client (RFC 9807 §10.7); `masking_key` and `envelope` are opaque
 * fixed-length material and admit no check beyond their size.
 */
final class RegistrationRecord
{
    /** Total length of the serialized record, in bytes. */
    public const int LENGTH = 192;

    /** `Npk` — ristretto255 public key, in bytes. */
    public const int PUBLIC_KEY_LENGTH = 32;

    /** `Nh` — length of `masking_key`, in bytes. */
    public const int MASKING_KEY_LENGTH = 64;

    /** `Nn + Nm` — length of the envelope, in bytes. */
    public const int ENVELOPE_LENGTH = 96;

    /**
     * @param  string  $clientPublicKey  Serialized ristretto255 element, 32 bytes.
     * @param  string  $maskingKey  Masking key, 64 bytes.
     * @param  string  $envelope  `envelope_nonce || auth_tag`, 96 bytes.
     *
     * @throws InvalidMessageException If any length is not exact.
     * @throws InvalidPointException If `$clientPublicKey` is not a valid element.
     */
    public function __construct(
        public readonly string $clientPublicKey,
        public readonly string $maskingKey,
        public readonly string $envelope,
    ) {
        BinaryCodec::ensureLength($clientPublicKey, self::PUBLIC_KEY_LENGTH, 'record.client_public_key');
        BinaryCodec::ensureLength($maskingKey, self::MASKING_KEY_LENGTH, 'record.masking_key');
        BinaryCodec::ensureLength($envelope, self::ENVELOPE_LENGTH, 'record.envelope');

        Ristretto255::validatePoint($clientPublicKey);
    }

    /**
     * Parses the 192 bytes of a `RegistrationRecord` with the offsets from §6.1.
     *
     * @param  string  $bytes  Serialized record, exactly 192 bytes.
     *
     * @throws InvalidMessageException If the total length is not 192.
     * @throws InvalidPointException If the client public key does not validate.
     */
    public static function parse(string $bytes): self
    {
        BinaryCodec::ensureLength($bytes, self::LENGTH, 'registration_record');

        return new self(
            BinaryCodec::slice($bytes, 0, self::PUBLIC_KEY_LENGTH, 'record.client_public_key'),
            BinaryCodec::slice($bytes, 32, self::MASKING_KEY_LENGTH, 'record.masking_key'),
            BinaryCodec::slice($bytes, 96, self::ENVELOPE_LENGTH, 'record.envelope'),
        );
    }

    /**
     * Decodes the record exactly as it travels over HTTP: strict, canonical
     * base64url, no padding, 256 characters (`docs/OPAQUE.md` §5).
     *
     * @param  string  $encoded  base64url string received from the client.
     *
     * @throws InvalidMessageException If the encoding is not canonical or the
     *                                 binary length is not 192.
     * @throws InvalidPointException If the client public key does not validate.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly($encoded, self::LENGTH, 'registration_record'));
    }

    /**
     * @return string Record as base64url without padding, 256 characters (§5).
     */
    public function toBase64Url(): string
    {
        return Base64Url::encode($this->serialize());
    }

    /**
     * @return string Record serializado, exactamente 192 bytes.
     */
    public function serialize(): string
    {
        return BinaryCodec::concat($this->clientPublicKey, $this->maskingKey, $this->envelope);
    }
}
