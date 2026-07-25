<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Detección de terminal interactiva, inyectable para poder probarla.
 *
 * La usa `phr:issue-registration-link` (Spec 0001 §10): si la salida no es un
 * terminal, la URL del enlace acabaría en un fichero de log, en la salida de un
 * cron o en el registro de un sistema de despliegue, que son justo los sitios
 * donde el ADR 0009 no quiere que aparezca.
 */
interface Terminal
{
    /**
     * @return bool `true` si la salida estándar es un terminal interactivo.
     */
    public function isInteractive(): bool;
}
