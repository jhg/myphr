/**
 * Recuperación de la clave maestra tras una recarga (Spec 0001 §6.2; ADR 0003).
 *
 * Un F5, un 419 o un despliegue a mitad de sesión pierden la clave de memoria. No es un error: es
 * un estado normal y frecuente. La interfaz degrada a pedir autenticación, nunca a una pantalla
 * rota.
 *
 * Los dos códigos de error tienen el mismo destino, la pantalla de login, pero significan cosas
 * distintas: `401` es la sesión de Laravel muerta, `410` es el secreto destruido por un bloqueo o
 * un cierre de sesión (§4.5).
 */

import { zeroize } from '../crypto/zeroize.js';
import { AuthRequestError, postJson } from './http.js';
import { isUnlocked, restoreFromSessionSecret, decodeSessionSecret } from './keyring.js';

/** Resultados posibles de un intento de recuperación. */
export const RecoveryOutcome = Object.freeze({
    /** Ya había clave en memoria, o se recuperó. */
    Unlocked: 'unlocked',
    /** No hay forma de recuperarla sin contraseña: hay que ir al login. */
    NeedsLogin: 'needs-login',
});

/** @returns {string|null} */
function metaContent(name) {
    return document.head?.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
}

/**
 * Intenta dejar la clave maestra en memoria sin pedir la contraseña (§6.2).
 *
 * @param {string} userId UUID del usuario de la sesión, que es el dato asociado del paquete.
 * @returns {Promise<string>} Uno de `RecoveryOutcome`.
 */
export async function recoverMasterKey(userId) {
    if (isUnlocked()) {
        return RecoveryOutcome.Unlocked;
    }

    const url = metaContent('phr-session-secret-url');

    if (url === null) {
        return RecoveryOutcome.NeedsLogin;
    }

    let payload;

    try {
        payload = await postJson(url);
    } catch (failure) {
        /** 401 y 410 llevan al mismo sitio; cualquier otro fallo también, sin adivinar nada. */
        if (failure instanceof AuthRequestError) {
            return RecoveryOutcome.NeedsLogin;
        }

        throw failure;
    }

    const sessionSecret = decodeSessionSecret(payload.sessionSecret);

    try {
        return restoreFromSessionSecret(sessionSecret, userId)
            ? RecoveryOutcome.Unlocked
            : RecoveryOutcome.NeedsLogin;
    } finally {
        zeroize(sessionSecret);
    }
}

/**
 * Envía a la pantalla de login con una recarga dura (§8).
 *
 * Aterrizar en el login con la clave todavía en memoria es uno de los tres cierres que exigen
 * destruir el contexto de JavaScript, porque solo así mueren las instantáneas de DOM que Livewire
 * retiene con datos descifrados.
 */
export function goToLogin() {
    const url = metaContent('phr-login-url');

    if (url !== null) {
        window.location.href = url;
    }
}
