<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `KE3` — último mensaje del login, del cliente al servidor
 * (RFC 9807 §6.1 / `docs/OPAQUE.md` §6.2 y §11.8).
 *
 * ```
 * KE3 (64 bytes)
 *   [0..63]  client_mac[Nm=64]
 * ```
 *
 * Sólo contiene la etiqueta HMAC-SHA-512 del cliente. Su contenido no se
 * inspecciona: se compara en tiempo constante contra `expected_client_mac`
 * en {@see ServerLogin::serverFinish()}.
 */
final class Ke3
{
    /** Longitud total del mensaje serializado, en bytes. */
    public const int LENGTH = 64;

    /** `Nm` — longitud de la etiqueta HMAC-SHA-512, en bytes. */
    public const int MAC_LENGTH = 64;

    /**
     * @param  string  $clientMac  `HMAC-SHA-512(Km3, SHA512(preamble || server_mac))`, 64 bytes.
     *
     * @throws InvalidMessageException Si la longitud no es 64.
     */
    public function __construct(
        public readonly string $clientMac,
    ) {
        BinaryCodec::ensureLength($clientMac, self::MAC_LENGTH, 'ke3.client_mac');
    }

    /**
     * Parsea los 64 bytes de `KE3`.
     *
     * @param  string  $bytes  Mensaje serializado, exactamente 64 bytes.
     *
     * @throws InvalidMessageException Si la longitud total no es 64.
     */
    public static function parse(string $bytes): self
    {
        BinaryCodec::ensureLength($bytes, self::LENGTH, 'ke3');

        return new self($bytes);
    }

    /**
     * Decodifica el mensaje tal y como viaja por HTTP: base64url estricto y
     * canónico, sin padding, de 86 caracteres (`docs/OPAQUE.md` §5).
     *
     * @param  string  $encoded  Cadena base64url recibida del cliente.
     *
     * @throws InvalidMessageException Si la codificación no es canónica o la
     *                                 longitud binaria no es 64.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly($encoded, self::LENGTH, 'ke3'));
    }

    /**
     * @return string Mensaje en base64url sin padding, 86 caracteres (§5).
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
