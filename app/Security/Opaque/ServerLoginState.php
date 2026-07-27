<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `ServerLoginState` — state the server keeps between `KE2` and `KE3`
 * (`docs/OPAQUE.md` §6.3 and §11.6).
 *
 * ```
 * ServerLoginState (128 bytes)
 *   [0..63]    expected_client_mac[Nm=64]
 *   [64..127]  session_key[Nx=64]
 * ```
 *
 * It is the only part of the handshake that is persisted, and it is encrypted
 * before being stored (`docs/OPAQUE.md` §14.3). It holds no long-term key
 * material: only the expected tag and the session key of this one handshake.
 */
final class ServerLoginState
{
    /** Total length of the serialized state, in bytes. */
    public const int LENGTH = 128;

    /** `Nm` — length of the HMAC-SHA-512 tag, in bytes. */
    public const int MAC_LENGTH = 64;

    /** `Nx` — length of the session key, in bytes. */
    public const int SESSION_KEY_LENGTH = 64;

    /**
     * @param  string  $expectedClientMac  Tag expected in `KE3`, 64 bytes.
     * @param  string  $sessionKey  Session key of the handshake, 64 bytes.
     *
     * @throws InvalidMessageException If any length is not exact.
     */
    public function __construct(
        public readonly string $expectedClientMac,
        public readonly string $sessionKey,
    ) {
        BinaryCodec::ensureLength($expectedClientMac, self::MAC_LENGTH, 'server_login_state.expected_client_mac');
        BinaryCodec::ensureLength($sessionKey, self::SESSION_KEY_LENGTH, 'server_login_state.session_key');
    }

    /**
     * Parses the 128 bytes of the state with the offsets from §6.3.
     *
     * @param  string  $bytes  Serialized state, exactly 128 bytes.
     *
     * @throws InvalidMessageException If the total length is not 128.
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
