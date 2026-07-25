/**
 * Componente Alpine de la página del enlace de establecimiento de contraseña (Spec 0001 §5).
 *
 * Recorre los veinte pasos de §5 en ese orden exacto. Los que más importan y por qué:
 *
 * * El token se lee del **fragmento** de la URL (`#<token>`), que el navegador no envía nunca al
 *   servidor: solo viaja dentro del cuerpo de `registration/start` (§4.1).
 * * El pinning del perfil y de la clave pública ocurre **antes** de `finishRegistration` (paso 5):
 *   en el registro no existe todavía `server_mac` y nada más autentica al servidor.
 * * La clave maestra nace en el paso 8, después del Argon2id, y es aleatoria: nunca derivada de la
 *   contraseña.
 * * El paso 12 es **una sola petición transaccional**. Partirla dejaría cuentas que se autentican
 *   sin clave utilizable y con el enlace ya consumido, el peor modo de fallo del diseño.
 * * Los pasos 13 a 20 son un login OPAQUE completo con la misma contraseña, idénticos a §6.1:
 *   cuestan un Argon2id de más y descubren aquí, cuando todavía no hay datos que perder, cualquier
 *   desajuste de KSF o de identidad de servidor.
 *
 * La contraseña sigue en memoria hasta el paso 17 a propósito: zeroizarla antes haría imposible el
 * login del paso 13, con el enlace ya consumido y sin segunda oportunidad.
 */

import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { open, seal } from '../crypto/envelope.js';
import { zeroize } from '../crypto/zeroize.js';
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

/**
 * Etapas de la barra de progreso, en el orden de §5.
 *
 * Hay **dos** tramos de Argon2id, no uno: el del registro (paso 6) y el del login inmediato (paso
 * 13). Cuestan lo mismo y son la parte larga del alta, así que se anuncian por separado; si la
 * barra los tratara como un solo tramo, la persona vería una pausa idéntica dos veces sin ninguna
 * explicación de por qué.
 */
const STAGES = Object.freeze({
    preparing: 'Preparando…',
    contacting: 'Comprobando el enlace…',
    stretching: 'Derivando tu clave en este dispositivo. Tarda unos segundos…',
    wrapping: 'Creando y protegiendo tu clave…',
    saving: 'Guardando…',
    verifying: 'Comprobando que tu contraseña abre tu clave. Tarda unos segundos…',
    entering: 'Entrando…',
});

/** Configuración vacía inicial (§3.1): nadie es distinguible por tenerla o no. */
const EMPTY_SETTINGS = '{"v":1}';

const MESSAGES = Object.freeze({
    link: 'Este enlace ya no sirve. Pide uno nuevo a quien administra el sistema.',
    mismatch: 'Las dos contraseñas no coinciden.',
    configuration: 'Esta instalación no está configurada correctamente. Avisa a quien la administra.',
    network: 'No hemos podido contactar con el servidor. Inténtalo de nuevo.',
    verification: 'Algo ha ido mal creando tu clave. No la hemos podido verificar.',
});

/**
 * Factoría del componente Alpine. Se registra como `phrSetPasswordForm`.
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

            /** §5, paso 2: las contraseñas salen del DOM y los campos quedan vacíos en el acto. */
            let password = this.$refs.password.value;
            const confirmation = this.$refs.passwordConfirmation.value;

            this.$refs.password.value = '';
            this.$refs.passwordConfirmation.value = '';

            try {
                if (password !== confirmation) {
                    this.error = MESSAGES.mismatch;

                    return;
                }

                await this.run(form, login, password);
            } catch (failure) {
                forget();
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
            await this.advance(STAGES.preparing, 0.05);

            /** §5, paso 1. */
            await opaqueReady();

            const pinned = opaqueParameters();
            const registrationToken = window.location.hash.replace(/^#/, '');

            if (registrationToken === '') {
                throw new AuthRequestError('The link carries no token.', 422, 'invalid_registration');
            }

            /** §5, paso 3: sin `keyStretching`. */
            const { clientRegistrationState, registrationRequest } = startRegistration(password);

            await this.advance(STAGES.contacting, 0.1);

            /** §5, paso 4. */
            const started = await postJson(form.dataset.registrationStartUrl, {
                registrationRequest,
                registrationToken,
            });

            /** §5, paso 5: antes de derivar nada. */
            assertPinned(started, pinned);

            /**
             * La barra se lanza antes y se espera a que el navegador la pinte: a partir de la
             * siguiente línea el hilo principal está bloqueado y no pinta nada más.
             */
            await this.advance(STAGES.stretching, 0.4, KEY_STRETCHING_SECONDS);

            /** §5, paso 6: aquí corre el Argon2id. */
            const registered = finishRegistration({
                password,
                clientRegistrationState,
                registrationResponse: started.registrationResponse,
                serverIdentity: pinned.serverIdentity,
            });

            await this.advance(STAGES.wrapping, 0.45);

            const userId = started.userId;
            const umkContext = envelopeContext(userId, ENVELOPE_PURPOSES.UserMasterKey);
            const settingsContext = envelopeContext(userId, ENVELOPE_PURPOSES.Settings);

            /** §5, pasos 7 a 11. */
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

            await this.advance(STAGES.saving, 0.5);

            /** §5, paso 12: una única petición transaccional. */
            await postJson(form.dataset.registrationFinishUrl, {
                registrationId: started.registrationId,
                registrationRecord: registered.registrationRecord,
                wrappedUserMasterKey,
                encryptedSettings,
            });

            /** §5, pasos 13 y 14: el mismo login que hará cualquier día futuro. */
            const { clientLoginState, startLoginRequest } = startLogin(password);

            const loginStarted = await postJson(form.dataset.loginStartUrl, {
                login,
                startLoginRequest,
            });

            assertPinned(loginStarted, pinned);

            /** Segundo Argon2id, el del login inmediato del paso 13. */
            await this.advance(STAGES.verifying, 0.9, KEY_STRETCHING_SECONDS);

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

            await this.advance(STAGES.entering, 0.95);

            const session = await postJson(form.dataset.loginFinishUrl, {
                handshakeId: loginStarted.handshakeId,
                finishLoginRequest: loginFinished.finishLoginRequest,
            });

            /** §5, pasos 15 y 16: la clave que devuelve el servidor tiene que ser la que nació. */
            assertRoundTrip(loginFinished.exportKey, session.encryptedUserMasterKey, umkContext);

            /** §5, paso 18. */
            const sessionSecret = decodeSessionSecret(session.sessionSecret);

            try {
                persistUnderSessionSecret(sessionSecret);
            } finally {
                zeroize(sessionSecret);
            }

            /** §5, paso 19. */
            updateCsrfToken(session.csrf);

            await this.advance(STAGES.entering, 1);

            /** §5, paso 20. */
            navigate(session.redirect);
        },
    };
}

/**
 * §5, pasos 15 y 16: reabre el sobre que devolvió el servidor y compara con la clave en memoria.
 *
 * Es la verificación del alta. Si no cuadra, la cuenta acaba de quedar con una clave que nadie
 * puede recuperar, y es mejor saberlo ahora, sin datos todavía, que en el primer login real.
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

/**
 * @param {unknown} failure
 * @returns {string}
 */
function describe(failure) {
    if (failure instanceof AuthRequestError) {
        return failure.status === null ? MESSAGES.network : MESSAGES.link;
    }

    if (failure?.name === 'OpaqueConfigurationError') {
        return MESSAGES.configuration;
    }

    return MESSAGES.verification;
}
