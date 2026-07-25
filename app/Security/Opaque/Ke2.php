<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `KE2` — respuesta del servidor al `KE1`
 * (RFC 9807 §6.1 / `docs/OPAQUE.md` §6.2 y §11.6).
 *
 * ```
 * KE2 (320 bytes)
 *   [0..191]    credential_response (192)
 *   [192..319]  auth_response (128)
 * ```
 *
 * Su longitud es fija e independiente de que el usuario exista o no
 * (`docs/OPAQUE.md` §13.3, §20.8).
 */
final class Ke2
{
    /** Longitud total del mensaje serializado, en bytes. */
    public const int LENGTH = 320;

    public function __construct(
        public readonly CredentialResponse $credentialResponse,
        public readonly AuthResponse $authResponse,
    ) {}

    /**
     * Parsea los 320 bytes de `KE2` con los offsets de §6.2.
     *
     * @param  string  $bytes  Mensaje serializado, exactamente 320 bytes.
     *
     * @throws InvalidMessageException Si la longitud total no es 320.
     * @throws InvalidPointException Si `server_public_keyshare` no valida.
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
     * Decodifica el mensaje tal y como viaja por HTTP: base64url estricto y
     * canónico, sin padding, de 427 caracteres (`docs/OPAQUE.md` §5).
     *
     * @param  string  $encoded  Cadena base64url.
     *
     * @throws InvalidMessageException Si la codificación no es canónica o la
     *                                 longitud binaria no es 320.
     * @throws InvalidPointException Si `server_public_keyshare` no valida.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly($encoded, self::LENGTH, 'ke2'));
    }

    /**
     * @return string Mensaje en base64url sin padding, 427 caracteres (§5).
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
