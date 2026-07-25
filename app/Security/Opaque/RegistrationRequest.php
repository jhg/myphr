<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `RegistrationRequest` de RFC 9807 §5.1 (`docs/OPAQUE.md` §6.1, §10.1).
 *
 * ```
 * RegistrationRequest (32 bytes)
 *   [0..31]  blinded_message[Noe=32]   elemento OPRF serializado
 * ```
 *
 * Lo produce el cliente con `Blind(password)` y llega al servidor codificado
 * en base64url sin padding (43 caracteres, §5).
 *
 * El elemento se valida al construir el objeto, que es el
 * `DeserializeElement` que exige §10.2: longitud exacta, codificación
 * canónica, pertenencia al grupo y rechazo de la identidad (RFC 9807 §10.7).
 */
final class RegistrationRequest
{
    /**
     * @param  string  $blindedMessage  Elemento OPRF serializado, `Noe` = 32 bytes.
     *
     * @throws InvalidMessageException Si la longitud no es 32.
     * @throws InvalidPointException Si el elemento no es un punto ristretto255
     *                               válido, canónico y distinto de la identidad.
     */
    public function __construct(public readonly string $blindedMessage)
    {
        BinaryCodec::ensureLength(
            $this->blindedMessage,
            OpaqueProfile::REGISTRATION_REQUEST_BYTES,
            'registrationRequest.blinded_message'
        );

        Ristretto255::validatePoint($this->blindedMessage);
    }

    /**
     * Deserializa los 32 bytes del mensaje por offsets exactos (§6.1).
     *
     * Rechaza tanto los mensajes truncados como los que traen bytes de más:
     * no hay campos de longitud variable en el protocolo.
     *
     * @param  string  $binary  Mensaje binario de exactamente 32 bytes.
     *
     * @throws InvalidMessageException Si la longitud no es 32.
     * @throws InvalidPointException Si el elemento no valida.
     */
    public static function parse(string $binary): self
    {
        BinaryCodec::ensureLength(
            $binary,
            OpaqueProfile::REGISTRATION_REQUEST_BYTES,
            'registrationRequest'
        );

        return new self(BinaryCodec::slice(
            $binary,
            0,
            OpaqueProfile::NOE,
            'registrationRequest.blinded_message'
        ));
    }

    /**
     * Decodifica el mensaje tal y como viaja por HTTP: base64url estricto y
     * canónico, sin padding, de 43 caracteres (§5).
     *
     * @param  string  $encoded  Cadena recibida del cliente.
     *
     * @throws InvalidMessageException Si la codificación no es canónica o la
     *                                 longitud binaria no es 32.
     * @throws InvalidPointException Si el elemento no valida.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly(
            $encoded,
            OpaqueProfile::REGISTRATION_REQUEST_BYTES,
            'registrationRequest'
        ));
    }

    /**
     * @return string Mensaje binario de 32 bytes (§6.1).
     */
    public function serialize(): string
    {
        return $this->blindedMessage;
    }

    /**
     * @return string Mensaje en base64url sin padding, 43 caracteres (§5).
     */
    public function toBase64Url(): string
    {
        return Base64Url::encode($this->serialize());
    }
}
