<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `AuthResponse` — second half of `KE2`
 * (RFC 9807 §6.1 / `docs/OPAQUE.md` §6.2 and §11.6).
 *
 * ```
 * AuthResponse (128 bytes)
 *   [0..31]    server_nonce[Nn=32]
 *   [32..63]   server_public_keyshare[Npk=32]
 *   [64..127]  server_mac[Nm=64]
 * ```
 *
 * `server_public_keyshare` is the server's ephemeral public key, derived with
 * `DeriveDiffieHellmanKeyPair` over a fresh per-handshake seed
 * (RFC 9807 §6.4.4); it is validated as a group element here too because the
 * object can be rebuilt from bytes when parsing a `KE2`.
 */
final class AuthResponse
{
    /** Total length of the serialized structure, in bytes. */
    public const int LENGTH = 128;

    /** `Nn` — length of the server nonce, in bytes. */
    public const int NONCE_LENGTH = 32;

    /** `Npk` — ristretto255 public key, in bytes. */
    public const int PUBLIC_KEYSHARE_LENGTH = 32;

    /** `Nm` — length of the HMAC-SHA-512 tag, in bytes. */
    public const int MAC_LENGTH = 64;

    /**
     * @param  string  $serverNonce  Server nonce, 32 bytes.
     * @param  string  $serverPublicKeyshare  Server ephemeral public key, 32 bytes.
     * @param  string  $serverMac  `HMAC-SHA-512(Km2, SHA512(preamble))`, 64 bytes.
     *
     * @throws InvalidMessageException If any length is not exact.
     * @throws InvalidPointException If `$serverPublicKeyshare` is not a valid element.
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
     * Parses the 128 bytes of `AuthResponse` with the offsets from §6.2.
     *
     * @param  string  $bytes  Serialized structure, exactly 128 bytes.
     *
     * @throws InvalidMessageException If the total length is not 128.
     * @throws InvalidPointException If `server_public_keyshare` does not validate.
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
