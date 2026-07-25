<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `ServerLoginState` — estado que el servidor guarda entre `KE2` y `KE3`
 * (`docs/OPAQUE.md` §6.3 y §11.6).
 *
 * ```
 * ServerLoginState (128 bytes)
 *   [0..63]    expected_client_mac[Nm=64]
 *   [64..127]  session_key[Nx=64]
 * ```
 *
 * Es lo único que se persiste del handshake, y se cifra antes de guardarlo
 * (`docs/OPAQUE.md` §14.3). No contiene material de clave a largo plazo: sólo
 * la etiqueta esperada y la session key de este handshake concreto.
 */
final class ServerLoginState
{
    /** Longitud total del estado serializado, en bytes. */
    public const int LENGTH = 128;

    /** `Nm` — longitud de la etiqueta HMAC-SHA-512, en bytes. */
    public const int MAC_LENGTH = 64;

    /** `Nx` — longitud de la session key, en bytes. */
    public const int SESSION_KEY_LENGTH = 64;

    /**
     * @param  string  $expectedClientMac  Etiqueta esperada en `KE3`, 64 bytes.
     * @param  string  $sessionKey  Session key del handshake, 64 bytes.
     *
     * @throws InvalidMessageException Si alguna longitud no es la exacta.
     */
    public function __construct(
        public readonly string $expectedClientMac,
        public readonly string $sessionKey,
    ) {
        BinaryCodec::ensureLength($expectedClientMac, self::MAC_LENGTH, 'server_login_state.expected_client_mac');
        BinaryCodec::ensureLength($sessionKey, self::SESSION_KEY_LENGTH, 'server_login_state.session_key');
    }

    /**
     * Parsea los 128 bytes del estado con los offsets de §6.3.
     *
     * @param  string  $bytes  Estado serializado, exactamente 128 bytes.
     *
     * @throws InvalidMessageException Si la longitud total no es 128.
     */
    public static function parse(string $bytes): self
    {
        BinaryCodec::ensureLength($bytes, self::LENGTH, 'server_login_state');

        return new self(
            BinaryCodec::slice($bytes, 0, self::MAC_LENGTH, 'server_login_state.expected_client_mac'),
            BinaryCodec::slice($bytes, 64, self::SESSION_KEY_LENGTH, 'server_login_state.session_key'),
        );
    }

    /**
     * @return string Estado serializado, exactamente 128 bytes.
     */
    public function serialize(): string
    {
        return BinaryCodec::concat($this->expectedClientMac, $this->sessionKey);
    }
}
