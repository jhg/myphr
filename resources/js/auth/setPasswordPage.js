/**
 * Alpine component of the set-password link page (Spec 0001 §5).
 *
 * It walks the twenty steps of §5 in that exact order. The ones that matter most, and why:
 *
 * * The token is read from the URL **fragment** (`#<token>`), which the browser never sends to
 *   the server: it only travels inside the body of `registration/start` (§4.1).
 * * The pinning of the profile and the public key happens **before** `finishRegistration` (step
 *   5): at registration there is no `server_mac` yet and nothing else authenticates the server.
 * * The master key is born in step 8, after Argon2id, and it is random: never derived from the
 *   password.
 * * Step 12 is **one single transactional request**. Splitting it would leave accounts that
 *   authenticate with no usable key and with the link already consumed, the worst failure mode of the design.
 * * Steps 13 to 20 are a full OPAQUE login with the same password, identical to §6.1: they cost
 *   one extra Argon2id and they surface here, while there is still no data to lose, any KSF or
 *   server identity mismatch.
 *
 * The password stays in memory until step 17 on purpose: wiping it earlier would make the login
 * of step 13 impossible, with the link already consumed and no second chance.
 */

import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { open, seal } from '../crypto/envelope.js';
import { zeroize } from '../crypto/zeroize.js';
import { t } from '../i18n/index.js';
import { envelopeContext, ENVELOPE_PURPOSES } from './context.js';
import { AuthRequestError, postJson, updateCsrfToken } from './http.js';
import {
    createMasterKey,
    decodeSessionSecret,
    forget,
    persistUnderSessionSecret,
    withMasterKey,
} from './keyring.js';
import {
    assertPinned,
    finishLogin,
    finishRegistration,
    OpaqueConfigurationError,
    opaqueParameters,
    opaqueReady,
    startLogin,
    startRegistration,
} from './opaqueClient.js';
import { navigate } from './navigate.js';
import { KEY_STRETCHING_SECONDS, progressMixin } from './progress.js';
import { forgetSettings, loadSettings } from './settings.js';

/** Empty initial configuration (§3.1): nobody is distinguishable by having it or not. */
const EMPTY_SETTINGS = '{"v":1}';

/**
 * Alpine component factory. Registered as `phrSetPasswordForm`.
 *
 * @returns {object}
 */
export function setPasswordForm() {
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

            /** §5, step 2: the passwords leave the DOM and the fields are emptied at once. */
            let password = this.$refs.password.value;
            const confirmation = this.$refs.passwordConfirmation.value;

            this.$refs.password.value = '';
            this.$refs.passwordConfirmation.value = '';

            try {
                if (password !== confirmation) {
                    this.error = t('setPassword.error.mismatch');

                    return;
                }

                await this.run(form, login, password);
            } catch (failure) {
                forget();
                forgetSettings();
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
            await this.advance(t('stage.preparing'), 0.05);

            /** §5, step 1. */
            await opaqueReady();

            const pinned = opaqueParameters();
            const registrationToken = window.location.hash.replace(/^#/, '');

            if (registrationToken === '') {
                throw new AuthRequestError('The link carries no token.', 422, 'invalid_registration');
            }

            /** §5, step 3: without `keyStretching`. */
            const { clientRegistrationState, registrationRequest } = await startRegistration(password);

            await this.advance(t('setPassword.stage.contacting'), 0.1);

            /** §5, step 4. */
            const started = await postJson(form.dataset.registrationStartUrl, {
                registrationRequest,
                registrationToken,
            });

            /** §5, step 5: before deriving anything. */
            assertPinned(started, pinned);

            /**
             * The bar starts first and we wait for the browser to paint it: from the next line on,
             * the main thread is blocked and paints nothing else.
             */
            await this.advance(t('setPassword.stage.stretching'), 0.4, KEY_STRETCHING_SECONDS);

            /** §5, step 6: Argon2id runs here. */
            const registered = await finishRegistration({
                password,
                clientRegistrationState,
                registrationResponse: started.registrationResponse,
                serverIdentity: pinned.serverIdentity,
            });

            await this.advance(t('setPassword.stage.wrapping'), 0.45);

            const userId = started.userId;
            const umkContext = envelopeContext(userId, ENVELOPE_PURPOSES.UserMasterKey);
            const settingsContext = envelopeContext(userId, ENVELOPE_PURPOSES.Settings);

            /** §5, steps 7 to 11. */
            const kek = deriveKey({ ikm: registered.exportKey, label: KDF_LABELS.KEK });
            let wrappedUserMasterKey;
            let encryptedSettings;

            try {
                createMasterKey(userId);

                wrappedUserMasterKey = withMasterKey((key) => seal({
                    key: kek,
                    plaintext: key,
                    associatedData: umkContext,
                }));

                encryptedSettings = withMasterKey((key) => {
                    const settingsKey = deriveKey({
                        ikm: key,
                        label: KDF_LABELS.SETTINGS,
                        context: settingsContext,
                    });

                    try {
                        return seal({
                            key: settingsKey,
                            plaintext: EMPTY_SETTINGS,
                            associatedData: settingsContext,
                        });
                    } finally {
                        zeroize(settingsKey);
                    }
                });
            } finally {
                zeroize(kek);
            }

            await this.advance(t('stage.saving'), 0.5);

            /** §5, step 12: one single transactional request. */
            await postJson(form.dataset.registrationFinishUrl, {
                registrationId: started.registrationId,
                registrationRecord: registered.registrationRecord,
                wrappedUserMasterKey,
                encryptedSettings,
            });

            /** §5, steps 13 and 14: the same login every future day will do. */
            const { clientLoginState, startLoginRequest } = await startLogin(password);

            const loginStarted = await postJson(form.dataset.loginStartUrl, {
                login,
                startLoginRequest,
            });

            assertPinned(loginStarted, pinned);

            /** Second Argon2id, the one of the immediate login of step 13. */
            await this.advance(t('setPassword.stage.verifying'), 0.9, KEY_STRETCHING_SECONDS);

            const loginFinished = await finishLogin({
                password,
                clientLoginState,
                loginResponse: loginStarted.loginResponse,
                serverIdentity: pinned.serverIdentity,
            });

            if (loginFinished === undefined) {
                throw new OpaqueConfigurationError(
                    'The password just set does not open the record that was just written.'
                );
            }

            await this.advance(t('stage.entering'), 0.95);

            const session = await postJson(form.dataset.loginFinishUrl, {
                handshakeId: loginStarted.handshakeId,
                finishLoginRequest: loginFinished.finishLoginRequest,
            });

            /** §5, steps 15 and 16: the key the server returns has to be the one that was born. */
            assertRoundTrip(loginFinished.exportKey, session.encryptedUserMasterKey, umkContext);

            /**
             * Settings sealed in step 11, with the master key already verified. The local envelope
             * is reused: it is the same one just written in step 12, and it avoids depending on
             * `login/finish` repeating it in its response.
             */
            loadSettings({ envelope: encryptedSettings, userId });

            /** §5, step 18. */
            const sessionSecret = decodeSessionSecret(session.sessionSecret);

            try {
                persistUnderSessionSecret(sessionSecret);
            } finally {
                zeroize(sessionSecret);
            }

            /** §5, step 19. */
            updateCsrfToken(session.csrf);

            await this.advance(t('stage.entering'), 1);

            /** §5, step 20. */
            navigate(session.redirect);
        },
    };
}

/**
 * §5, steps 15 and 16: reopens the envelope the server returned and compares it with the key in memory.
 *
 * This is the sign-up verification. If it does not match, the account has just been left with a
 * key nobody can recover, and it is better to know now, with no data yet, than at the first real login.
 *
 * @param {string} exportKey
 * @param {string} envelope
 * @param {string} context
 */
function assertRoundTrip(exportKey, envelope, context) {
    const kek = deriveKey({ ikm: exportKey, label: KDF_LABELS.KEK });
    let recovered = null;

    try {
        recovered = open({ key: kek, envelope, associatedData: context });

        const matches = withMasterKey((key) => constantTimeEquals(key, recovered));

        if (!matches) {
            throw new OpaqueConfigurationError('The recovered master key differs from the one created.');
        }
    } finally {
        zeroize(kek);

        if (recovered !== null) {
            zeroize(recovered);
        }
    }
}

/**
 * Constant-time comparison of two buffers.
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
function constantTimeEquals(a, b) {
    if (a.length !== b.length) {
        return false;
    }

    let difference = 0;

    for (let index = 0; index < a.length; index += 1) {
        difference |= a[index] ^ b[index];
    }

    return difference === 0;
}

/**
 * @param {unknown} failure
 * @returns {string}
 */
function describe(failure) {
    if (failure instanceof AuthRequestError) {
        return failure.status === null ? t('common.network') : t('setPassword.error.link');
    }

    if (failure?.name === 'OpaqueConfigurationError') {
        return t('common.configuration');
    }

    return t('setPassword.error.verification');
}
