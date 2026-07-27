/**
 * Idle lock (Spec 0001 §8; ADR 0003 and 0009).
 *
 * Fifteen minutes without activity and the session closes **entirely**: the session secret and
 * the Laravel session die in the same server operation, and the browser does a hard reload. It is
 * not an overlay screen: a layer on top of the panel leaves alive the JavaScript context, the
 * master key in memory and the DOM snapshots Livewire keeps with decrypted data, so removing a
 * `display: none` from the console would bring the whole panel back with data in the clear.
 *
 * **The server is the one counting the time**, over the last authenticated request, in the
 * `App\Http\Middleware\EnforceIdleTimeout` middleware. This timer does not decide the expiry: it
 * does not run in a tab the operating system dropped for memory, nor in one that was never opened.
 * All it does is warn and fire the call.
 *
 * The order of the sign-out is normative (§4.6): the hard reload comes **after** the server
 * confirms. Reloading first would leave, on a network loss, the secret alive on the server and
 * the client without a key in memory, which is a lock that locked nothing server-side. The key is
 * forgotten right away: that does not depend on the network and has no downside.
 *
 * `sessionStorage['phr.rk']` is not cleared: once the secret dies it stays encrypted under
 * something that no longer exists anywhere (§8).
 */

import { postJson } from './http.js';
import { forget } from './keyring.js';
import { hardReload } from './navigate.js';
import { forgetSettings } from './settings.js';

/** Idle time tolerated before the sign-out (ADR 0009). */
export const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;

/** How long before the sign-out the warning is given. */
export const WARNING_BEFORE_MS = 60 * 1000;

/** Wait before retrying the sign-out call when the network fails. */
const RETRY_DELAY_MS = 5 * 1000;

/** Event emitted when `WARNING_BEFORE_MS` are left before the sign-out. */
export const LOCK_WARNING_EVENT = 'phr:lock-warning';

/** Event emitted when the sign-out starts, already without a key in memory. */
export const LOCK_EVENT = 'phr:locked';

/**
 * Activity that resets the countdown. Only deliberate gestures: `mousemove` would reset it with
 * the mouse brushed by a sleeve, which is exactly the unattended desk this covers.
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

/** Restarts the countdown. Called on every gesture and on every Livewire navigation. */
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
 * Closes the session completely and reloads.
 *
 * It is also the path of the normal sign-out: the Filament `POST /logout` knows nothing about the
 * session secret, so leaving through it would keep the secret alive (§8).
 *
 * @returns {Promise<void>}
 */
export async function lock() {
    if (locking) {
        return;
    }

    locking = true;
    clearTimers();

    /** The key is forgotten right away: it does not depend on the network. Settings go with it. */
    forget();
    forgetSettings();

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
         * Without confirmation there is no reload (§4.6). It retries instead of giving up: the tab
         * stays open, without a key in memory, and the server session stays alive until the call
         * gets through.
         */
        locking = false;
        setTimeout(() => { void lock(); }, RETRY_DELAY_MS);

        return;
    }

    hardReload(loginUrl);
}

/**
 * Starts the timer. Idempotent: calling it on every Livewire navigation does not stack
 * listeners.
 *
 * @returns {boolean} `false` if the page does not publish the needed URLs, and then there is
 *          nothing to arm.
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
 * Stops the timer and releases the listeners. The authentication screens do not want it armed:
 * there is no session to close there and the call would only produce an error.
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
 * Diverts the Filament `POST /logout` through the destruction path of §8.
 *
 * Interpretation of this implementation, flagged in the report: the spec requires the normal
 * sign-out to go through the same path, but it does not say whether that is solved on the client
 * or on the server. If the form marker changed, the `submit` would run its course and the
 * sign-out would be Filament's again, which is the starting behaviour and not a new security regression.
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
