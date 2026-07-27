<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `KE1` — first login message, from the client to the server
 * (RFC 9807 §6.1 / `docs/OPAQUE.md` §6.2 and §11.2).
 *
 * ```
 * KE1 (96 bytes)
 *   [0..31]   credential_request.blinded_message[Noe=32]
 *   [32..63]  auth_request.client_nonce[Nn=32]
 *   [64..95]  auth_request.client_public_keyshare[Npk=32]
 * ```
 *
 * Every byte comes from a remote source, so both group elements are validated
 * (length, canonicity, membership and rejection of the identity) in the
 * constructor, **before** any other operation, as RFC 9807 §10.7 and
 * `docs/OPAQUE.md` §11.2 require.
 */
final class Ke1
{
    /** Total length of the serialized message, in bytes. */
    public const int LENGTH = 96;

    /** `Noe` — serialized OPRF element, in bytes. */
    public const int BLINDED_MESSAGE_LENGTH = 32;

    /** `Nn` — length of the client nonce, in bytes. */
    public const int NONCE_LENGTH = 32;

    /** `Npk` — ristretto255 public key, in bytes. */
    public const int PUBLIC_KEYSHARE_LENGTH = 32;

    /**
     * @param  string  $blindedMessage  Blinded OPRF element, 32 bytes.
     * @param  string  $clientNonce  Client nonce, 32 bytes.
     * @param  string  $clientPublicKeyshare  Client ephemeral public key, 32 bytes.
     *
     * @throws InvalidMessageException If any length is not exact.
     * @throws InvalidPointException If either element does not validate.
     */
    public function __construct(
        public readonly string $blindedMessage,
        public readonly string $clientNonce,
        public readonly string $clientPublicKeyshare,
    ) {
        BinaryCodec::ensureLength($blindedMessage, self::BLINDED_MESSAGE_LENGTH, 'ke1.blinded_message');
        BinaryCodec::ensureLength($clientNonce, self::NONCE_LENGTH, 'ke1.client_nonce');
        BinaryCodec::ensureLength($clientPublicKeyshare, self::PUBLIC_KEYSHARE_LENGTH, 'ke1.client_public_keyshare');

        Ristretto255::validatePoint($blindedMessage);
        Ristretto255::validatePoint($clientPublicKeyshare);
    }

    /**
     * Parses the 96 bytes of `KE1` with the offsets from §6.2.
     *
     * @param  string  $bytes  Serialized message, exactly 96 bytes.
     *
     * @throws InvalidMessageException If the total length is not 96.
     * @throws InvalidPointException If `blinded_message` or `client_public_keyshare`
     *                               are not valid group elements.
     */
    public static function parse(string $bytes): self
    {
        BinaryCodec::ensureLength($bytes, self::LENGTH, 'ke1');

        return new self(
            BinaryCodec::slice($bytes, 0, self::BLINDED_MESSAGE_LENGTH, 'ke1.blinded_message'),
            BinaryCodec::slice($bytes, 32, self::NONCE_LENGTH, 'ke1.client_nonce'),
            BinaryCodec::slice($bytes, 64, self::PUBLIC_KEYSHARE_LENGTH, 'ke1.client_public_keyshare'),
        );
    }

    /**
     * Decodes the message exactly as it travels over HTTP: strict, canonical
     * base64url, no padding, 128 characters (`docs/OPAQUE.md` §5).
     *
     * @param  string  $encoded  base64url string received from the client.
     *
     * @throws InvalidMessageException If the encoding is not canonical or the
     *                                 binary length is not 96.
     * @throws InvalidPointException If either element does not validate.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly($encoded, self::LENGTH, 'ke1'));
    }

    /**
     * @return string Message as base64url without padding, 128 characters (§5).
     */
    public function toBase64Url(): string
    {
        return Base64Url::encode($this->serialize());
    }

    /**
     * @return string Serialized message, exactly 96 bytes. It goes into the
     *                preamble verbatim (`docs/OPAQUE.md` §11.5).
     */
    public function serialize(): string
    {
        return BinaryCodec::concat($this->blindedMessage, $this->clientNonce, $this->clientPublicKeyshare);
    }
}
