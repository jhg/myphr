/**
 * Entrada de Vite del panel (Spec 0001 §10).
 *
 * Se emite en el `<head>` del panel. Tres trabajos: registrar los componentes Alpine de las
 * pantallas de autenticación, instalar el interceptor de §9 y armar el bloqueo por inactividad de
 * §8. Todo lo que toca claves vive en los módulos que importa, con la clave maestra encerrada en el
 * scope de `auth/keyring.js`.
 *
 * `auth/keyring.js` se importa **el primero**, y por su efecto de módulo, no por lo que exporta: es
 * el scope de ese módulo el que sostiene la clave maestra durante toda la vida de la pestaña. Al
 * cargarse desde la cabecera del documento, sobrevive a `wire:navigate`, que sustituye el `<body>`
 * pero no vuelve a evaluar los módulos ya cargados (ADR 0003). Ese es el mecanismo entero por el
 * que la clave no muere al cambiar de pantalla.
 *
 * El registro va sobre `alpine:init` porque Alpine lo trae Livewire y arranca después. La rama
 * alternativa cubre el caso de que este módulo llegue tarde, con Alpine ya en marcha.
 */

import './auth/keyring.js';

import { armInactivityLock, disarmInactivityLock, interceptLogout } from './auth/lock.js';
import { loginForm } from './auth/loginPage.js';
import { setPasswordForm } from './auth/setPasswordPage.js';
import { installLivewirePayloadGuard } from './guards/livewirePayloadGuard.js';

/** Componentes que las plantillas nombran en `x-data`. */
const COMPONENTS = Object.freeze({
    phrLoginForm: loginForm,
    phrSetPasswordForm: setPasswordForm,
});

/** @param {{data: (name: string, factory: Function) => void}} alpine */
function register(alpine) {
    for (const [name, factory] of Object.entries(COMPONENTS)) {
        alpine.data(name, factory);
    }
}

if (window.Alpine !== undefined) {
    register(window.Alpine);
} else {
    document.addEventListener('alpine:init', () => register(window.Alpine), { once: true });
}

/**
 * Interceptor de §9. `livewire:init` es el momento en que `window.Livewire` existe y todavía no ha
 * salido ningún mensaje.
 */
document.addEventListener('livewire:init', () => installLivewirePayloadGuard(), { once: true });

/**
 * Bloqueo de §8, armado solo dentro del panel.
 *
 * Las pantallas de autenticación se marcan con `data-phr-page` y quedan fuera: ahí no hay sesión que
 * cerrar y la llamada de bloqueo solo produciría un error. La comprobación no puede hacerse al
 * evaluar este módulo, que corre en la cabecera con el `<body>` todavía sin analizar, así que se
 * repite en cada navegación: `livewire:navigated` se dispara también en la carga inicial, y la SPA
 * del panel cambia de pantalla sin volver a evaluar los módulos.
 */
function armLockForCurrentPage() {
    if (document.querySelector('[data-phr-page]') !== null) {
        disarmInactivityLock();

        return;
    }

    armInactivityLock();
}

document.addEventListener('livewire:navigated', armLockForCurrentPage);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', armLockForCurrentPage, { once: true });
} else {
    armLockForCurrentPage();
}

interceptLogout();
