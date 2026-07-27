/**
 * Alpine component of the login form (Spec 0001 §6.1).
 *
 * The password is read from the DOM node and the `<input>` is emptied in step 2, before any state
 * that could retain it exists. There is no `wire:model` anywhere on this path: nothing typed here
 * enters the Livewire `snapshot` (ADR 0002).
 *
 * This module does the navigation to the panel with the `redirect` that `login/finish` returns, so
 * there is no need to touch the Filament `LoginResponse`.
 */

import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { open } from '../crypto/envelope.js';
import { zeroize } from '../crypto/zeroize.js';
import { t } from '../i18n/index.js';
import { envelopeContext, ENVELOPE_PURPOSES } from './context.js';
import { AuthRequestError, postJson, updateCsrfToken } from './http.js';
import {
    adoptMasterKey,
    decodeSessionSecret,
    persistUnderSessionSecret,
} from './keyring.js';
import {
    assertPinned,
    finishLogin,
    OpaqueConfigurationError,
    opaqueParameters,
    opaqueReady,
    startLogin,
} from './opaqueClient.js';
import { navigate } from './navigate.js';
import { KEY_STRETCHING_SECONDS, progressMixin } from './progress.js';
import { loadSettings } from './settings.js';

/**
 * Alpine component factory. Registered as `phrLoginForm`.
 *
 * @returns {object}
 */
export function loginForm() {
    return {
        ...progressMixin(),

        busy: false,
        error: '',

        /** @param {SubmitEvent} event */
        async submit(event) {
            if (this.busy) {
                return;
            }

            this.busy = true;
            this.error = '';
            this.resetProgress();

            const form = event.target;
            const login = this.$refs.login.value.trim();

            /** §6.1, step 2: the password leaves the DOM and the field is emptied at once. */
            let password = this.$refs.password.value;
            this.$refs.password.value = '';

            try {
                await this.run(form, login, password);
            } catch (failure) {
                this.error = describe(failure);
                this.resetProgress();
            } finally {
                password = '';
                this.busy = false;
            }
        },

        /**
         * @param {HTMLFormElement} form
         * @param {string} login
         * @param {string} password
         */
        async run(form, login, password) {
            await this.advance(t('stage.preparing'), 0.1);

            await opaqueReady();

            const pinned = opaqueParameters();

            const { clientLoginState, startLoginRequest } = startLogin(password);

            await this.advance(t('login.stage.contacting'), 0.25);

            const started = await postJson(form.dataset.loginStartUrl, {
                login,
                startLoginRequest,
            });

            assertPinned(started, pinned);

            /**
             * The bar starts **before** the call, and we wait for the browser to paint it:
             * `finishLogin` runs Argon2id synchronously and from here on the main thread paints
             * nothing else until it finishes.
             */
            await this.advance(t('login.stage.stretching'), 0.85, KEY_STRETCHING_SECONDS);

            const finished = finishLogin({
                password,
                clientLoginState,
                loginResponse: started.loginResponse,
                serverIdentity: pinned.serverIdentity,
            });

            /** §6.1, step 5: `undefined` means "the password does not match", not a technical error. */
            if (finished === undefined) {
                throw new AuthRequestError('Login failed.', null, 'authentication_failed');
            }

            await this.advance(t('stage.entering'), 0.95);

            const session = await postJson(form.dataset.loginFinishUrl, {
                handshakeId: started.handshakeId,
                finishLoginRequest: finished.finishLoginRequest,
            });

            unwrapMasterKey(finished.exportKey, session);

            /** §6.1, step 10: the encrypted settings, now with the master key in memory. */
            loadSettings({ envelope: session.encryptedSettings, userId: session.userId });

            /** §6.1, step 9: the recovery package, now with a session created and the key verified. */
            const sessionSecret = decodeSessionSecret(session.sessionSecret);

            try {
                persistUnderSessionSecret(sessionSecret);
            } finally {
                zeroize(sessionSecret);
            }

            /** §6.1, step 10: the new CSRF before navigating, or the next POST gives 419. */
            updateCsrfToken(session.csrf);

            await this.advance(t('stage.entering'), 1);

            navigate(session.redirect);
        },
    };
}

/**
 * §6.1, step 7: KEK from the `exportKey` and opening of the current master key envelope.
 *
 * A failure here is visible: the record is never hidden and nothing degrades in silence (ADR 0004).
 *
 * @param {string} exportKey
 * @param {{userId?: string, encryptedUserMasterKey: string}} session
 */
function unwrapMasterKey(exportKey, session) {
    const userId = session.userId;

    /**
     * The associated data of the envelope carries the user identifier (§5, step 9), so without it
     * the envelope does not open. Today `login/finish` does not return it: §4.4 does not list it
     * among its fields, although §4.1 does return it at registration for this very reason. It is a
     * gap in the contract, not a runtime case, and that is why it fails loudly instead of guessing.
     */
    if (typeof userId !== 'string' || userId === '') {
        throw new OpaqueConfigurationError('login/finish did not return the user identifier.');
    }

    const kek = deriveKey({ ikm: exportKey, label: KDF_LABELS.KEK });
    let masterKey = null;

    try {
        masterKey = open({
            key: kek,
            envelope: session.encryptedUserMasterKey,
            associatedData: envelopeContext(userId, ENVELOPE_PURPOSES.UserMasterKey),
        });

        adoptMasterKey(masterKey, userId);
    } finally {
        zeroize(kek);

        if (masterKey !== null) {
            zeroize(masterKey);
        }
    }
}

/**
 * Translates a failure into the one message that fits.
 *
 * @param {unknown} failure
 * @returns {string}
 */
function describe(failure) {
    if (failure instanceof AuthRequestError) {
        return failure.status === null ? t('common.network') : t('login.error.credentials');
    }

    if (failure?.name === 'OpaqueConfigurationError') {
        return t('common.configuration');
    }

    return t('login.error.credentials');
}
