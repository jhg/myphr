<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Vocabulario del rastro de actividad de la cuenta.
 *
 * En una aplicación de conocimiento cero, esto es lo único que el servidor puede contar de lo que
 * hace una persona: **qué ocurrió y cuándo**, nunca qué contenía. Los datos clínicos son sobres
 * cifrados y los ajustes también, así que ninguna entrada lleva contenido: la fila del registro se
 * queda en el verbo, el sujeto, quién lo causó y la fecha.
 *
 * Tampoco se guarda la IP ni el agente de usuario. Serían útiles para investigar un acceso indebido,
 * pero son datos personales que el servidor hoy no retiene en ningún otro sitio, y añadirlos aquí
 * ampliaría en silencio lo que sabemos de la persona. Si algún día se decide lo contrario, que sea
 * una decisión explícita y documentada, no un efecto colateral de este registro.
 *
 * Los valores son estables: se consultan y se agrupan por ellos, así que cambiarlos rompe el
 * historial ya escrito. Las transiciones del ciclo de vida de un evento clínico no están aquí; esas
 * las emite el propio modelo con los nombres de Eloquent, bajo el log `health-event`.
 */
enum AuditEvent: string
{
    /** Nombre del log donde viven todas estas entradas, frente al de eventos clínicos. */
    public const LOG_NAME = 'account';

    /** Alta de la cuenta: existe la fila de usuario, todavía sin registro OPAQUE completo. */
    case AccountCreated = 'account-created';

    /** El registro OPAQUE se completó: a partir de aquí la cuenta puede iniciar sesión. */
    case RegistrationCompleted = 'registration-completed';

    /**
     * Se emitió un enlace de registro para una cuenta. Es la acción más destructiva de la interfaz
     * (Spec 0001 §3.4): si la cuenta ya tenía datos, completar el registro nuevo los deja
     * inaccesibles. Quien la causa suele ser otra persona, y por eso importa que quede anotado.
     */
    case RegistrationLinkIssued = 'registration-link-issued';

    case LoggedIn = 'logged-in';

    /** Cierre de sesión explícito, incluido el bloqueo que descarta la clave maestra del navegador. */
    case LoggedOut = 'logged-out';

    case PasswordChanged = 'password-changed';

    /** Cambió el sobre de ajustes, el idioma, o ambos. Cuál de los dos no se anota. */
    case SettingsUpdated = 'settings-updated';
}
