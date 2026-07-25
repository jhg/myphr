/**
 * Bloqueo por inactividad (Spec 0001 §8; ADR 0003 y 0009).
 *
 * Quince minutos sin actividad y la sesión se cierra **entera**: el secreto de sesión y la sesión
 * de Laravel mueren en la misma operación de servidor, y el navegador hace una recarga dura. No es
 * una pantalla superpuesta: una capa encima del panel deja vivos el contexto de JavaScript, la
 * clave maestra en memoria y las instantáneas de DOM que Livewire retiene con datos descifrados, de
 * modo que quitar un `display: none` desde la consola devolvería el panel entero con datos en claro.
 *
 * **Quien cuenta el tiempo es el servidor**, sobre la última petición autenticada. Este temporizador
 * no decide la caducidad: no se ejecuta en una pestaña que el sistema operativo descartó por memoria
 * ni en una que nunca llegó a abrirse. Lo único que hace es avisar y disparar la llamada.
 *
 * El orden del cierre es normativo (§4.6): la recarga dura va **después** de que el servidor
 * confirme. Recargar antes deja, ante una pérdida de red, el secreto vivo en servidor y al cliente
 * sin clave en memoria, que es un bloqueo que no bloqueó nada del lado servidor. La clave sí se
 * olvida de inmediato: eso no depende de la red y no tiene contrapartida.
 *
 * `sessionStorage['phr.rk']` no se borra: al morir el secreto queda cifrado bajo algo que ya no
 * existe en ningún sitio (§8).
 */

import { postJson } from './http.js';
import { forget } from './keyring.js';
import { hardReload } from './navigate.js';

/** Inactividad tolerada antes del cierre (ADR 0009). */
export const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;

/** Antelación con la que se avisa antes de cerrar. */
export const WARNING_BEFORE_MS = 60 * 1000;

/** Espera antes de reintentar la llamada de cierre cuando la red falla. */
const RETRY_DELAY_MS = 5 * 1000;

/** Evento que se emite cuando quedan `WARNING_BEFORE_MS` para el cierre. */
export const LOCK_WARNING_EVENT = 'phr:lock-warning';

/** Evento que se emite al empezar el cierre, ya sin clave en memoria. */
export const LOCK_EVENT = 'phr:locked';

/**
 * Actividad que reinicia la cuenta. Solo gestos deliberados: `mousemove` la reiniciaría con el
 * ratón rozado por una manga, que es exactamente el puesto desatendido que esto cubre.
 */
const ACTIVITY_EVENTS = Object.freeze(['pointerdown', 'keydown', 'wheel', 'touchstart']);

/** @type {ReturnType<typeof setTimeout>|null} */
let warningTimer = null;

/** @type {ReturnType<typeof setTimeout>|null} */
let deadlineTimer = null;

let armed = false;
let locking = false;

/**
 * @param {string} name
 * @returns {string|null}
 */
function metaContent(name) {
    return document.head?.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
}

/** Reinicia la cuenta atrás. Se llama en cada gesto y en cada navegación de Livewire. */
function reschedule() {
    clearTimers();

    if (!armed || locking) {
        return;
    }

    warningTimer = setTimeout(
        () => document.dispatchEvent(new CustomEvent(LOCK_WARNING_EVENT, {
            detail: { millisecondsLeft: WARNING_BEFORE_MS },
        })),
        INACTIVITY_LIMIT_MS - WARNING_BEFORE_MS
    );

    deadlineTimer = setTimeout(() => { void lock(); }, INACTIVITY_LIMIT_MS);
}

function clearTimers() {
    if (warningTimer !== null) {
        clearTimeout(warningTimer);
        warningTimer = null;
    }

    if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
    }
}

/** @param {Event} _event */
function onActivity(_event) {
    reschedule();
}

/**
 * Cierra la sesión por completo y recarga.
 *
 * Es también el camino del cierre de sesión normal: el `POST /logout` de Filament no sabe nada del
 * secreto de sesión, así que salir por él dejaría el secreto vivo (§8).
 *
 * @returns {Promise<void>}
 */
export async function lock() {
    if (locking) {
        return;
    }

    locking = true;
    clearTimers();

    /** La clave se olvida ya: no depende de que la red funcione. */
    forget();

    document.dispatchEvent(new CustomEvent(LOCK_EVENT));

    const lockUrl = metaContent('phr-lock-url');
    const loginUrl = metaContent('phr-login-url');

    if (lockUrl === null || loginUrl === null) {
        locking = false;

        return;
    }

    try {
        await postJson(lockUrl);
    } catch {
        /**
         * Sin confirmación no hay recarga (§4.6). Se reintenta en vez de rendirse: la pestaña sigue
         * abierta, sin clave en memoria, y la sesión de servidor sigue viva hasta que la llamada
         * llegue.
         */
        locking = false;
        setTimeout(() => { void lock(); }, RETRY_DELAY_MS);

        return;
    }

    hardReload(loginUrl);
}

/**
 * Arranca el temporizador. Idempotente: llamarlo en cada navegación de Livewire no acumula
 * escuchas.
 *
 * @returns {boolean} `false` si la página no publica las URLs necesarias, y entonces no hay nada
 *          que armar.
 */
export function armInactivityLock() {
    if (armed) {
        reschedule();

        return true;
    }

    if (metaContent('phr-lock-url') === null || metaContent('phr-login-url') === null) {
        return false;
    }

    for (const event of ACTIVITY_EVENTS) {
        window.addEventListener(event, onActivity, { capture: true, passive: true });
    }

    document.addEventListener('livewire:navigated', onActivity);

    armed = true;
    reschedule();

    return true;
}

/**
 * Para el temporizador y suelta las escuchas. Las pantallas de autenticación no lo quieren armado:
 * ahí no hay sesión que cerrar y la llamada solo produciría un error.
 */
export function disarmInactivityLock() {
    clearTimers();

    if (!armed) {
        return;
    }

    for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity, { capture: true });
    }

    document.removeEventListener('livewire:navigated', onActivity);

    armed = false;
}

/**
 * Desvía el `POST /logout` de Filament por el camino de destrucción de §8.
 *
 * Interpretación de esta implementación, señalada en el informe: la spec exige que el cierre normal
 * pase por el mismo camino, pero no dice si eso se resuelve en cliente o en servidor. Si la marca
 * del formulario cambiara, el `submit` seguiría su curso y el cierre volvería a ser el de Filament,
 * que es el comportamiento de partida y no una regresión de seguridad nueva.
 */
export function interceptLogout() {
    document.addEventListener('submit', (event) => {
        const form = event.target;

        if (!(form instanceof HTMLFormElement)) {
            return;
        }

        const action = form.getAttribute('action');

        if (action === null || !new URL(action, window.location.origin).pathname.endsWith('/logout')) {
            return;
        }

        event.preventDefault();

        void lock();
    }, { capture: true });
}
