/**
 * Componente Alpine de la pantalla de alta pública, sin invitación (Spec 0001 §4.1 y §5, con la
 * variante de `POST /phr/auth/opaque/registration/public/start`).
 *
 * Es la misma secuencia que `setPasswordPage.js`, con dos diferencias únicamente:
 *
 * * No hay token en el fragmento de la URL: quien llega aquí no tiene invitación, así que el
 *   nombre y el login los escribe la propia persona y viajan en el cuerpo de `registration/public/
 *   start` junto con `registrationRequest` (`RegistrationPublicStartController`).
 * * El servidor puede responder 409 `login_taken` cuando el correo ya tiene cuenta. Es una decisión
 *   explícita del servidor (`RegistrationPublicStartController`, comentario junto a la clase), y
 *   aquí se traduce a un mensaje accionable, no a un error genérico: la plantilla ofrece un enlace a
 *   iniciar sesión cuando `loginTaken` es verdadero.
 *
 * El resto —nacimiento de la clave maestra, sellado de los sobres, la única petición transaccional
 * de `registration/finish` y el login OPAQUE inmediato con la misma contraseña— es idéntico a §5 y
 * no se reimplementa: mismos módulos de `opaqueClient.js`, `keyring.js`, `context.js`, `settings.js`.
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

/** Configuración vacía inicial (§3.1): nadie es distinguible por tenerla o no. */
const EMPTY_SETTINGS = '{"v":1}';

/**
 * Compara las dos contraseñas del formulario. Función pura, sin estado de Alpine, para poder
 * probarla sin montar DOM.
 *
 * @param {string} password
 * @param {string} confirmation
 * @returns {boolean}
 */
export function passwordsMatch(password, confirmation) {
    return password === confirmation;
}

/**
 * Traduce un fallo de la alta pública al mensaje que corresponde.
 *
 * El 409 `login_taken` es un caso propio, no una variante del genérico: quien lo lee tiene que
 * enterarse de que ya existe una cuenta con ese correo y de que hay una acción concreta que tomar
 * (ir a iniciar sesión), así que se devuelve también `loginTaken` para que la plantilla pueda ofrecer
 * ese enlace en vez de darlo por perdido en el texto del error.
 *
 * Función pura sobre el propio error: no lee `document` ni `window`, así que se puede probar
 * construyendo los errores a mano.
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
 * Factoría del componente Alpine. Se registra como `phrRegisterForm`.
 *
 * @returns {object}
 */
export function registerPage() {
    return {
        ...progressMixin(),

        busy: false,
        error: '',

        /** ¿El último error fue un 409 `login_taken`? La plantilla ofrece entonces ir a acceder. */
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

            /** La contraseña sale del DOM y los campos quedan vacíos en el acto (§5, paso 2). */
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

            /** Sin `keyStretching` (§5, paso 3). */
            const { clientRegistrationState, registrationRequest } = startRegistration(password);

            await this.advance(t('register.stage.contacting'), 0.1);

            const started = await postJson(form.dataset.registrationStartUrl, {
                name,
                login,
                registrationRequest,
            });

            /** Antes de derivar nada (§5, paso 5): en el alta no existe todavía `server_mac`. */
            assertPinned(started, pinned);

            /**
             * La barra se lanza antes y se espera a que el navegador la pinte: a partir de la
             * siguiente línea el hilo principal está bloqueado y no pinta nada más.
             */
            await this.advance(t('register.stage.stretching'), 0.4, KEY_STRETCHING_SECONDS);

            /** Aquí corre el primer Argon2id (§5, paso 6). */
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

            /** §5, pasos 7 a 11: la clave maestra nace del CSPRNG, nunca de la contraseña. */
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

            /** Una única petición transaccional (§5, paso 12). */
            await postJson(form.dataset.registrationFinishUrl, {
                registrationId: started.registrationId,
                registrationRecord: registered.registrationRecord,
                wrappedUserMasterKey,
                encryptedSettings,
            });

            /** Login OPAQUE completo con la misma contraseña, idéntico a §6.1 (§5, pasos 13 y 14). */
            const { clientLoginState, startLoginRequest } = startLogin(password);

            const loginStarted = await postJson(form.dataset.loginStartUrl, {
                login,
                startLoginRequest,
            });

            assertPinned(loginStarted, pinned);

            /** Segundo Argon2id, el del login inmediato. */
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

            /** La clave que devuelve el servidor tiene que ser la que acaba de nacer. */
            assertRoundTrip(loginFinished.exportKey, session.encryptedUserMasterKey, umkContext);

            /**
             * Ajustes recién sellados más arriba, con la clave maestra ya verificada. Se reutiliza
             * el sobre local en vez de depender de que `login/finish` lo repita en su respuesta.
             */
            loadSettings({ envelope: encryptedSettings, userId });

            const sessionSecret = decodeSessionSecret(session.sessionSecret);

            try {
                persistUnderSessionSecret(sessionSecret);
            } finally {
                zeroize(sessionSecret);
            }

            /** El CSRF nuevo antes de navegar, o el siguiente POST autenticado da 419. */
            updateCsrfToken(session.csrf);

            await this.advance(t('stage.entering'), 1);

            navigate(session.redirect);
        },
    };
}

/**
 * Reabre el sobre que devolvió el servidor y compara con la clave maestra en memoria.
 *
 * Es la verificación del alta: si no cuadra, la cuenta acaba de quedar con una clave que nadie puede
 * recuperar, y es mejor saberlo ahora, sin datos todavía, que en el primer login real.
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
 * Comparación en tiempo constante de dos búferes.
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
