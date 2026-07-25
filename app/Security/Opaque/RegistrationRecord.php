<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `RegistrationRecord` — credencial persistida del usuario
 * (RFC 9807 §5.1 / `docs/OPAQUE.md` §6.1).
 *
 * ```
 * RegistrationRecord (192 bytes)
 *   [0..31]    client_public_key[Npk=32]
 *   [32..95]   masking_key[Nh=64]
 *   [96..191]  envelope[Nn+Nm = 32+64 = 96]
 * ```
 *
 * El objeto es inmutable y valida las longitudes exactas en el constructor.
 * La clave pública del cliente se valida como elemento del grupo porque
 * proviene del cliente (RFC 9807 §10.7); `masking_key` y `envelope` son
 * material opaco de longitud fija y no admiten más comprobación que su tamaño.
 */
final class RegistrationRecord
{
    /** Longitud total del record serializado, en bytes. */
    public const int LENGTH = 192;

    /** `Npk` — clave pública ristretto255, en bytes. */
    public const int PUBLIC_KEY_LENGTH = 32;

    /** `Nh` — longitud de `masking_key`, en bytes. */
    public const int MASKING_KEY_LENGTH = 64;

    /** `Nn + Nm` — longitud del envelope, en bytes. */
    public const int ENVELOPE_LENGTH = 96;

    /**
     * @param  string  $clientPublicKey  Elemento ristretto255 serializado, 32 bytes.
     * @param  string  $maskingKey  Clave de enmascarado, 64 bytes.
     * @param  string  $envelope  `envelope_nonce || auth_tag`, 96 bytes.
     *
     * @throws InvalidMessageException Si alguna longitud no es la exacta.
     * @throws InvalidPointException Si `$clientPublicKey` no es un elemento válido.
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
     * Parsea los 192 bytes de un `RegistrationRecord` con los offsets de §6.1.
     *
     * @param  string  $bytes  Record serializado, exactamente 192 bytes.
     *
     * @throws InvalidMessageException Si la longitud total no es 192.
     * @throws InvalidPointException Si la clave pública del cliente no valida.
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
     * Decodifica el record tal y como viaja por HTTP: base64url estricto y
     * canónico, sin padding, de 256 caracteres (`docs/OPAQUE.md` §5).
     *
     * @param  string  $encoded  Cadena base64url recibida del cliente.
     *
     * @throws InvalidMessageException Si la codificación no es canónica o la
     *                                 longitud binaria no es 192.
     * @throws InvalidPointException Si la clave pública del cliente no valida.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly($encoded, self::LENGTH, 'registration_record'));
    }

    /**
     * @return string Record en base64url sin padding, 256 caracteres (§5).
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
