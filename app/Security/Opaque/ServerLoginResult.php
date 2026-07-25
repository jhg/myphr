<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Resultado de `AuthServerRespond` (`docs/OPAQUE.md` §11.4 y §11.6): lo que se
 * envía al cliente y lo que el servidor persiste.
 *
 * De todo el material derivado sólo sobreviven estos dos objetos; el resto
 * (efímera privada, `dh1..dh3`, `ikm`, `prk`, `handshake_secret`, `Km2`,
 * `Km3`) se zeroiza dentro de {@see ServerLogin::authServerRespond()}.
 */
final class ServerLoginResult
{
    /**
     * @param  Ke2  $ke2  Mensaje de 320 bytes para el cliente.
     * @param  ServerLoginState  $state  Estado de 128 bytes a cifrar y persistir.
     */
    public function __construct(
        public readonly Ke2 $ke2,
        public readonly ServerLoginState $state,
    ) {}
}
