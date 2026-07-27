/**
 * Owner of the master key in memory (Spec 0001 §10; ADR 0003).
 *
 * The key lives in the scope of this ES module and **never leaves it**: there is no getter that
 * returns it. Whoever needs to encrypt or decrypt passes a function to `withMasterKey`, which
 * borrows it for the duration of the call. That way no reference is left dangling in the state of
 * an Alpine component or in a Livewire property.
 *
 * Since the scope is per tab, two tabs share nothing: each one does its own login or recovery.
 * Losing the key is a normal and frequent state, not an error (§7).
 *
 * The `sessionStorage` package is sealed and opened from here too, for the same reason: if
 * another module did it, the key would have to leave to reach it.
 */

import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { open, seal } from '../crypto/envelope.js';
import { decodeBase64Url } from '../crypto/base64url.js';
import { zeroize } from '../crypto/zeroize.js';

/** `sessionStorage` key where the master key lives wrapped under the session secret. */
export const RECOVERY_STORAGE_KEY = 'phr.rk';

/** Master key length, in bytes. */
export const MASTER_KEY_LENGTH = 32;

/** @type {Uint8Array|null} */
let masterKey = null;

/** @type {string|null} */
let masterKeyOwnerId = null;

/** Is there a master key in memory in this tab? */
export function isUnlocked() {
    return masterKey !== null;
}

/** UUID of the user owning the key in memory, or `null`. Metadata, not key material. */
export function ownerId() {
    return masterKeyOwnerId;
}

/**
 * Generates the master key (§5, step 8): 32 bytes from the CSPRNG, **never** derived from the password.
 *
 * @param {string} userId
 */
export function createMasterKey(userId) {
    forget();

    masterKey = crypto.getRandomValues(new Uint8Array(MASTER_KEY_LENGTH));
    masterKeyOwnerId = userId;
}

/**
 * Adopts an existing master key, just opened from an envelope.
 *
 * @param {Uint8Array} key
 * @param {string} userId
 */
export function adoptMasterKey(key, userId) {
    if (!(key instanceof Uint8Array) || key.length !== MASTER_KEY_LENGTH) {
        throw new TypeError(`The master key must be ${MASTER_KEY_LENGTH} bytes.`);
    }

    forget();

    masterKey = key.slice();
    masterKeyOwnerId = userId;
}

/**
 * Lends the master key for the duration of a call.
 *
 * The buffer the function receives is this module's own: it must not be stored or wiped from outside.
 *
 * @template T
 * @param {(key: Uint8Array) => T} work
 * @returns {T}
 * @throws {Error} If there is no key in memory. The caller degrades to asking for authentication (§6.2).
 */
export function withMasterKey(work) {
    if (masterKey === null) {
        throw new Error('There is no master key in memory.');
    }

    return work(masterKey);
}

/**
 * Wipes the key from memory. It is at most an attempt (ADR 0004).
 *
 * It does not wipe the decrypted settings of `settings.js` here: that module imports
 * `withMasterKey` from this file, so importing it back to call `forgetSettings()` would close an
 * ES module cycle. Instead, `forgetSettings()` is called separately in the two places that really
 * close a session (`lock.js` and the `catch` of `setPasswordPage.js`); the two internal uses of
 * `forget()` in this file (`createMasterKey`, `adoptMasterKey`) are key replacements inside one
 * sign-up flow, not sign-outs.
 */
export function forget() {
    if (masterKey !== null) {
        zeroize(masterKey);
    }

    masterKey = null;
    masterKeyOwnerId = null;
}

/**
 * Seals the master key under the session secret and writes it to `sessionStorage`
 * (§5, step 18 and §6.1, step 9).
 *
 * It is called **after** the server has minted the secret and after verifying the key, never
 * before: in the first case material would be left encrypted under a secret that does not exist,
 * and in the second a key would be persisted before we know the server returns it correctly.
 *
 * The session secret is wiped right here; the incoming `Uint8Array` belongs to the caller.
 *
 * @param {Uint8Array} sessionSecret 32 bytes, already decoded.
 */
export function persistUnderSessionSecret(sessionSecret) {
    const sessionKey = deriveKey({ ikm: sessionSecret, label: KDF_LABELS.SESSION });

    try {
        const packed = withMasterKey((key) => seal({
            key: sessionKey,
            plaintext: key,
            associatedData: masterKeyOwnerId ?? '',
        }));

        sessionStorage.setItem(RECOVERY_STORAGE_KEY, packed);
    } finally {
        zeroize(sessionKey);
    }
}

/**
 * Opens the `sessionStorage` package with the session secret and adopts the key (§6.2, step 3).
 *
 * @param {Uint8Array} sessionSecret
 * @param {string} userId
 * @returns {boolean} `false` if there was no stored package; in that case go to the login.
 * @throws {import('../crypto/envelope.js').EnvelopeError} If the package does not open. It is not
 *         silenced: a decryption failure is always a visible error (ADR 0004).
 */
export function restoreFromSessionSecret(sessionSecret, userId) {
    const packed = sessionStorage.getItem(RECOVERY_STORAGE_KEY);

    if (typeof packed !== 'string' || packed === '') {
        return false;
    }

    const sessionKey = deriveKey({ ikm: sessionSecret, label: KDF_LABELS.SESSION });
    let key = null;

    try {
        key = open({ key: sessionKey, envelope: packed, associatedData: userId });

        adoptMasterKey(key, userId);

        return true;
    } finally {
        zeroize(sessionKey);

        if (key !== null) {
            zeroize(key);
        }
    }
}

/**
 * Decodes the session secret that arrives in base64url.
 *
 * @param {string} sessionSecret
 * @returns {Uint8Array}
 */
export function decodeSessionSecret(sessionSecret) {
    return decodeBase64Url(sessionSecret, 'sessionSecret');
}
