<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Claves derivadas por `DeriveKeys` (RFC 9807 §6.4.2.2 /
 * `docs/OPAQUE.md` §11.6).
 *
 * Contiene sólo las tres salidas que sobreviven a la derivación: la session
 * key y las dos claves de MAC. `prk` y `handshake_secret` no se guardan aquí
 * porque se zeroizan en cuanto dejan de hacer falta.
 */
final class AkeKeys
{
    /** `Nx` / `Nm` — longitud de cada valor derivado, en bytes. */
    public const int LENGTH = 64;

    /**
     * @param  string  $sessionKey  `Derive-Secret(prk, "SessionKey", SHA512(preamble))`, 64 bytes.
     * @param  string  $serverMacKey  `Km2`, 64 bytes.
     * @param  string  $clientMacKey  `Km3`, 64 bytes.
     *
     * @throws InvalidMessageException Si alguna longitud no es 64.
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
