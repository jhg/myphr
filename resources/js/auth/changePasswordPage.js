/**
 * Componente Alpine del cambio de contraseña de quien recuerda la actual.
 *
 * La propiedad que ordena todo el módulo: **la clave maestra no cambia**. Lo único que cambia es la
 * KEK que la envuelve, porque `exportKey` cambia con cada re-registro OPAQUE mientras la clave
 * maestra persiste (`docs/OPAQUE.md` §17). Generar una clave maestra nueva obligaría a re-cifrar
 * todo el histórico desde el navegador, y cualquier registro que se quedara sin re-cifrar sería
 * ilegible para siempre. Por eso la clave maestra se **abre** con la KEK vieja y se **reenvuelve**
 * con la nueva, nunca se crea. De ahí también que la configuración cifrada no se toque: va bajo una
 * clave derivada de la clave maestra, que sigue siendo la misma.
 *
 * Tres cosas más que el orden de este archivo protege y que no son negociables:
 *
 * * La contraseña actual se verifica con un **login OPAQUE completo** (fase A). No basta con que la
 *   sesión esté abierta —un puesto desatendido cambiaría la contraseña de otra persona— y, sobre
 *   todo, ese login es la única forma de obtener el `exportKey` viejo del que sale la KEK vieja.
 * * `assertPinned` corre **antes** de `finishRegistration` (paso 14): en un registro no existe
 *   `server_mac` y nada más autentica al servidor.
 * * La verificación local del paso 18 ocurre **antes** de escribir nada. Es la única barrera que
 *   puede abortar sin dejar rastro en la base de datos; la del paso 24 solo diagnostica.
 *
 * Las contraseñas vieja y nueva viven en memoria hasta el final a propósito: zeroizar la vieja antes
 * del commit impide reintentar tras un corte de red, y zeroizar la nueva antes de la comprobación
 * final la haría imposible justo cuando más informa.
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
 * Factoría del componente Alpine. Se registra como `phrChangePasswordForm`.
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

            /** Paso 2: las tres contraseñas salen del DOM y los campos quedan vacíos en el acto. */
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
                /** Paso 22: aquí, y no antes; hasta el commit hay que poder reintentar. */
                currentPassword = '';
                newPassword = '';
                this.busy = false;
            }
        },

        /**
         * Delega en {@see changePassword}, que es donde vive el procedimiento, y traduce sus etapas
         * a las de esta barra de progreso. La pantalla de perfil llama a la misma función.
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
 * El procedimiento completo del cambio de contraseña, sin nada de interfaz: reautenticación OPAQUE
 * con la contraseña actual, re-registro con la nueva y reenvoltura de la clave maestra.
 *
 * Vive fuera del componente Alpine porque tiene **dos** pantallas: esta y la sección «Cambiar la
 * contraseña» del perfil (`profilePage.js`). Antes solo existía dentro del componente, y el perfil
 * lo importaba con `const { changePassword } = await import('./changePasswordPage.js')` — un nombre
 * que no se exportaba: la constante quedaba `undefined` y el cambio de contraseña del perfil moría
 * con un `TypeError` en el clic, sin que ningún test ni el empaquetado lo vieran, porque un
 * `import()` dinámico no comprueba los nombres hasta que se ejecuta.
 *
 * Las etapas se anuncian por `onStage`, con nombres propios: cada pantalla decide qué texto y qué
 * fracción de barra les corresponde. Se espera al valor que devuelva, para que la barra pueda pintar
 * antes de que empiece un Argon2id que bloquea el hilo principal.
 *
 * @param {object} params
 * @param {string} params.currentPassword
 * @param {string} params.newPassword
 * @param {{reauthStartUrl: string, reauthFinishUrl: string, registrationStartUrl: string, changeUrl: string}} params.urls
 * @param {(stage: string) => (Promise<void>|void)} [params.onStage]
 * @returns {Promise<void>}
 */
export async function changePassword({ currentPassword, newPassword, urls, onStage = () => {} }) {
    /** Paso 1. */
    await opaqueReady();

    const pinned = opaqueParameters();

    /** Paso 3: `startLogin` sin `keyStretching`. */
    const { clientLoginState, startLoginRequest } = startLogin(currentPassword);

    await onStage('reauth');

    /** Paso 4: el usuario sale de la sesión, no del cuerpo. */
    const reauthStarted = await postJson(urls.reauthStartUrl, { startLoginRequest });

    /** Paso 5: pinning antes de derivar nada. */
    assertPinned(reauthStarted, pinned);

    await onStage('stretchingOld');

    /** Paso 6: primer Argon2id. */
    const reauthenticated = finishLogin({
        password: currentPassword,
        clientLoginState,
        loginResponse: reauthStarted.loginResponse,
        serverIdentity: pinned.serverIdentity,
    });

    /** `undefined` es «la contraseña actual no es correcta», no un error técnico. */
    if (reauthenticated === undefined) {
        throw new AuthRequestError('Reauthentication failed.', null, 'current_password');
    }

    await onStage('opening');

    /** Paso 7. */
    const reauthFinished = await postJson(urls.reauthFinishUrl, {
        handshakeId: reauthStarted.handshakeId,
        finishLoginRequest: reauthenticated.finishLoginRequest,
    });

    const userId = reauthFinished.userId;
    const umkContext = envelopeContext(userId, ENVELOPE_PURPOSES.UserMasterKey);

    /** Pasos 8 a 11: abrir el sobre vigente con la KEK vieja y adoptar la clave maestra. */
    adoptCurrentMasterKey({
        exportKey: reauthenticated.exportKey,
        envelope: reauthFinished.encryptedUserMasterKey,
        context: umkContext,
        userId,
    });

    await onStage('registering');

    /** Paso 12: `startRegistration` sin `keyStretching`. */
    const { clientRegistrationState, registrationRequest } = startRegistration(newPassword);

    /** Paso 13: el ticket se comprueba, no se consume. */
    const registrationStarted = await postJson(urls.registrationStartUrl, {
        registrationRequest,
        ticket: reauthFinished.ticket,
    });

    /** Paso 14: antes del Argon2id; en un registro no hay `server_mac`. */
    assertPinned(registrationStarted, pinned);

    await onStage('stretching');

    /** Paso 15: segundo Argon2id. */
    const registered = finishRegistration({
        password: newPassword,
        clientRegistrationState,
        registrationResponse: registrationStarted.registrationResponse,
        serverIdentity: pinned.serverIdentity,
    });

    await onStage('wrapping');

    /** Pasos 16 a 19: reenvoltura y verificación local **antes** de escribir nada. */
    const wrappedUserMasterKey = rewrapMasterKey(registered.exportKey, umkContext);

    await onStage('saving');

    /** Paso 20: una única petición, una única transacción. */
    const changed = await postJson(urls.changeUrl, {
        registrationId: registrationStarted.registrationId,
        ticket: reauthFinished.ticket,
        registrationRecord: registered.registrationRecord,
        wrappedUserMasterKey,
    });

    /**
     * Paso 21: el servidor regeneró la sesión, así que el secreto anterior ya no existe y el
     * paquete de `sessionStorage` no lo abre nadie. Sin esto, el primer F5 después de cambiar la
     * contraseña echa a la persona al login sin causa aparente. No se borra el paquete: se
     * sobrescribe, con la misma clave maestra de siempre.
     */
    const sessionSecret = decodeSessionSecret(changed.sessionSecret);

    try {
        persistUnderSessionSecret(sessionSecret);
    } finally {
        zeroize(sessionSecret);
    }

    /** Paso 23: el CSRF nuevo, o el siguiente POST da 419. */
    updateCsrfToken(changed.csrf);
}

/**
 * Pasos 8 a 11: KEK vieja, apertura del sobre vigente y adopción de la clave maestra.
 *
 * Si ya había clave en memoria se compara en tiempo constante con la que abre el sobre y se aborta
 * si difieren: la clave en memoria puede haber llegado por recuperación con el secreto de sesión, sin
 * contraseña de por medio (ADR 0003), así que reenvolver esa sin comprobar podría atar la contraseña
 * nueva a una clave que no descifra nada.
 *
 * Un fallo al abrir es **visible**, nunca silencioso (ADR 0004), y aborta el cambio.
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
 * Pasos 16 a 19: KEK nueva, reenvoltura de la **misma** clave maestra y verificación local.
 *
 * El dato asociado es el mismo que el del sobre viejo, porque el identificador de usuario no cambia:
 * usar otro produciría un sobre que no abriría nunca.
 *
 * La verificación del paso 18 no cuesta ningún Argon2id y es la única comprobación anterior a
 * cualquier escritura. Si falla, se aborta sin haber tocado la base de datos y la cuenta queda
 * exactamente como estaba.
 *
 * @param {string} exportKey `exportKey` del registro con la contraseña nueva.
 * @param {string} context Dato asociado del sobre de la clave maestra.
 * @returns {string} Sobre nuevo, listo para el commit.
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
 * Traduce un fallo al mensaje que corresponde.
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
