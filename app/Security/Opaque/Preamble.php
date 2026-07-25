<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `Preamble` del AKE 3DH (RFC 9807 §6.4.2.1 / `docs/OPAQUE.md` §11.5).
 *
 * Serializa el transcript sobre el que se derivan las claves y se calculan
 * los dos MAC:
 *
 * ```
 * preamble =
 *     "OPAQUEv1-"
 *  || uint16_be(len(context))          || context
 *  || uint16_be(len(client_identity))  || client_identity
 *  || KE1                                                    // 96 bytes
 *  || uint16_be(len(server_identity))  || server_identity
 *  || credential_response                                    // 192 bytes
 *  || server_nonce                                           // 32 bytes
 *  || server_public_keyshare                                 // 32 bytes
 * ```
 *
 * `KE1`, `credential_response`, `server_nonce` y `server_public_keyshare`
 * entran **sin** prefijo de longitud: sus tamaños son fijos por perfil. Los
 * tres campos variables llevan uint16 big-endian (`pack('n')`), nunca enteros
 * de plataforma.
 *
 * Identidades por defecto (RFC 9807 §4): si `client_identity` es `nil` se usa
 * `client_public_key`, y si `server_identity` es `nil` se usa
 * `server_public_key`. En este despliegue `server_identity` es siempre el
 * string de `OPAQUE_SERVER_IDENTITY` y `client_identity` es siempre el default
 * del RFC (`docs/OPAQUE.md` §6.4).
 */
final class Preamble
{
    /** Prefijo de versión del protocolo (RFC 9807 §6.4.2.1). */
    public const string PREFIX = 'OPAQUEv1-';

    /** `Nn` — longitud del nonce del servidor, en bytes. */
    private const int NONCE_LENGTH = 32;

    /** `Npk` — longitud de la clave pública efímera del servidor, en bytes. */
    private const int PUBLIC_KEYSHARE_LENGTH = 32;

    /**
     * Construye el preamble byte a byte.
     *
     * @param  string  $context  Contexto de aplicación, de 0 a 65535 bytes.
     *                           Cadena vacía en el perfil de producción
     *                           (`docs/OPAQUE.md` §2, §11.5).
     * @param  string  $clientIdentity  Identidad del cliente ya resuelta, de 0 a 65535 bytes.
     * @param  Ke1  $ke1  Mensaje `KE1` recibido; se serializa a sus 96 bytes.
     * @param  string  $serverIdentity  Identidad del servidor ya resuelta, de 0 a 65535 bytes.
     * @param  CredentialResponse  $credentialResponse  Se serializa a sus 192 bytes.
     * @param  string  $serverNonce  Nonce del servidor, 32 bytes.
     * @param  string  $serverPublicKeyshare  Clave pública efímera del servidor, 32 bytes.
     * @return string Preamble binario de longitud variable.
     *
     * @throws InvalidMessageException Si `$serverNonce` o `$serverPublicKeyshare`
     *                                 no tienen su longitud exacta.
     * @throws InvalidConfigurationException Si alguna identidad o el contexto
     *                                       exceden 65535 bytes.
     */
    public static function build(
        string $context,
        string $clientIdentity,
        Ke1 $ke1,
        string $serverIdentity,
        CredentialResponse $credentialResponse,
        string $serverNonce,
        string $serverPublicKeyshare,
    ): string {
        BinaryCodec::ensureLength($serverNonce, self::NONCE_LENGTH, 'preamble.server_nonce');
        BinaryCodec::ensureLength($serverPublicKeyshare, self::PUBLIC_KEYSHARE_LENGTH, 'preamble.server_public_keyshare');

        return BinaryCodec::concat(
            self::PREFIX,
            BinaryCodec::lengthPrefixed($context),
            BinaryCodec::lengthPrefixed($clientIdentity),
            $ke1->serialize(),
            BinaryCodec::lengthPrefixed($serverIdentity),
            $credentialResponse->serialize(),
            $serverNonce,
            $serverPublicKeyshare,
        );
    }

    /**
     * Resuelve una identidad opcional aplicando el default de RFC 9807 §4.
     *
     * @param  string|null  $identity  Identidad explícita, o `null` para `nil`.
     * @param  string  $publicKey  Clave pública que actúa de default.
     * @return string Identidad efectiva.
     */
    public static function resolveIdentity(?string $identity, string $publicKey): string
    {
        return $identity ?? $publicKey;
    }
}
