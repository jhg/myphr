/**
 * Componente Alpine del formulario de login (Spec 0001 §6.1).
 *
 * La contraseña se lee del nodo del DOM y el `<input>` se vacía en el paso 2, antes de que exista
 * ningún estado que pudiera retenerla. No hay `wire:model` en ningún punto de este camino: nada de
 * lo que se escribe aquí entra en el `snapshot` de Livewire (ADR 0002).
 *
 * La navegación al panel la hace este módulo con el `redirect` que devuelve `login/finish`, así que
 * no hace falta tocar el `LoginResponse` de Filament.
 */

import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { open } from '../crypto/envelope.js';
import { zeroize } from '../crypto/zeroize.js';
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

/**
 * Etapas de la barra de progreso. La de `finishLogin` es la única que bloquea el hilo principal
 * durante segundos, y es la razón de que la barra exista: sin ella la persona pulsa dos veces.
 */
const STAGES = Object.freeze({
    preparing: 'Preparando…',
    contacting: 'Comprobando tus datos…',
    stretching: 'Derivando tu clave en este dispositivo. Tarda unos segundos…',
    entering: 'Entrando…',
});

/**
 * Mensajes que ve la persona. Un único texto para todas las causas de fallo de credenciales, igual
 * que el servidor devuelve un único error genérico (§4.4): distinguirlas delataría qué cuentas
 * existen.
 */
const MESSAGES = Object.freeze({
    credentials: 'No hemos podido entrar con esos datos.',
    configuration: 'Esta instalación no está configurada correctamente. Avisa a quien la administra.',
    network: 'No hemos podido contactar con el servidor. Inténtalo de nuevo.',
});

/**
 * Factoría del componente Alpine. Se registra como `phrLoginForm`.
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

            /** §6.1, paso 2: la contraseña sale del DOM y el campo queda vacío en el acto. */
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
            await this.advance(STAGES.preparing, 0.1);

            await opaqueReady();

            const pinned = opaqueParameters();

            const { clientLoginState, startLoginRequest } = startLogin(password);

            await this.advance(STAGES.contacting, 0.25);

            const started = await postJson(form.dataset.loginStartUrl, {
                login,
                startLoginRequest,
            });

            assertPinned(started, pinned);

            /**
             * La barra se lanza **antes** de la llamada, y se espera a que el navegador la pinte:
             * `finishLogin` corre Argon2id de forma síncrona y a partir de aquí el hilo principal no
             * pinta nada más hasta que termine.
             */
            await this.advance(STAGES.stretching, 0.85, KEY_STRETCHING_SECONDS);

            const finished = finishLogin({
                password,
                clientLoginState,
                loginResponse: started.loginResponse,
                serverIdentity: pinned.serverIdentity,
            });

            /** §6.1, paso 5: `undefined` es «la contraseña no cuadra», no un error técnico. */
            if (finished === undefined) {
                throw new AuthRequestError('Login failed.', null, 'authentication_failed');
            }

            await this.advance(STAGES.entering, 0.95);

            const session = await postJson(form.dataset.loginFinishUrl, {
                handshakeId: started.handshakeId,
                finishLoginRequest: finished.finishLoginRequest,
            });

            unwrapMasterKey(finished.exportKey, session);

            /** §6.1, paso 9: el paquete de recuperación, ya con sesión creada y clave verificada. */
            const sessionSecret = decodeSessionSecret(session.sessionSecret);

            try {
                persistUnderSessionSecret(sessionSecret);
            } finally {
                zeroize(sessionSecret);
            }

            /** §6.1, paso 10: el CSRF nuevo antes de navegar, o el siguiente POST da 419. */
            updateCsrfToken(session.csrf);

            await this.advance(STAGES.entering, 1);

            navigate(session.redirect);
        },
    };
}

/**
 * §6.1, paso 7: KEK a partir del `exportKey` y apertura del sobre vigente de la clave maestra.
 *
 * Un fallo aquí es visible: nunca se oculta el registro ni se degrada en silencio (ADR 0004).
 *
 * @param {string} exportKey
 * @param {{userId?: string, encryptedUserMasterKey: string}} session
 */
function unwrapMasterKey(exportKey, session) {
    const userId = session.userId;

    /**
     * El dato asociado del sobre lleva el identificador del usuario (§5, paso 9), así que sin él
     * el sobre no abre. Hoy `login/finish` no lo devuelve: §4.4 no lo lista entre sus campos,
     * aunque §4.1 sí lo devuelve en el registro por esta misma razón. Es un hueco del contrato,
     * no un caso de ejecución, y por eso falla de forma ruidosa en vez de intentar adivinarlo.
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
 * Traduce un fallo al único mensaje que corresponde.
 *
 * @param {unknown} failure
 * @returns {string}
 */
function describe(failure) {
    if (failure instanceof AuthRequestError) {
        return failure.status === null ? MESSAGES.network : MESSAGES.credentials;
    }

    if (failure?.name === 'OpaqueConfigurationError') {
        return MESSAGES.configuration;
    }

    return MESSAGES.credentials;
}
