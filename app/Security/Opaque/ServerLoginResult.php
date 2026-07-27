<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Result of `AuthServerRespond` (`docs/OPAQUE.md` §11.4 and §11.6): what gets
 * sent to the client and what the server persists.
 *
 * Of all the derived material only these two objects survive; the rest
 * (ephemeral private key, `dh1..dh3`, `ikm`, `prk`, `handshake_secret`, `Km2`,
 * `Km3`) is zeroized inside {@see ServerLogin::authServerRespond()}.
 */
final class ServerLoginResult
{
    /**
     * @param  Ke2  $ke2  320-byte message for the client.
     * @param  ServerLoginState  $state  128-byte state to encrypt and persist.
     */
    public function __construct(
        public readonly Ke2 $ke2,
        public readonly ServerLoginState $state,
    ) {}
}
