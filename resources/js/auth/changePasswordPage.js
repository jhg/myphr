/**
 * Alpine component of the password change for someone who remembers the current one.
 *
 * The property that orders the whole module: **the master key does not change**. The only thing
 * that changes is the KEK wrapping it, because `exportKey` changes with every OPAQUE
 * re-registration while the master key survives (`docs/OPAQUE.md` §17). Generating a new master
 * key would force re-encrypting the whole history from the browser, and any record left
 * un-re-encrypted would be unreadable forever. That is why the master key is **opened** with the
 * old KEK and **rewrapped** with the new one, never created. Hence also that the encrypted
 * configuration is not touched: it sits under a key derived from the master key, which stays the same.
 *
 * Three more things the order of this file protects, and they are not negotiable:
 *
 * * The current password is verified with a **full OPAQUE login** (phase A). An open session is
 *   not enough —an unattended desk would change somebody else's password— and, above all, that
 *   login is the only way to obtain the old `exportKey` the old KEK comes from.
 * * `assertPinned` runs **before** `finishRegistration` (step 14): in a registration there is no
 *   `server_mac` and nothing else authenticates the server.
 * * The local verification of step 18 happens **before** writing anything. It is the only barrier
 *   that can abort without leaving a trace in the database; the one in step 24 only diagnoses.
 *
 * The old and new passwords live in memory until the end on purpose: wiping the old one before
 * the commit prevents retrying after a network drop, and wiping the new one before the final check
 * would make that check impossible exactly when it tells us most.
 */

import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { open, seal } from '../crypto/envelope.js';
import { zeroize } from '../crypto/zeroize.js';
import { t } from '../i18n/index.js';
import { envelopeContext, ENVELOPE_PURPOSES } from './context.js';
import { AuthRequestError, postJson, updateCsrfToken } from './http.js';
import {
    adoptMasterKey,
    decodeSessionSecret,
    isUnlocked,
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
import { KEY_STRETCHING_SECONDS, progressMixin } from './progress.js';

/**
 * Alpine component factory. Registered as `phrChangePasswordForm`.
 *
 * @returns {object}
 */
export function changePasswordForm() {
    return {
        ...progressMixin(),

        busy: false,
        error: '',
        success: '',

        /** @param {SubmitEvent} event */
        async submit(event) {
            if (this.busy) {
                return;
            }

            this.busy = true;
            this.error = '';
            this.success = '';
            this.resetProgress();

            const form = event.target;

            /** Step 2: the three passwords leave the DOM and the fields are emptied at once. */
            let currentPassword = this.$refs.currentPassword.value;
            let newPassword = this.$refs.newPassword.value;
            const confirmation = this.$refs.newPasswordConfirmation.value;

            this.$refs.currentPassword.value = '';
            this.$refs.newPassword.value = '';
            this.$refs.newPasswordConfirmation.value = '';

            try {
                if (currentPassword === '' || newPassword === '') {
                    this.error = t('changePassword.error.empty');

                    return;
                }

                if (newPassword !== confirmation) {
                    this.error = t('changePassword.error.mismatch');

                    return;
                }

                if (newPassword === currentPassword) {
                    this.error = t('changePassword.error.same');

                    return;
                }

                await this.run(form, currentPassword, newPassword);

                this.success = t('changePassword.success');
            } catch (failure) {
                this.error = describe(failure);
                this.resetProgress();
            } finally {
                /** Step 22: here, and not before; until the commit a retry must be possible. */
                currentPassword = '';
                newPassword = '';
                this.busy = false;
            }
        },

        /**
         * Delegates to {@see changePassword}, where the procedure lives, and maps its stages onto
         * those of this progress bar. The profile screen calls the same function.
         *
         * @param {HTMLFormElement} form
         * @param {string} currentPassword
         * @param {string} newPassword
         */
        async run(form, currentPassword, newPassword) {
            await this.advance(t('stage.preparing'), 0.05);

            await changePassword({
                currentPassword,
                newPassword,
                urls: { ...form.dataset },
                onStage: (stage) => {
                    const plan = {
                        reauth: [t('changePassword.stage.reauthenticating'), 0.1],
                        stretchingOld: [t('changePassword.stage.stretchingOld'), 0.3, KEY_STRETCHING_SECONDS],
                        opening: [t('changePassword.stage.unwrapping'), 0.4],
                        registering: [t('changePassword.stage.registering'), 0.5],
                        stretching: [t('changePassword.stage.stretchingNew'), 0.8, KEY_STRETCHING_SECONDS],
                        wrapping: [t('stage.saving'), 0.85],
                        saving: [t('stage.saving'), 0.9],
                    }[stage];

                    return plan === undefined ? Promise.resolve() : this.advance(...plan);
                },
            });

            await this.advance(t('stage.done'), 1);
        },
    };
}

/**
 * The full password change procedure, with no interface at all: OPAQUE reauthentication with the
 * current password, re-registration with the new one and rewrapping of the master key.
 *
 * It lives outside the Alpine component because it has **two** screens: this one and the "Change
 * password" section of the profile (`profilePage.js`). It used to exist only inside the component,
 * and the profile imported it with `const { changePassword } = await import('./changePasswordPage.js')`
 * — a name that was not exported: the constant stayed `undefined` and the profile password change
 * died with a `TypeError` on click, with neither the tests nor the bundler seeing it, because a
 * dynamic `import()` does not check names until it runs.
 *
 * Stages are announced through `onStage`, with names of their own: each screen decides which text
 * and which bar fraction they get. The returned value is awaited, so the bar can paint before an
 * Argon2id that blocks the main thread starts.
 *
 * @param {object} params
 * @param {string} params.currentPassword
 * @param {string} params.newPassword
 * @param {{reauthStartUrl: string, reauthFinishUrl: string, registrationStartUrl: string, changeUrl: string}} params.urls
 * @param {(stage: string) => (Promise<void>|void)} [params.onStage]
 * @returns {Promise<void>}
 */
export async function changePassword({ currentPassword, newPassword, urls, onStage = () => {} }) {
    /** Step 1. */
    await opaqueReady();

    const pinned = opaqueParameters();

    /** Step 3: `startLogin` without `keyStretching`. */
    const { clientLoginState, startLoginRequest } = await startLogin(currentPassword);

    await onStage('reauth');

    /** Step 4: the user comes from the session, not from the body. */
    const reauthStarted = await postJson(urls.reauthStartUrl, { startLoginRequest });

    /** Step 5: pinning before deriving anything. */
    assertPinned(reauthStarted, pinned);

    await onStage('stretchingOld');

    /** Step 6: first Argon2id. */
    const reauthenticated = await finishLogin({
        password: currentPassword,
        clientLoginState,
        loginResponse: reauthStarted.loginResponse,
        serverIdentity: pinned.serverIdentity,
    });

    /** `undefined` means "the current password is not correct", not a technical error. */
    if (reauthenticated === undefined) {
        throw new AuthRequestError('Reauthentication failed.', null, 'current_password');
    }

    await onStage('opening');

    /** Step 7. */
    const reauthFinished = await postJson(urls.reauthFinishUrl, {
        handshakeId: reauthStarted.handshakeId,
        finishLoginRequest: reauthenticated.finishLoginRequest,
    });

    const userId = reauthFinished.userId;
    const umkContext = envelopeContext(userId, ENVELOPE_PURPOSES.UserMasterKey);

    /** Steps 8 to 11: open the current envelope with the old KEK and adopt the master key. */
    adoptCurrentMasterKey({
        exportKey: reauthenticated.exportKey,
        envelope: reauthFinished.encryptedUserMasterKey,
        context: umkContext,
        userId,
    });

    await onStage('registering');

    /** Step 12: `startRegistration` without `keyStretching`. */
    const { clientRegistrationState, registrationRequest } = await startRegistration(newPassword);

    /** Step 13: the ticket is checked, not consumed. */
    const registrationStarted = await postJson(urls.registrationStartUrl, {
        registrationRequest,
        ticket: reauthFinished.ticket,
    });

    /** Step 14: before Argon2id; in a registration there is no `server_mac`. */
    assertPinned(registrationStarted, pinned);

    await onStage('stretching');

    /** Step 15: second Argon2id. */
    const registered = await finishRegistration({
        password: newPassword,
        clientRegistrationState,
        registrationResponse: registrationStarted.registrationResponse,
        serverIdentity: pinned.serverIdentity,
    });

    await onStage('wrapping');

    /** Steps 16 to 19: rewrap and local verification **before** writing anything. */
    const wrappedUserMasterKey = rewrapMasterKey(registered.exportKey, umkContext);

    await onStage('saving');

    /** Step 20: one single request, one single transaction. */
    const changed = await postJson(urls.changeUrl, {
        registrationId: registrationStarted.registrationId,
        ticket: reauthFinished.ticket,
        registrationRecord: registered.registrationRecord,
        wrappedUserMasterKey,
    });

    /**
     * Step 21: the server regenerated the session, so the previous secret no longer exists and
     * nobody can open the `sessionStorage` package. Without this, the first F5 after changing the
     * password throws the person back to the login for no visible reason. The package is not
     * deleted: it is overwritten, with the same master key as always.
     */
    const sessionSecret = decodeSessionSecret(changed.sessionSecret);

    try {
        persistUnderSessionSecret(sessionSecret);
    } finally {
        zeroize(sessionSecret);
    }

    /** Step 23: the new CSRF, or the next POST gives 419. */
    updateCsrfToken(changed.csrf);
}

/**
 * Steps 8 to 11: old KEK, opening of the current envelope and adoption of the master key.
 *
 * If there already was a key in memory it is compared in constant time with the one that opens the
 * envelope, and the change aborts if they differ: the key in memory may have arrived by recovery
 * with the session secret, with no password involved (ADR 0003), so rewrapping that one unchecked
 * could tie the new password to a key that decrypts nothing.
 *
 * A failure to open is **visible**, never silent (ADR 0004), and it aborts the change.
 *
 * @param {{exportKey: string, envelope: string, context: string, userId: string}} params
 */
function adoptCurrentMasterKey({ exportKey, envelope, context, userId }) {
    const kek = deriveKey({ ikm: exportKey, label: KDF_LABELS.KEK });
    let masterKey = null;

    try {
        masterKey = open({ key: kek, envelope, associatedData: context });

        if (isUnlocked()) {
            const matches = withMasterKey((key) => constantTimeEquals(key, masterKey));

            if (!matches) {
                throw new OpaqueConfigurationError(
                    'The stored envelope does not hold the master key already in memory.'
                );
            }
        }

        adoptMasterKey(masterKey, userId);
    } finally {
        zeroize(kek);

        if (masterKey !== null) {
            zeroize(masterKey);
        }
    }
}

/**
 * Steps 16 to 19: new KEK, rewrapping of the **same** master key and local verification.
 *
 * The associated data is the same as the old envelope's, because the user identifier does not
 * change: using another one would produce an envelope that would never open.
 *
 * The verification of step 18 costs no Argon2id and is the only check before any write. If it
 * fails, the change aborts without having touched the database and the account stays exactly as it
 * was.
 *
 * @param {string} exportKey `exportKey` of the registration with the new password.
 * @param {string} context Associated data of the master key envelope.
 * @returns {string} New envelope, ready for the commit.
 */
function rewrapMasterKey(exportKey, context) {
    const kek = deriveKey({ ikm: exportKey, label: KDF_LABELS.KEK });
    let verification = null;

    try {
        const wrapped = withMasterKey((key) => seal({
            key: kek,
            plaintext: key,
            associatedData: context,
        }));

        verification = open({ key: kek, envelope: wrapped, associatedData: context });

        const matches = withMasterKey((key) => constantTimeEquals(key, verification));

        if (!matches) {
            throw new OpaqueConfigurationError('The new envelope does not reopen the master key.');
        }

        return wrapped;
    } finally {
        zeroize(kek);

        if (verification !== null) {
            zeroize(verification);
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
 * Translates a failure into the message that fits.
 *
 * @param {unknown} failure
 * @returns {string}
 */
function describe(failure) {
    if (failure instanceof AuthRequestError) {
        if (failure.status === null) {
            return failure.code === 'current_password' ? t('changePassword.error.currentPassword') : t('common.network');
        }

        if (failure.status === 401) {
            return t('changePassword.error.currentPassword');
        }

        if (failure.code === 'password_change_unavailable') {
            return t('changePassword.error.unavailable');
        }

        if (failure.code === 'password_change_expired') {
            return t('changePassword.error.expired');
        }

        return t('changePassword.error.verification');
    }

    if (failure?.name === 'OpaqueConfigurationError') {
        return t('common.configuration');
    }

    return t('changePassword.error.verification');
}
