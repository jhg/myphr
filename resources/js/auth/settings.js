/**
 * Encrypted user settings, decrypted in memory (Spec 0001 §6.1 step 10 and §6.2 step 4;
 * ADR 0007).
 *
 * Like the master key in `keyring.js`, the already decrypted settings live in the scope of this
 * ES module and not in the state of an Alpine component or in a Livewire property: that way they
 * do not end up in a DOM snapshot Livewire keeps with data in the clear.
 *
 * An account may not have a settings envelope yet, and that is not an error (`loadSettings`
 * treats it as "nothing to load"). An envelope that does exist but does not open is another
 * matter: an `EnvelopeError` that is not silenced here, just like `keyring.restoreFromSessionSecret`
 * (ADR 0004). The caller decides how to degrade.
 *
 * `saveSettings` is the write path (ADR 0007): it seals with the SAME derivation and the SAME
 * associated data as the read path —hence `withSettingsKey`, which shares them— and sends the
 * envelope to `PUT /phr/settings`. The server only validates the wrapper; the content never
 * leaves here in the clear.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { openText, sealText } from '../crypto/envelope.js';
import { zeroize } from '../crypto/zeroize.js';
import { envelopeContext, ENVELOPE_PURPOSES } from './context.js';
import { putJson } from './http.js';
import { withMasterKey } from './keyring.js';

/** DOM event with which already mounted screens recompute without reloading. */
export const SETTINGS_UPDATED_EVENT = 'phr:settings-updated';

/** @type {object|null} */
let decryptedSettings = null;

/**
 * `v1.` envelope the client believes is current on the server, for the `If-Match` precondition.
 *
 * @type {string|null}
 */
let currentEnvelope = null;

const TEXT_ENCODER = new TextEncoder();

/**
 * Derives the settings envelope key and runs `use` with it.
 *
 * It exists so that sealing and opening share **one single** construction of context and
 * derivation: duplicating them and letting them diverge by one byte leaves the settings unopenable
 * forever, because nothing can be re-encrypted from the server.
 *
 * @template T
 * @param {string} userId
 * @param {(key: Uint8Array, settingsContext: string) => T} use
 * @returns {T}
 */
function withSettingsKey(userId, use) {
    const settingsContext = envelopeContext(userId, ENVELOPE_PURPOSES.Settings);

    return withMasterKey((masterKey) => {
        const settingsKey = deriveKey({
            ikm: masterKey,
            label: KDF_LABELS.SETTINGS,
            context: settingsContext,
        });

        try {
            return use(settingsKey, settingsContext);
        } finally {
            zeroize(settingsKey);
        }
    });
}

/**
 * Decrypts the settings envelope and leaves it in memory (§6.1, step 10; §6.2, step 4).
 *
 * @param {object} params
 * @param {string|null|undefined} params.envelope `v1.` envelope from `encryptedSettings`. If it
 *        is not a non-empty string, the account has no settings yet: it does nothing.
 * @param {string} params.userId User UUID, associated data of the envelope.
 * @returns {object|null} Copy of the loaded settings, or `null` if there was no envelope.
 * @throws {import('../crypto/envelope.js').EnvelopeError} If the envelope does not open. It is
 *         not silenced (ADR 0004).
 */
export function loadSettings({ envelope, userId }) {
    if (typeof envelope !== 'string' || envelope === '') {
        return null;
    }

    const plaintext = withSettingsKey(userId, (settingsKey, settingsContext) =>
        openText({ key: settingsKey, envelope, associatedData: settingsContext })
    );

    decryptedSettings = JSON.parse(plaintext);
    currentEnvelope = envelope;

    return settings();
}

/**
 * Seals the settings and stores them (`PUT /phr/settings`, ADR 0007).
 *
 * The merge happens on the client because it is the only one that can do it: the server cannot
 * patch a document it cannot decrypt. A patch key with value `undefined` or `null` **deletes**
 * that setting, which is the "not configured" representation of ADR 0007: an empty marker is
 * never written. `v` is not patchable.
 *
 * Memory and the current envelope are updated only **after** a 2xx: the screen cannot show a
 * setting the server does not have.
 *
 * @param {object} params
 * @param {object} params.patch Settings to set or to delete.
 * @param {string} params.userId User UUID, associated data of the envelope.
 * @param {string} [params.locale] Application language. It is the only field that travels
 *        **outside** the envelope, in the clear (ADR 0007): the server has to resolve it to paint
 *        the panel and the sign-in screen, which exists before any key. It takes no part in the
 *        `If-Match`, which protects the envelope. It is left out of the body when not passed, so
 *        that screens which do not touch it never rewrite it.
 * @param {string} params.url Target of `PUT /phr/settings`.
 * @returns {Promise<object>} Copy of the settings as stored.
 * @throws {import('./http.js').AuthRequestError} Network failure or non-2xx response; among them
 *         412 `settings_conflict`, which means another tab saved first and the settings must be
 *         reloaded, the change reapplied and the request retried once.
 */
export async function saveSettings({ patch, userId, locale, url }) {
    const merged = { ...(decryptedSettings ?? {}), v: 1 };

    for (const [key, value] of Object.entries(patch ?? {})) {
        if (key === 'v') {
            continue;
        }

        if (value === undefined || value === null) {
            delete merged[key];
        } else {
            merged[key] = value;
        }
    }

    const envelope = withSettingsKey(userId, (settingsKey, settingsContext) =>
        sealText({
            key: settingsKey,
            plaintext: JSON.stringify(merged),
            associatedData: settingsContext,
        })
    );

    const body = { encryptedSettings: envelope };

    if (typeof locale === 'string' && locale !== '') {
        body.locale = locale;
    }

    await putJson(url, body, { 'If-Match': ifMatchTag() });

    decryptedSettings = merged;
    currentEnvelope = envelope;

    globalThis.document?.dispatchEvent?.(new CustomEvent(SETTINGS_UPDATED_EVENT));

    return settings();
}

/**
 * Precondition of the `PUT`: sha256 of the envelope the client believes current, or `*` when the
 * account has none yet.
 *
 * @returns {string}
 */
function ifMatchTag() {
    return currentEnvelope === null
        ? '*'
        : `"${bytesToHex(sha256(TEXT_ENCODER.encode(currentEnvelope)))}"`;
}

/** @returns {object|null} Copy of the loaded settings, or `null` if there is none in memory. */
export function settings() {
    return decryptedSettings === null ? null : { ...decryptedSettings };
}

/** @returns {boolean} */
export function hasSettings() {
    return decryptedSettings !== null;
}

/** Wipes the settings from memory, and with them the current envelope backing the precondition. */
export function forgetSettings() {
    decryptedSettings = null;
    currentEnvelope = null;
}
