/**
 * Alpine component of the public sign-up screen, with no invitation (Spec 0001 §4.1 and §5, with
 * the `POST /phr/auth/opaque/registration/public/start` variant).
 *
 * It is the same sequence as `setPasswordPage.js`, with only two differences:
 *
 * * There is no token in the URL fragment: whoever lands here has no invitation, so the name and
 *   the login are typed by the person and travel in the body of `registration/public/start`
 *   together with `registrationRequest` (`RegistrationPublicStartController`).
 * * The server may answer 409 `login_taken` when the email already has an account. It is an
 *   explicit server decision (`RegistrationPublicStartController`, comment next to the class),
 *   and here it is translated into an actionable message, not a generic error: the template
 *   offers a link to sign in when `loginTaken` is true.
 *
 * The rest —birth of the master key, sealing of the envelopes, the single transactional request
 * of `registration/finish` and the immediate OPAQUE login with the same password— is identical to
 * §5 and is not reimplemented: same `opaqueClient.js`, `keyring.js`, `context.js`, `settings.js` modules.
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
 * Compares the two passwords of the form. A pure function, with no Alpine state, so it can be
 * tested without mounting any DOM.
 *
 * @param {string} password
 * @param {string} confirmation
 * @returns {boolean}
 */
export function passwordsMatch(password, confirmation) {
    return password === confirmation;
}

/**
 * Translates a public sign-up failure into the message that fits.
 *
 * The 409 `login_taken` is a case of its own, not a variant of the generic one: whoever reads it
 * has to learn that an account with that email already exists and that there is a concrete action
 * to take (go and sign in), so `loginTaken` is returned as well, letting the template offer that
 * link instead of burying it in the error text.
 *
 * A pure function over the error itself: it reads neither `document` nor `window`, so it can be
 * tested by building the errors by hand.
 *
 * @param {unknown} failure
 * @returns {{message: string, loginTaken: boolean}}
 */
export function describeFailure(failure) {
    if (failure instanceof AuthRequestError) {
        if (failure.status === null) {
            return { message: t('common.network'), loginTaken: false };
        }

        if (failure.code === 'login_taken') {
            return { message: t('register.error.loginTaken'), loginTaken: true };
        }

        return { message: t('register.error.generic'), loginTaken: false };
    }

    if (failure?.name === 'OpaqueConfigurationError') {
        return { message: t('common.configuration'), loginTaken: false };
    }

    return { message: t('register.error.generic'), loginTaken: false };
}

/**
 * Alpine component factory. Registered as `phrRegisterForm`.
 *
 * @returns {object}
 */
export function registerPage() {
    return {
        ...progressMixin(),

        busy: false,
        error: '',

        /** Was the last error a 409 `login_taken`? The template then offers going to sign in. */
        loginTaken: false,

        /** @param {SubmitEvent} event */
        async submit(event) {
            if (this.busy) {
                return;
            }

            this.busy = true;
            this.error = '';
            this.loginTaken = false;
            this.resetProgress();

            const form = event.target;
            const name = this.$refs.name.value.trim();
            const login = this.$refs.login.value.trim();

            /** The password leaves the DOM and the fields are emptied at once (§5, step 2). */
            let password = this.$refs.password.value;
            const confirmation = this.$refs.passwordConfirmation.value;

            this.$refs.password.value = '';
            this.$refs.passwordConfirmation.value = '';

            try {
                if (!passwordsMatch(password, confirmation)) {
                    this.error = t('register.error.mismatch');

                    return;
                }

                await this.run(form, name, login, password);
            } catch (failure) {
                forget();
                forgetSettings();

                const described = describeFailure(failure);

                this.error = described.message;
                this.loginTaken = described.loginTaken;
                this.resetProgress();
            } finally {
                password = '';
                this.busy = false;
            }
        },

        /**
         * @param {HTMLFormElement} form
         * @param {string} name
         * @param {string} login
         * @param {string} password
         */
        async run(form, name, login, password) {
            await this.advance(t('stage.preparing'), 0.05);

            await opaqueReady();

            const pinned = opaqueParameters();

            /** Without `keyStretching` (§5, step 3). */
            const { clientRegistrationState, registrationRequest } = startRegistration(password);

            await this.advance(t('register.stage.contacting'), 0.1);

            const started = await postJson(form.dataset.registrationStartUrl, {
                name,
                login,
                registrationRequest,
            });

            /** Before deriving anything (§5, step 5): at sign-up there is no `server_mac` yet. */
            assertPinned(started, pinned);

            /**
             * The bar starts first and we wait for the browser to paint it: from the next line on,
             * the main thread is blocked and paints nothing else.
             */
            await this.advance(t('register.stage.stretching'), 0.4, KEY_STRETCHING_SECONDS);

            /** The first Argon2id runs here (§5, step 6). */
            const registered = finishRegistration({
                password,
                clientRegistrationState,
                registrationResponse: started.registrationResponse,
                serverIdentity: pinned.serverIdentity,
            });

            await this.advance(t('register.stage.wrapping'), 0.45);

            const userId = started.userId;
            const umkContext = envelopeContext(userId, ENVELOPE_PURPOSES.UserMasterKey);
            const settingsContext = envelopeContext(userId, ENVELOPE_PURPOSES.Settings);

            /** §5, steps 7 to 11: the master key is born from the CSPRNG, never from the password. */
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

            /** A single transactional request (§5, step 12). */
            await postJson(form.dataset.registrationFinishUrl, {
                registrationId: started.registrationId,
                registrationRecord: registered.registrationRecord,
                wrappedUserMasterKey,
                encryptedSettings,
            });

            /** Full OPAQUE login with the same password, identical to §6.1 (§5, steps 13 and 14). */
            const { clientLoginState, startLoginRequest } = startLogin(password);

            const loginStarted = await postJson(form.dataset.loginStartUrl, {
                login,
                startLoginRequest,
            });

            assertPinned(loginStarted, pinned);

            /** Second Argon2id, the one of the immediate login. */
            await this.advance(t('register.stage.verifying'), 0.9, KEY_STRETCHING_SECONDS);

            const loginFinished = finishLogin({
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

            /** The key the server returns has to be the one just born. */
            assertRoundTrip(loginFinished.exportKey, session.encryptedUserMasterKey, umkContext);

            /**
             * Settings sealed further up, with the master key already verified. The local envelope
             * is reused instead of relying on `login/finish` repeating it in its response.
             */
            loadSettings({ envelope: encryptedSettings, userId });

            const sessionSecret = decodeSessionSecret(session.sessionSecret);

            try {
                persistUnderSessionSecret(sessionSecret);
            } finally {
                zeroize(sessionSecret);
            }

            /** The new CSRF before navigating, or the next authenticated POST gives 419. */
            updateCsrfToken(session.csrf);

            await this.advance(t('stage.entering'), 1);

            navigate(session.redirect);
        },
    };
}

/**
 * Reopens the envelope the server returned and compares it with the master key in memory.
 *
 * This is the sign-up verification: if it does not match, the account has just been left with a
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
