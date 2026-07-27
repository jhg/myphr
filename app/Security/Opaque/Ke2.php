<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `KE2` — the server's answer to `KE1`
 * (RFC 9807 §6.1 / `docs/OPAQUE.md` §6.2 and §11.6).
 *
 * ```
 * KE2 (320 bytes)
 *   [0..191]    credential_response (192)
 *   [192..319]  auth_response (128)
 * ```
 *
 * Its length is fixed and independent of whether the user exists
 * (`docs/OPAQUE.md` §13.3, §20.8).
 */
final class Ke2
{
    /** Total length of the serialized message, in bytes. */
    public const int LENGTH = 320;

    public function __construct(
        public readonly CredentialResponse $credentialResponse,
        public readonly AuthResponse $authResponse,
    ) {}

    /**
     * Parses the 320 bytes of `KE2` with the offsets from §6.2.
     *
     * @param  string  $bytes  Serialized message, exactly 320 bytes.
     *
     * @throws InvalidMessageException If the total length is not 320.
     * @throws InvalidPointException If `server_public_keyshare` does not validate.
     */
    public static function parse(string $bytes): self
    {
        BinaryCodec::ensureLength($bytes, self::LENGTH, 'ke2');

        return new self(
            CredentialResponse::parse(BinaryCodec::slice($bytes, 0, CredentialResponse::LENGTH, 'ke2.credential_response')),
            AuthResponse::parse(BinaryCodec::slice($bytes, 192, AuthResponse::LENGTH, 'ke2.auth_response')),
        );
    }

    /**
     * Decodes the message exactly as it travels over HTTP: strict, canonical
     * base64url, no padding, 427 characters (`docs/OPAQUE.md` §5).
     *
     * @param  string  $encoded  base64url string.
     *
     * @throws InvalidMessageException If the encoding is not canonical or the
     *                                 binary length is not 320.
     * @throws InvalidPointException If `server_public_keyshare` does not validate.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly($encoded, self::LENGTH, 'ke2'));
    }

    /**
     * @return string Message as base64url without padding, 427 characters (§5).
     */
    public function toBase64Url(): string
    {
        return Base64Url::encode($this->serialize());
    }

    /**
     * @return string Mensaje serializado, exactamente 320 bytes.
     */
    public function serialize(): string
    {
        return BinaryCodec::concat($this->credentialResponse->serialize(), $this->authResponse->serialize());
    }
}
