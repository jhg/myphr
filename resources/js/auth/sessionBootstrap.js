/**
 * Panel session bootstrap (Spec 0001 §6.2; ADR 0003).
 *
 * Every panel screen that is going to ask for encrypted data calls `bootstrapSession()` first. It
 * decides, in this order, whether there already is a master key in memory, whether it can be
 * recovered without asking for the password, or whether it has to go to the login. Losing the key
 * is a normal and frequent state, not an error (§7): this function never leaves a broken screen,
 * not even on an unexpected failure.
 * Contract with the screens: when the session becomes unlocked, the `phr:session-ready` event
 * is emitted on `document` (with no `detail`). An encrypted screen that needs to wait for a key
 * before asking for its first batch of data must listen for that event; if a key already exists
 * on mount (`isUnlocked()` true), the event may have been emitted before the listener existed,
 * so it is best to check `isUnlocked()` first and only wait for the event if it is still false.
 */

import { isUnlocked } from './keyring.js';
import { goToLogin, recoverMasterKey, RecoveryOutcome } from './recovery.js';

/** Event emitted on `document` when the session becomes unlocked. */
export const SESSION_READY_EVENT = 'phr:session-ready';

/** @returns {string|null} */
function metaContent(name) {
    return document.head?.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
}

/** Notifies the screens waiting on this module's contract. */
function announceReady() {
    document.dispatchEvent(new CustomEvent(SESSION_READY_EVENT));
}

/**
 * Bootstrap already under way, so a second call joins it instead of starting another one.
 *
 * On an F5 inside the panel, `app.js` calls this twice: once through the `readyState` branch and
 * once through `livewire:navigated`, which also fires on the initial load. Without this guard both
 * calls found no key in memory and both fired `POST /phr/auth/session-secret`. That second request
 * is not free: with `SESSION_DRIVER=database` the two serialise on the session lock, so it is a
 * full extra round trip on the slowest path of a reload.
 *
 * It is cleared when the recovery settles, so a later navigation with the key already lost —an
 * expired session, a closed tab— still gets a fresh attempt.
 *
 * @type {Promise<void>|null}
 */
let inFlight = null;

/**
 * Leaves the master key ready in memory or sends to the login. It does not throw: any unexpected
 * failure also ends at the login, never on a broken screen (ADR 0003).
 *
 * @returns {Promise<void>}
 */
export function bootstrapSession() {
    inFlight ??= run().finally(() => {
        inFlight = null;
    });

    return inFlight;
}

/**
 * The bootstrap itself. Always reached through {@see bootstrapSession}, never directly.
 *
 * @returns {Promise<void>}
 */
async function run() {
    /** The authentication screens (login, set-password) have no session to bootstrap. */
    if (document.querySelector('[data-phr-page]') !== null) {
        return;
    }

    const userId = metaContent('phr-user-id');

    /** Without the panel meta tag there is no session to recover. */
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
