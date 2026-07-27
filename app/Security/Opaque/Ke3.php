<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `KE3` — last login message, from the client to the server
 * (RFC 9807 §6.1 / `docs/OPAQUE.md` §6.2 and §11.8).
 *
 * ```
 * KE3 (64 bytes)
 *   [0..63]  client_mac[Nm=64]
 * ```
 *
 * It only carries the client's HMAC-SHA-512 tag. Its content is not
 * inspected: it is compared in constant time against `expected_client_mac`
 * in {@see ServerLogin::serverFinish()}.
 */
final class Ke3
{
    /** Total length of the serialized message, in bytes. */
    public const int LENGTH = 64;

    /** `Nm` — length of the HMAC-SHA-512 tag, in bytes. */
    public const int MAC_LENGTH = 64;

    /**
     * @param  string  $clientMac  `HMAC-SHA-512(Km3, SHA512(preamble || server_mac))`, 64 bytes.
     *
     * @throws InvalidMessageException If the length is not 64.
     */
    public function __construct(
        public readonly string $clientMac,
    ) {
        BinaryCodec::ensureLength($clientMac, self::MAC_LENGTH, 'ke3.client_mac');
    }

    /**
     * Parses the 64 bytes of `KE3`.
     *
     * @param  string  $bytes  Serialized message, exactly 64 bytes.
     *
     * @throws InvalidMessageException If the total length is not 64.
     */
    public static function parse(string $bytes): self
    {
        BinaryCodec::ensureLength($bytes, self::LENGTH, 'ke3');

        return new self($bytes);
    }

    /**
     * Decodes the message exactly as it travels over HTTP: strict, canonical
     * base64url, no padding, 86 characters (`docs/OPAQUE.md` §5).
     *
     * @param  string  $encoded  base64url string received from the client.
     *
     * @throws InvalidMessageException If the encoding is not canonical or the
     *                                 binary length is not 64.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly($encoded, self::LENGTH, 'ke3'));
    }

    /**
     * @return string Message as base64url without padding, 86 characters (§5).
     */
    public function toBase64Url(): string
    {
        return Base64Url::encode($this->serialize());
    }

    /**
     * @return string Mensaje serializado, exactamente 64 bytes.
     */
    public function serialize(): string
    {
        return $this->clientMac;
    }
}
