<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `KE1` — primer mensaje del login, del cliente al servidor
 * (RFC 9807 §6.1 / `docs/OPAQUE.md` §6.2 y §11.2).
 *
 * ```
 * KE1 (96 bytes)
 *   [0..31]   credential_request.blinded_message[Noe=32]
 *   [32..63]  auth_request.client_nonce[Nn=32]
 *   [64..95]  auth_request.client_public_keyshare[Npk=32]
 * ```
 *
 * Todo el contenido procede de una fuente remota, así que los dos elementos
 * del grupo se validan (longitud, canonicidad, pertenencia y rechazo de la
 * identidad) en el constructor, **antes** de cualquier otra operación, como
 * exige RFC 9807 §10.7 y `docs/OPAQUE.md` §11.2.
 */
final class Ke1
{
    /** Longitud total del mensaje serializado, en bytes. */
    public const int LENGTH = 96;

    /** `Noe` — elemento OPRF serializado, en bytes. */
    public const int BLINDED_MESSAGE_LENGTH = 32;

    /** `Nn` — longitud del nonce del cliente, en bytes. */
    public const int NONCE_LENGTH = 32;

    /** `Npk` — clave pública ristretto255, en bytes. */
    public const int PUBLIC_KEYSHARE_LENGTH = 32;

    /**
     * @param  string  $blindedMessage  Elemento OPRF cegado, 32 bytes.
     * @param  string  $clientNonce  Nonce del cliente, 32 bytes.
     * @param  string  $clientPublicKeyshare  Clave pública efímera del cliente, 32 bytes.
     *
     * @throws InvalidMessageException Si alguna longitud no es la exacta.
     * @throws InvalidPointException Si alguno de los dos elementos no valida.
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
     * Parsea los 96 bytes de `KE1` con los offsets de §6.2.
     *
     * @param  string  $bytes  Mensaje serializado, exactamente 96 bytes.
     *
     * @throws InvalidMessageException Si la longitud total no es 96.
     * @throws InvalidPointException Si `blinded_message` o `client_public_keyshare`
     *                               no son elementos válidos del grupo.
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
     * Decodifica el mensaje tal y como viaja por HTTP: base64url estricto y
     * canónico, sin padding, de 128 caracteres (`docs/OPAQUE.md` §5).
     *
     * @param  string  $encoded  Cadena base64url recibida del cliente.
     *
     * @throws InvalidMessageException Si la codificación no es canónica o la
     *                                 longitud binaria no es 96.
     * @throws InvalidPointException Si alguno de los dos elementos no valida.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly($encoded, self::LENGTH, 'ke1'));
    }

    /**
     * @return string Mensaje en base64url sin padding, 128 caracteres (§5).
     */
    public function toBase64Url(): string
    {
        return Base64Url::encode($this->serialize());
    }

    /**
     * @return string Mensaje serializado, exactamente 96 bytes. Entra tal cual
     *                en el preamble (`docs/OPAQUE.md` §11.5).
     */
    public function serialize(): string
    {
        return BinaryCodec::concat($this->blindedMessage, $this->clientNonce, $this->clientPublicKeyshare);
    }
}
