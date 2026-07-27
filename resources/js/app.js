/**
 * Vite entry point of the panel (Spec 0001 §10).
 *
 * It is emitted in the panel `<head>`. Three jobs: register the Alpine components of the
 * authentication screens, install the §9 interceptor and arm the §8 idle lock. Everything that
 * touches keys lives in the modules it imports, with the master key locked inside the scope of
 * `auth/keyring.js`.
 *
 * `auth/keyring.js` is imported **first**, and for its module effect, not for what it exports: it
 * is that module's scope that holds the master key for the whole life of the tab. Loaded from the
 * document head, it survives `wire:navigate`, which replaces the `<body>` but does not re-evaluate
 * modules already loaded (ADR 0003). That is the entire mechanism by which the key does not die
 * when the screen changes.
 *
 * The registration hangs off `alpine:init` because Alpine comes with Livewire and starts later.
 * The alternative branch covers the case where this module arrives late, with Alpine already running.
 */

import './auth/keyring.js';

import { setLocale, textDirection } from './i18n/index.js';
import { armInactivityLock, disarmInactivityLock, interceptLogout } from './auth/lock.js';
import { loginForm } from './auth/loginPage.js';
import { profilePage } from './auth/profilePage.js';
import { registerPage } from './auth/registerPage.js';
import { setPasswordForm } from './auth/setPasswordPage.js';
import { bootstrapSession } from './auth/sessionBootstrap.js';
import { installLivewirePayloadGuard } from './guards/livewirePayloadGuard.js';
import { installStaleTabNotice } from './guards/staleTabNotice.js';
import { bloodPressurePage } from './health/bloodPressurePage.js';
import { bodyWeightPage } from './health/bodyWeightPage.js';
import { dashboardPage } from './health/dashboardPage.js';
import { glucosePage } from './health/glucosePage.js';
import { insulinPage } from './health/insulinPage.js';
import { mealsPage } from './health/mealsPage.js';
import { sharePage } from './health/sharePage.js';
import { temperaturePage } from './health/temperaturePage.js';
import { captureInstallPrompt, installButton } from './pwa/installPrompt.js';

/**
 * Language of the strings the client builds.
 *
 * It comes from what the server already emits out of `app()->getLocale()`: no new request, and the
 * text JavaScript paints cannot drift apart from the one Blade paints.
 *
 * It is re-read **on every navigation**, and not once on load, because the server language can
 * change without the tab reloading. The normal case is signing in: the sign-in screen has no
 * session and is served in the `Accept-Language` language, and as soon as there is a session the
 * one saved in the account takes over. With a single read, that first language stayed frozen and
 * the person saw the panel in Chinese with the chart labels in Spanish.
 *
 * The source is a marker on the `<body>` and not the `lang` of the `<html>`: Livewire navigation
 * replaces the former and not the attributes of the latter. `lang` is updated here by hand so that
 * screen readers and `Intl` do not keep the one from the first load.
 */
function syncLocale() {
    const marker = document.querySelector('[data-phr-locale]');
    const active = setLocale(marker?.dataset.phrLocale ?? document.documentElement.lang ?? '');
    const tag = active.replace('_', '-');

    if (document.documentElement.lang !== tag) {
        document.documentElement.lang = tag;
    }

    document.documentElement.dir = textDirection(active);
}

syncLocale();

/**
 * Components the templates name in `x-data`.
 *
 * Every new screen has to appear here. If it is missing, Alpine does not find the component its
 * `x-data` declares and the screen stays inert: it paints, but no button responds and there is no
 * visible error in the interface. It is a silent failure, so it is worth checking when adding a
 * screen and not when somebody reports that something does not work.
 */
const COMPONENTS = Object.freeze({
    phrLoginForm: loginForm,
    phrSetPasswordForm: setPasswordForm,
    phrRegisterForm: registerPage,
    phrGlucosePage: glucosePage,
    phrBloodPressurePage: bloodPressurePage,
    phrMealsPage: mealsPage,
    phrInsulinPage: insulinPage,
    phrBodyWeightPage: bodyWeightPage,
    phrTemperaturePage: temperaturePage,
    phrDashboardPage: dashboardPage,
    phrProfilePage: profilePage,
    phrSharePage: sharePage,
    phrInstallButton: installButton,
});

/**
 * `beforeinstallprompt` listener, hooked when the module is evaluated and not when the button mounts.
 *
 * The browser fires that event when it feels like it, without repeating it, and often before
 * Alpine has mounted anything: whoever arrives late loses the only object able to open the install
 * dialog. That is why it lives in the module scope, which also survives SPA navigation while the
 * component is rebuilt on every screen. The why of the two branches —Chromium with an event, iOS
 * without it— is in `pwa/installPrompt.js`.
 */
captureInstallPrompt(window);

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
 * §9 interceptor. `livewire:init` is the moment `window.Livewire` exists and no message has gone
 * out yet.
 *
 * The stale-tab notice rides on the same event and the same hook: it has to be in place before the
 * first message goes out, because the message it exists for can be the first one.
 */
document.addEventListener('livewire:init', () => {
    installLivewirePayloadGuard();
    installStaleTabNotice();
}, { once: true });

/**
 * §8 lock and §6.2 session bootstrap, both only inside the panel.
 *
 * The authentication screens are marked with `data-phr-page` and stay out: there is no session to
 * close or to recover there, and the two calls would only produce an error or a needless redirect.
 * The check cannot be done when this module is evaluated, which runs in the head with the `<body>`
 * still unparsed, so it is repeated on every navigation: `livewire:navigated` also fires on the
 * initial load, and the panel SPA changes screen without re-evaluating the modules.
 */
function armLockForCurrentPage() {
    if (document.querySelector('[data-phr-page]') !== null) {
        disarmInactivityLock();

        return;
    }

    armInactivityLock();
}

function runForCurrentPage() {
    syncLocale();
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
 * Service worker registration, which is the only thing the browser is missing before it offers to
 * install the application on the home screen.
 *
 * That worker caches nothing on purpose: the why, long and worth reading before touching it, is in
 * `public/sw.js`. Here it is enough to know that registering it changes how no request travels.
 *
 * Failures are ignored silently and without retry. Registration is not available in insecure
 * contexts nor in private browsing on some browsers, and in all those cases the application works
 * the same: the home screen icon is lost, nothing else. Reporting that would be noise about
 * something the person cannot fix.
 */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}
