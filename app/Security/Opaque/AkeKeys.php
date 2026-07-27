<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Keys derived by `DeriveKeys` (RFC 9807 §6.4.2.2 /
 * `docs/OPAQUE.md` §11.6).
 *
 * It holds only the three outputs that survive the derivation: the session
 * key and the two MAC keys. `prk` and `handshake_secret` are not kept here
 * because they are zeroized as soon as they are no longer needed.
 */
final class AkeKeys
{
    /** `Nx` / `Nm` — length of each derived value, in bytes. */
    public const int LENGTH = 64;

    /**
     * @param  string  $sessionKey  `Derive-Secret(prk, "SessionKey", SHA512(preamble))`, 64 bytes.
     * @param  string  $serverMacKey  `Km2`, 64 bytes.
     * @param  string  $clientMacKey  `Km3`, 64 bytes.
     *
     * @throws InvalidMessageException If any length is not 64.
     */
    public function __construct(
        public readonly string $sessionKey,
        public readonly string $serverMacKey,
        public readonly string $clientMacKey,
    ) {
        BinaryCodec::ensureLength($sessionKey, self::LENGTH, 'ake_keys.session_key');
        BinaryCodec::ensureLength($serverMacKey, self::LENGTH, 'ake_keys.server_mac_key');
        BinaryCodec::ensureLength($clientMacKey, self::LENGTH, 'ake_keys.client_mac_key');
    }
}
