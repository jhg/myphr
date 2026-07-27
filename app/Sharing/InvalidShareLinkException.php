<?php

declare(strict_types=1);

namespace App\Sharing;

use RuntimeException;

/**
 * Error **genérico y único** de la lectura de un recorte (ADR 0011).
 *
 * Hay exactamente una instancia posible, sin variantes ni códigos internos, para que no exista la
 * tentación de dejar escapar la causa. Las cuatro causas —el enlace no existe, caducó, se revocó, o
 * el PIN es incorrecto— tienen que producir la misma respuesta byte a byte: si se distinguen, quien
 * tenga una lista de identificadores puede averiguar cuáles siguen vivos, y quien pruebe PINes sabe
 * cuándo ha dado con un enlace real.
 *
 * Es la razón por la que esta clase no lleva un constructor con mensaje: cualquier detalle que
 * alguien añadiera aquí acabaría en el cuerpo de la respuesta.
 */
final class InvalidShareLinkException extends RuntimeException
{
    /** Código que sale al cliente. Uno solo, y a propósito no dice qué falló. */
    public const string CODE = 'invalid_link_or_pin';

    public static function generic(): self
    {
        return new self('El enlace no existe, caducó, se revocó, o el PIN no es correcto.');
    }
}
