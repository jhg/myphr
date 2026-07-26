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

import { setLocale } from './i18n/index.js';
import { armInactivityLock, disarmInactivityLock, interceptLogout } from './auth/lock.js';
import { loginForm } from './auth/loginPage.js';
import { profilePage } from './auth/profilePage.js';
import { registerPage } from './auth/registerPage.js';
import { setPasswordForm } from './auth/setPasswordPage.js';
import { bootstrapSession } from './auth/sessionBootstrap.js';
import { installLivewirePayloadGuard } from './guards/livewirePayloadGuard.js';
import { bloodPressurePage } from './health/bloodPressurePage.js';
import { dashboardPage } from './health/dashboardPage.js';
import { glucosePage } from './health/glucosePage.js';
import { insulinPage } from './health/insulinPage.js';
import { mealsPage } from './health/mealsPage.js';

/**
 * Idioma de las cadenas que construye el cliente, fijado antes de registrar nada.
 *
 * Sale del `lang` que el servidor ya emite en el `<html>` a partir de `app()->getLocale()`: no hay
 * metadato nuevo ni petición nueva, y el idioma del texto que pinta JavaScript no puede separarse
 * del que pinta Blade. Se fija aquí y no dentro de `i18n/index.js` para no depender del orden en
 * que se evalúan los módulos: este fichero corre en la cabecera, antes de que exista ninguna
 * pantalla.
 *
 * `wire:navigate` no vuelve a evaluar los módulos ya cargados (ADR 0003), pero tampoco cambia el
 * idioma: cambiarlo en el perfil recarga la página entera.
 */
setLocale(document.documentElement.getAttribute('lang') ?? '');

/**
 * Componentes que las plantillas nombran en `x-data`.
 *
 * Toda pantalla nueva tiene que aparecer aquí. Si falta, Alpine no encuentra el componente que
 * declara su `x-data` y la pantalla se queda inerte: se pinta, pero ningún botón responde y no hay
 * error visible en la interfaz. Es un fallo silencioso, así que conviene comprobarlo al añadir una
 * pantalla y no cuando alguien informa de que algo no funciona.
 */
const COMPONENTS = Object.freeze({
    phrLoginForm: loginForm,
    phrSetPasswordForm: setPasswordForm,
    phrRegisterForm: registerPage,
    phrGlucosePage: glucosePage,
    phrBloodPressurePage: bloodPressurePage,
    phrMealsPage: mealsPage,
    phrInsulinPage: insulinPage,
    phrDashboardPage: dashboardPage,
    phrProfilePage: profilePage,
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
 * Bloqueo de §8 y arranque de sesión de §6.2, ambos solo dentro del panel.
 *
 * Las pantallas de autenticación se marcan con `data-phr-page` y quedan fuera: ahí no hay sesión que
 * cerrar ni que recuperar, y las dos llamadas solo producirían un error o una redirección de sobra.
 * La comprobación no puede hacerse al evaluar este módulo, que corre en la cabecera con el `<body>`
 * todavía sin analizar, así que se repite en cada navegación: `livewire:navigated` se dispara
 * también en la carga inicial, y la SPA del panel cambia de pantalla sin volver a evaluar los
 * módulos.
 */
function armLockForCurrentPage() {
    if (document.querySelector('[data-phr-page]') !== null) {
        disarmInactivityLock();

        return;
    }

    armInactivityLock();
}

function runForCurrentPage() {
    armLockForCurrentPage();
    void bootstrapSession();
}

document.addEventListener('livewire:navigated', runForCurrentPage);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runForCurrentPage, { once: true });
} else {
    runForCurrentPage();
}

interceptLogout();

/**
 * Registro del service worker, que es lo único que le falta al navegador para ofrecer instalar la
 * aplicación en la pantalla de inicio.
 *
 * Ese worker no cachea nada a propósito: el porqué, largo y que conviene leer antes de tocarlo, está
 * en `public/sw.js`. Aquí basta con saber que registrarlo no cambia cómo viaja ninguna petición.
 *
 * Los fallos se ignoran en silencio y sin reintento. El registro no está disponible en contextos no
 * seguros ni en navegación privada de algunos navegadores, y en todos esos casos la aplicación
 * funciona igual: se pierde el icono en la pantalla de inicio, nada más. Avisar de eso sería ruido
 * sobre algo que la persona no puede arreglar.
 */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}
