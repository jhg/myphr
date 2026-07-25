<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `AuthResponse` — segunda mitad de `KE2`
 * (RFC 9807 §6.1 / `docs/OPAQUE.md` §6.2 y §11.6).
 *
 * ```
 * AuthResponse (128 bytes)
 *   [0..31]    server_nonce[Nn=32]
 *   [32..63]   server_public_keyshare[Npk=32]
 *   [64..127]  server_mac[Nm=64]
 * ```
 *
 * `server_public_keyshare` es la clave pública efímera del servidor, derivada
 * con `DeriveDiffieHellmanKeyPair` sobre una semilla fresca por handshake
 * (RFC 9807 §6.4.4); se valida como elemento del grupo también aquí porque el
 * objeto puede reconstruirse desde bytes al parsear un `KE2`.
 */
final class AuthResponse
{
    /** Longitud total de la estructura serializada, en bytes. */
    public const int LENGTH = 128;

    /** `Nn` — longitud del nonce del servidor, en bytes. */
    public const int NONCE_LENGTH = 32;

    /** `Npk` — clave pública ristretto255, en bytes. */
    public const int PUBLIC_KEYSHARE_LENGTH = 32;

    /** `Nm` — longitud de la etiqueta HMAC-SHA-512, en bytes. */
    public const int MAC_LENGTH = 64;

    /**
     * @param  string  $serverNonce  Nonce del servidor, 32 bytes.
     * @param  string  $serverPublicKeyshare  Clave pública efímera del servidor, 32 bytes.
     * @param  string  $serverMac  `HMAC-SHA-512(Km2, SHA512(preamble))`, 64 bytes.
     *
     * @throws InvalidMessageException Si alguna longitud no es la exacta.
     * @throws InvalidPointException Si `$serverPublicKeyshare` no es un elemento válido.
     */
    public function __construct(
        public readonly string $serverNonce,
        public readonly string $serverPublicKeyshare,
        public readonly string $serverMac,
    ) {
        BinaryCodec::ensureLength($serverNonce, self::NONCE_LENGTH, 'auth_response.server_nonce');
        BinaryCodec::ensureLength($serverPublicKeyshare, self::PUBLIC_KEYSHARE_LENGTH, 'auth_response.server_public_keyshare');
        BinaryCodec::ensureLength($serverMac, self::MAC_LENGTH, 'auth_response.server_mac');

        Ristretto255::validatePoint($serverPublicKeyshare);
    }

    /**
     * Parsea los 128 bytes de `AuthResponse` con los offsets de §6.2.
     *
     * @param  string  $bytes  Estructura serializada, exactamente 128 bytes.
     *
     * @throws InvalidMessageException Si la longitud total no es 128.
     * @throws InvalidPointException Si `server_public_keyshare` no valida.
     */
    public static function parse(string $bytes): self
    {
        BinaryCodec::ensureLength($bytes, self::LENGTH, 'auth_response');

        return new self(
            BinaryCodec::slice($bytes, 0, self::NONCE_LENGTH, 'auth_response.server_nonce'),
            BinaryCodec::slice($bytes, 32, self::PUBLIC_KEYSHARE_LENGTH, 'auth_response.server_public_keyshare'),
            BinaryCodec::slice($bytes, 64, self::MAC_LENGTH, 'auth_response.server_mac'),
        );
    }

    /**
     * @return string Estructura serializada, exactamente 128 bytes.
     */
    public function serialize(): string
    {
        return BinaryCodec::concat($this->serverNonce, $this->serverPublicKeyshare, $this->serverMac);
    }
}
