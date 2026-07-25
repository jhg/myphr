<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Fuente de aleatoriedad inyectable (`docs/OPAQUE.md` §20.3).
 *
 * Existe para poder reproducir los vectores oficiales de RFC 9807 Apéndice C,
 * que fijan `envelope_nonce`, `masking_nonce`, `server_nonce`, `client_nonce`,
 * seeds y blinds. Toda generación de bytes aleatorios del subsistema OPAQUE
 * pasa por aquí; nunca se llama a `random_bytes()` directamente ni se mockean
 * funciones globales.
 */
interface RandomSource
{
    /**
     * Devuelve exactamente `$length` bytes.
     *
     * @param  int<1, max>  $length  Número de bytes solicitados.
     * @return string Cadena binaria de longitud `$length`.
     *
     * @throws InvalidConfigurationException Si `$length` no es positivo o la
     *                                       fuente no puede satisfacerlo.
     */
    public function bytes(int $length): string;
}
