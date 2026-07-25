<?php

declare(strict_types=1);

namespace App\Provisioning;

use RuntimeException;

/**
 * Enlace de registro inexistente, caducado o ya consumido
 * (`docs/OPAQUE.md` §13.3, Spec 0001 §7).
 *
 * Los tres casos comparten esta excepción y este mensaje a propósito:
 * distinguirlos delata si un token existió alguna vez y en qué estado quedó.
 */
final class InvalidRegistrationLinkException extends RuntimeException
{
    /** Mensaje único para los tres casos. */
    public const MESSAGE = 'El enlace de registro no es válido.';

    public static function generic(): self
    {
        return new self(self::MESSAGE);
    }
}
