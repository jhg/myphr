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

    /**
     * Se compartió un recorte con un profesional (ADR 0011).
     *
     * Anota únicamente que hubo una compartición y cuándo, que es lo que el servidor ya ve por el
     * mero hecho de almacenar la fila. Nunca el rango, ni los tipos, ni el número de eventos: van
     * cifrados dentro del descriptor, y repetirlos aquí devolvería al servidor justo el metadato que
     * el ADR 0006 quitó del esquema.
     */
    case ShareCreated = 'share-created';

    /**
     * Se revocó un recorte compartido (ADR 0011). Revocar es borrado físico, así que sin esta
     * entrada no quedaría constancia de que ese recorte llegó a existir.
     *
     * No hay caso equivalente para las **descargas**: un rastro de accesos diría cuántas veces y
     * cuándo se consultó cada envío, que es exactamente lo que el ADR 0006 descarta.
     */
    case ShareRevoked = 'share-revoked';
}
