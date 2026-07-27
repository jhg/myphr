/**
 * Master key recovery after a reload (Spec 0001 §6.2; ADR 0003).
 *
 * An F5, a 419 or a deploy mid-session lose the key from memory. That is not an error: it is a
 * normal and frequent state. The interface degrades to asking for authentication, never to a
 * broken screen.
 *
 * The two error codes lead to the same place, the login screen, but they mean different things:
 * `401` is the Laravel session dead, `410` is the secret destroyed by a lock or a sign-out
 * (§4.5).
 */

import { zeroize } from '../crypto/zeroize.js';
import { AuthRequestError, postJson } from './http.js';
import { isUnlocked, restoreFromSessionSecret, decodeSessionSecret } from './keyring.js';
import { loadSettings } from './settings.js';

/** Possible outcomes of a recovery attempt. */
export const RecoveryOutcome = Object.freeze({
    /** There already was a key in memory, or it was recovered. */
    Unlocked: 'unlocked',
    /** There is no way to recover it without the password: go to the login. */
    NeedsLogin: 'needs-login',
});

/** @returns {string|null} */
function metaContent(name) {
    return document.head?.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
}

/**
 * Tries to leave the master key in memory without asking for the password (§6.2).
 *
 * @param {string} userId Session user UUID, which is the associated data of the package.
 * @returns {Promise<string>} One of `RecoveryOutcome`.
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
        /** 401 and 410 lead to the same place; so does any other failure, guessing nothing. */
        if (failure instanceof AuthRequestError) {
            return RecoveryOutcome.NeedsLogin;
        }

        throw failure;
    }

    const sessionSecret = decodeSessionSecret(payload.sessionSecret);
    let restored;

    try {
        restored = restoreFromSessionSecret(sessionSecret, userId);
    } finally {
        zeroize(sessionSecret);
    }

    if (!restored) {
        return RecoveryOutcome.NeedsLogin;
    }

    /** §6.2, step 4: the decrypted settings, now with the master key in memory. */
    loadSettings({ envelope: payload.encryptedSettings, userId });

    return RecoveryOutcome.Unlocked;
}

/**
 * Sends to the login screen with a hard reload (§8).
 *
 * Landing on the login with the key still in memory is one of the three exits that require
 * destroying the JavaScript context, because only that kills the DOM snapshots Livewire keeps
 * with decrypted data.
 */
export function goToLogin() {
    const url = metaContent('phr-login-url');

    if (url !== null) {
        window.location.href = url;
    }
}
