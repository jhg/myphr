/**
 * Arranque de sesión del panel (Spec 0001 §6.2; ADR 0003).
 *
 * Toda pantalla del panel que va a pedir datos cifrados llama primero a `bootstrapSession()`. Es
 * quien decide, en este orden, si ya hay clave maestra en memoria, si se puede recuperar sin pedir
 * la contraseña, o si hay que ir al login. Perder la clave es un estado normal y frecuente, no un
 * error (§7): esta función nunca deja una pantalla rota, ni siquiera ante un fallo inesperado.
 *
 * Contrato con las pantallas: cuando la sesión queda desbloqueada se emite en `document` el evento
 * `phr:session-ready` (sin `detail`). Una pantalla cifrada que necesita esperar a que haya clave
 * antes de pedir su primer lote de datos debe escuchar ese evento; si al montarse ya hay clave
 * (`isUnlocked()` cierto), el evento puede haberse emitido antes de que la escucha exista, así que
 * conviene comprobar `isUnlocked()` primero y solo esperar el evento si todavía es falso.
 */

import { isUnlocked } from './keyring.js';
import { goToLogin, recoverMasterKey, RecoveryOutcome } from './recovery.js';

/** Evento emitido en `document` cuando la sesión queda desbloqueada. */
export const SESSION_READY_EVENT = 'phr:session-ready';

/** @returns {string|null} */
function metaContent(name) {
    return document.head?.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
}

/** Avisa a las pantallas que esperan el contrato de este módulo. */
function announceReady() {
    document.dispatchEvent(new CustomEvent(SESSION_READY_EVENT));
}

/**
 * Deja la clave maestra lista en memoria o envía al login. No lanza: cualquier fallo inesperado
 * también acaba en el login, nunca en una pantalla rota (ADR 0003).
 *
 * @returns {Promise<void>}
 */
export async function bootstrapSession() {
    /** Las pantallas de autenticación (login, set-password) no tienen sesión que arrancar. */
    if (document.querySelector('[data-phr-page]') !== null) {
        return;
    }

    const userId = metaContent('phr-user-id');

    /** Sin el meta del panel no hay sesión que recuperar. */
    if (userId === null) {
        return;
    }

    if (isUnlocked()) {
        announceReady();

        return;
    }

    try {
        const outcome = await recoverMasterKey(userId);

        if (outcome === RecoveryOutcome.NeedsLogin) {
            goToLogin();

            return;
        }

        announceReady();
    } catch {
        goToLogin();
    }
}
