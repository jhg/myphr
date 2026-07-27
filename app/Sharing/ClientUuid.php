<?php

declare(strict_types=1);

namespace App\Sharing;

use Illuminate\Support\Str;

/**
 * Identificador generado en el cliente para un recorte o un enlace (ADR 0011).
 *
 * Tiene que ser UUID**v4** y se comprueba la versión, no solo la forma. No es quisquillosidad: el
 * ADR descarta el v7 para estos identificadores porque lleva el instante de creación en claro dentro
 * de sí mismo, y estos acaban en la URL que la persona enseña y en la foto del QR que el profesional
 * guarda en su carrete. Si el servidor solo comprobase «parece un UUID», bastaría un cliente
 * descuidado —o una versión futura de `HasUuids`, que en Laravel 12 ya genera v7 por defecto— para
 * reintroducir esa fuga sin que nada fallase.
 */
final class ClientUuid
{
    private function __construct() {}

    public static function isValid(mixed $value): bool
    {
        /** Posición 14 de la forma canónica `8-4-4-4-12`: el dígito de versión. */
        return is_string($value) && Str::isUuid($value) && $value[14] === '4';
    }
}
