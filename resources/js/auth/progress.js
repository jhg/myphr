/**
 * Barra de progreso de las pantallas de autenticación.
 *
 * No es adorno. `finishRegistration` y `finishLogin` corren Argon2id (t=3, m=64 MiB, p=4) en el
 * WebAssembly del paquete, de forma **síncrona y en el hilo principal**: la pestaña se queda
 * bloqueada varios segundos. Sin nada en pantalla que diga que algo está pasando, la persona vuelve
 * a pulsar el botón, y con el enlace de registro de por medio ese segundo intento es un enlace
 * consumido (`docs/specs/0001-account-provisioning-and-session-bootstrap.md` §7).
 *
 * Dos consecuencias de que el hilo principal esté bloqueado, y las dos condicionan este módulo:
 *
 * 1. **Hay que pintar antes de bloquear.** Cambiar el estado de Alpine no pinta nada por sí solo:
 *    el navegador pinta en el siguiente fotograma, que no llega si la llamada síncrona empieza
 *    antes. Por eso `advance()` espera dos `requestAnimationFrame` antes de devolver el control.
 * 2. **La animación tiene que poder correr fuera del hilo principal.** Solo `transform` y `opacity`
 *    se animan en el compositor; animar `width` exige el hilo principal, que es justo el que está
 *    ocupado, y la barra se quedaría congelada. De ahí `transform: scaleX(...)` con una transición
 *    larga y lineal: se lanza antes del bloqueo y el compositor la sigue moviendo durante él.
 *
 * El avance es honesto en el orden pero no en el tiempo: nadie puede saber cuánto tarda Argon2id en
 * un dispositivo concreto (riesgo 1 de §12). La transición larga se ajusta a una estimación
 * generosa y la etapa siguiente la corta en cuanto llega de verdad.
 */

/** Duración estimada, en segundos, de un Argon2id con los parámetros del ADR 0004. */
export const KEY_STRETCHING_SECONDS = 12;

/** Duración por defecto de los tramos que no bloquean el hilo. */
const QUICK_SECONDS = 0.3;

/**
 * Espera a que el navegador pinte.
 *
 * Dos fotogramas, no uno: el primero se agenda antes de que Alpine haya aplicado el cambio de
 * estado al DOM, así que solo el segundo garantiza que lo pintado incluye la etapa nueva.
 *
 * @returns {Promise<void>}
 */
export function nextPaint() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/**
 * Estado y comportamiento de la barra, para mezclar en un componente Alpine.
 *
 * @returns {{progress: number, progressSeconds: number, stage: string,
 *            advance: (stage: string, target: number, seconds?: number) => Promise<void>,
 *            resetProgress: () => void, progressStyle: () => string}}
 */
export function progressMixin() {
    return {
        /** Fracción de la barra, entre 0 y 1. */
        progress: 0,

        /** Duración de la transición hacia `progress`, en segundos. */
        progressSeconds: 0,

        /** Texto que ve la persona. Nunca lleva detalle técnico. */
        stage: '',

        /**
         * Anuncia una etapa y devuelve el control **después** de que el navegador la haya pintado.
         *
         * @param {string} stage Texto de la etapa.
         * @param {number} target Fracción destino, entre 0 y 1.
         * @param {number} [seconds] Duración de la transición.
         * @returns {Promise<void>}
         */
        async advance(stage, target, seconds = QUICK_SECONDS) {
            this.stage = stage;
            this.progress = target;
            this.progressSeconds = seconds;

            await nextPaint();
        },

        /** Deja la barra a cero, sin transición: al reintentar no debe retroceder animándose. */
        resetProgress() {
            this.stage = '';
            this.progress = 0;
            this.progressSeconds = 0;
        },

        /**
         * Estilo de la barra interior, como objeto y no como cadena: Alpine mezcla un objeto con
         * el `style` que ya trae el elemento, mientras que una cadena lo sustituiría entero y se
         * llevaría por delante el `scaleX(0)` inicial de la plantilla, que es el punto de partida
         * de la transición.
         *
         * @returns {{transform: string, transition: string}}
         */
        progressStyle() {
            return {
                transform: `scaleX(${this.progress})`,
                transition: `transform ${this.progressSeconds}s linear`,
            };
        },
    };
}
