<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `RegistrationResponse` de RFC 9807 §5.1 (`docs/OPAQUE.md` §6.1, §10.2).
 *
 * ```
 * RegistrationResponse (64 bytes)
 *   [0..31]   evaluated_message[Noe=32]   elemento OPRF evaluado
 *   [32..63]  server_public_key[Npk=32]   clave pública estática AKE del servidor
 * ```
 *
 * Lo produce el servidor en `CreateRegistrationResponse` y viaja al cliente
 * en base64url sin padding (86 caracteres, §5).
 *
 * Ambos campos son elementos ristretto255 y se validan al construir el objeto
 * (longitud, codificación canónica, pertenencia al grupo y rechazo de la
 * identidad, RFC 9807 §10.7).
 */
final class RegistrationResponse
{
    /**
     * @param  string  $evaluatedMessage  Elemento OPRF evaluado, `Noe` = 32 bytes.
     * @param  string  $serverPublicKey  Clave pública estática del servidor, `Npk` = 32 bytes.
     *
     * @throws InvalidMessageException Si alguna longitud no es 32.
     * @throws InvalidPointException Si alguno de los dos no es un punto
     *                               ristretto255 válido, canónico y distinto
     *                               de la identidad.
     */
    public function __construct(
        public readonly string $evaluatedMessage,
        public readonly string $serverPublicKey,
    ) {
        BinaryCodec::ensureLength(
            $this->evaluatedMessage,
            OpaqueProfile::NOE,
            'registrationResponse.evaluated_message'
        );
        BinaryCodec::ensureLength(
            $this->serverPublicKey,
            OpaqueProfile::NPK,
            'registrationResponse.server_public_key'
        );

        Ristretto255::validatePoint($this->evaluatedMessage);
        Ristretto255::validatePoint($this->serverPublicKey);
    }

    /**
     * Deserializa los 64 bytes del mensaje por offsets exactos (§6.1).
     *
     * @param  string  $binary  Mensaje binario de exactamente 64 bytes.
     *
     * @throws InvalidMessageException Si la longitud no es 64.
     * @throws InvalidPointException Si alguno de los dos elementos no valida.
     */
    public static function parse(string $binary): self
    {
        BinaryCodec::ensureLength(
            $binary,
            OpaqueProfile::REGISTRATION_RESPONSE_BYTES,
            'registrationResponse'
        );

        return new self(
            BinaryCodec::slice($binary, 0, OpaqueProfile::NOE, 'registrationResponse.evaluated_message'),
            BinaryCodec::slice(
                $binary,
                OpaqueProfile::NOE,
                OpaqueProfile::NPK,
                'registrationResponse.server_public_key'
            ),
        );
    }

    /**
     * Decodifica el mensaje tal y como viaja por HTTP: base64url estricto y
     * canónico, sin padding, de 86 caracteres (§5).
     *
     * @param  string  $encoded  Cadena base64url.
     *
     * @throws InvalidMessageException Si la codificación no es canónica o la
     *                                 longitud binaria no es 64.
     * @throws InvalidPointException Si alguno de los dos elementos no valida.
     */
    public static function fromBase64Url(string $encoded): self
    {
        return self::parse(Base64Url::decodeExactly(
            $encoded,
            OpaqueProfile::REGISTRATION_RESPONSE_BYTES,
            'registrationResponse'
        ));
    }

    /**
     * @return string Mensaje binario de 64 bytes, `evaluated_message || server_public_key` (§6.1).
     */
    public function serialize(): string
    {
        return BinaryCodec::concat($this->evaluatedMessage, $this->serverPublicKey);
    }

    /**
     * @return string Mensaje en base64url sin padding, 86 caracteres (§5).
     */
    public function toBase64Url(): string
    {
        return Base64Url::encode($this->serialize());
    }
}
