<?php

declare(strict_types=1);

namespace App\Security\Opaque;

use Exception;

/**
 * Implementación de producción de {@see RandomSource} sobre `random_bytes()`
 * (`docs/OPAQUE.md` §4, §20.3).
 *
 * `random_bytes()` es el CSPRNG del sistema y es la única fuente permitida en
 * producción. Los tests sustituyen esta clase por una fuente determinista con
 * los bytes exactos del vector.
 */
final class SystemRandomSource implements RandomSource
{
    /**
     * @param  int<1, max>  $length  Número de bytes solicitados.
     * @return string Cadena binaria de longitud `$length`.
     *
     * @throws InvalidConfigurationException Si `$length` no es positivo o el
     *                                       CSPRNG del sistema no está
     *                                       disponible.
     */
    public function bytes(int $length): string
    {
        if ($length < 1) {
            throw new InvalidConfigurationException("Random byte count must be positive, got {$length}.");
        }

        try {
            return random_bytes($length);
        } catch (Exception $exception) {
            throw new InvalidConfigurationException('The system CSPRNG is unavailable.', 0, $exception);
        }
    }
}
