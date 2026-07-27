<?php

declare(strict_types=1);

namespace App\Sharing;

/**
 * Lista cerrada de caducidades de un recorte (ADR 0011): 24 horas por defecto, 7 días como máximo y
 * una hora para el uso presencial.
 *
 * No la elige el servidor. La caducidad exacta entra en la derivación de `wrapKey` y en el dato
 * asociado del envoltorio (`canonicalDate(expiresAt)`), así que el cliente tiene que conocerla
 * **antes** de cifrar y por tanto antes de enviar nada. Lo que el servidor puede hacer, y hace, es
 * comprobar que el instante recibido corresponde a una de estas tres opciones.
 *
 * Esa comprobación admite una tolerancia porque entre que el cliente fija `expiresAt` y llega la
 * petición pasa el Argon2id del PIN, que en un equipo lento son varios segundos, más la subida del
 * paquete. Exigir igualdad al segundo convertiría un portátil viejo en un error de validación.
 */
enum ShareTtl: string
{
    /** Uso presencial: se enseña la pantalla en la consulta y se acabó. */
    case Hour = '1h';

    /** Por defecto. */
    case Day = '24h';

    /** Máximo. */
    case Week = '7d';

    /**
     * Holgura admitida al comprobar `expiresAt` contra la lista, en minutos.
     *
     * Quince minutos cubren con holgura el Argon2id del PIN en un equipo lento más la subida de un
     * paquete grande, y siguen siendo despreciables frente al menor de los TTL.
     */
    public const int TOLERANCE_MINUTES = 15;

    public function hours(): int
    {
        return match ($this) {
            self::Hour => 1,
            self::Day => 24,
            self::Week => 24 * 7,
        };
    }
}
