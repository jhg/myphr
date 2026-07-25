<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `DeriveKeys` y los dos MAC del AKE 3DH
 * (RFC 9807 §6.4.2.2 / `docs/OPAQUE.md` §11.6).
 *
 * ```
 * prk              = Extract("", ikm)
 * preamble_hash    = SHA512(preamble)
 * handshake_secret = Derive-Secret(prk, "HandshakeSecret", preamble_hash)
 * session_key      = Derive-Secret(prk, "SessionKey",      preamble_hash)
 * Km2              = Derive-Secret(handshake_secret, "ServerMAC", "")
 * Km3              = Derive-Secret(handshake_secret, "ClientMAC", "")
 *
 * server_mac          = HMAC-SHA-512(Km2, SHA512(preamble))
 * expected_client_mac = HMAC-SHA-512(Km3, SHA512(preamble || server_mac))
 * ```
 *
 * El hash del preamble entra como `Context` de `Expand-Label` en
 * `HandshakeSecret` y `SessionKey`; `Km2` y `Km3` llevan contexto vacío. Esta
 * interpretación procede del pseudocódigo de `docs/OPAQUE.md` §11.6, que exige
 * contrastarla contra los vectores del Apéndice C de RFC 9807 antes de darla
 * por buena.
 *
 * Obsérvese que `expected_client_mac` hashea `preamble || server_mac`, no
 * `SHA512(preamble) || server_mac`: por eso las funciones de MAC reciben el
 * preamble completo y no su hash.
 */
final class AkeKeySchedule
{
    /** Etiqueta de `Derive-Secret` para el handshake secret. */
    public const string LABEL_HANDSHAKE_SECRET = 'HandshakeSecret';

    /** Etiqueta de `Derive-Secret` para la session key. */
    public const string LABEL_SESSION_KEY = 'SessionKey';

    /** Etiqueta de `Derive-Secret` para `Km2`. */
    public const string LABEL_SERVER_MAC = 'ServerMAC';

    /** Etiqueta de `Derive-Secret` para `Km3`. */
    public const string LABEL_CLIENT_MAC = 'ClientMAC';

    /** Algoritmo de hash y de HMAC del perfil (`docs/OPAQUE.md` §2). */
    private const string HASH_ALGORITHM = 'sha512';

    /**
     * `DeriveKeys(ikm, preamble)` (RFC 9807 §6.4.2.2).
     *
     * `prk` y `handshake_secret` se zeroizan antes de devolver: no forman
     * parte del resultado. PHP no garantiza el borrado de todas las copias
     * internas de un string, así que la zeroización es best effort
     * (`docs/OPAQUE.md` §11.6).
     *
     * @param  string  $ikm  `dh1 || dh2 || dh3`, 96 bytes en este perfil.
     * @param  string  $preamble  Preamble completo (§11.5), longitud variable.
     * @return AkeKeys Session key, `Km2` y `Km3`, de 64 bytes cada uno.
     */
    public static function deriveKeys(string $ikm, string $preamble): AkeKeys
    {
        $prk = HkdfSha512::extract('', $ikm);
        $preambleHash = self::hash($preamble);

        $handshakeSecret = ExpandLabel::deriveSecret($prk, self::LABEL_HANDSHAKE_SECRET, $preambleHash);
        $sessionKey = ExpandLabel::deriveSecret($prk, self::LABEL_SESSION_KEY, $preambleHash);

        $serverMacKey = ExpandLabel::deriveSecret($handshakeSecret, self::LABEL_SERVER_MAC, '');
        $clientMacKey = ExpandLabel::deriveSecret($handshakeSecret, self::LABEL_CLIENT_MAC, '');

        sodium_memzero($prk);
        sodium_memzero($handshakeSecret);

        return new AkeKeys($sessionKey, $serverMacKey, $clientMacKey);
    }

    /**
     * `server_mac = HMAC-SHA-512(Km2, SHA512(preamble))` (RFC 9807 §6.4.4).
     *
     * @param  string  $serverMacKey  `Km2`, 64 bytes.
     * @param  string  $preamble  Preamble completo, longitud variable.
     * @return string Etiqueta de 64 bytes (`Nm`).
     */
    public static function serverMac(string $serverMacKey, string $preamble): string
    {
        return hash_hmac(self::HASH_ALGORITHM, self::hash($preamble), $serverMacKey, true);
    }

    /**
     * `client_mac = HMAC-SHA-512(Km3, SHA512(preamble || server_mac))`
     * (RFC 9807 §6.4.3 / §6.4.4).
     *
     * En el servidor es el `expected_client_mac` contra el que se compara el
     * `KE3` recibido.
     *
     * @param  string  $clientMacKey  `Km3`, 64 bytes.
     * @param  string  $preamble  Preamble completo, longitud variable.
     * @param  string  $serverMac  Etiqueta del servidor, 64 bytes.
     * @return string Etiqueta de 64 bytes (`Nm`).
     *
     * @throws InvalidMessageException Si `$serverMac` no mide 64 bytes.
     */
    public static function clientMac(string $clientMacKey, string $preamble, string $serverMac): string
    {
        BinaryCodec::ensureLength($serverMac, AuthResponse::MAC_LENGTH, 'server_mac');

        return hash_hmac(self::HASH_ALGORITHM, self::hash($preamble.$serverMac), $clientMacKey, true);
    }

    /**
     * `Hash` del perfil: SHA-512 en binario (`docs/OPAQUE.md` §2).
     *
     * @param  string  $data  Entrada binaria de longitud arbitraria.
     * @return string Digest de 64 bytes (`Nh`).
     */
    public static function hash(string $data): string
    {
        return hash(self::HASH_ALGORITHM, $data, true);
    }
}
