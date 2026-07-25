<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Para qué nació una fila de estado efímero de OPAQUE.
 *
 * Existe porque el cambio de contraseña reutiliza las mismas dos tablas que el alta y el login, y
 * sin esta discriminación un handshake de login se podría canjear por un ticket de cambio de
 * contraseña, y un pendiente nacido en el cambio se podría colar por `registration/finish`, que
 * consumiría un enlace de registro y reescribiría la configuración cifrada.
 *
 * Los valores son los que ya viajan en la base de datos: cambiarlos exige migrar las filas vivas.
 */
enum OpaquePurpose: string
{
    /** Registro pendiente nacido de un enlace de alta (Spec 0001 §4.1). */
    case Registration = 'registration';

    /** Handshake de login normal (Spec 0001 §4.3). */
    case Login = 'login';

    /** Reautenticación o re-registro dentro del cambio de contraseña. */
    case PasswordChange = 'password-change';
}
