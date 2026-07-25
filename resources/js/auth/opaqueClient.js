/**
 * Único sitio del proyecto que llama a `@serenity-kit/opaque` (Spec 0001 §10).
 *
 * Encapsula tres cosas que, repartidas por las pantallas, acabarían divergiendo:
 *
 * 1. El **KSF congelado**. `keyStretching` va en `finishRegistration` y en `finishLogin`, nunca en
 *    los `start*` (§5, «Qué se rompe si se altera el orden»): pasarlo en el `start` se ignora en
 *    silencio y el registro queda atado al valor por defecto del paquete, de modo que todo login
 *    futuro falla como «contraseña incorrecta».
 * 2. El **`identifiers.server`**, que tiene que coincidir carácter a carácter con
 *    `OPAQUE_SERVER_IDENTITY` del servidor. Llega en un `<meta>` del `<head>` del panel.
 * 3. El **pinning** del perfil y de la clave pública del servidor antes de derivar nada (§5, paso
 *    5): en el registro no existe todavía `server_mac` y nada más autentica al servidor.
 */

import { client, ready } from '@serenity-kit/opaque';

/**
 * Argon2id v0x13, m=64 MiB, t=3, p=4: los parámetros que nombra el perfil
 * `OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1` (`docs/OPAQUE.md` §2).
 *
 * Congelado a propósito: si estos números cambian sin cambiar el nombre del perfil, el login de
 * todo el mundo se comporta como una contraseña incorrecta, sin ninguna pista de que el problema
 * es de configuración (§7).
 */
export const KEY_STRETCHING = Object.freeze({
    'argon2id-custom': Object.freeze({ iterations: 3, memory: 65536, parallelism: 4 }),
});

/** Error de configuración del cliente. Se distingue de «contraseña incorrecta» a propósito. */
export class OpaqueConfigurationError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'OpaqueConfigurationError';
    }
}

/**
 * Lee un `<meta name="...">` del documento.
 *
 * @param {string} name
 * @returns {string|null}
 */
function meta(name) {
    const element = document.head?.querySelector(`meta[name="${name}"]`);
    const content = element?.getAttribute('content');

    return typeof content === 'string' && content !== '' ? content : null;
}

/**
 * Parámetros públicos que el `<head>` del panel publica.
 *
 * @returns {{profile: string, serverIdentity: string, serverPublicKey: string}}
 * @throws {OpaqueConfigurationError} Si falta alguno: sin ellos no hay pinning posible y derivar
 *         igualmente sería derivar contra un servidor no autenticado.
 */
export function opaqueParameters() {
    const profile = meta('phr-opaque-profile');
    const serverIdentity = meta('phr-opaque-server-identity');
    const serverPublicKey = meta('phr-opaque-server-public-key');

    if (profile === null || serverIdentity === null || serverPublicKey === null) {
        throw new OpaqueConfigurationError('The OPAQUE parameters are missing from the page head.');
    }

    return { profile, serverIdentity, serverPublicKey };
}

/**
 * Comprueba el perfil y la clave pública que devuelve el servidor contra los fijados en la página
 * (§5, paso 5). Se llama **antes** de `finishRegistration`, no después.
 *
 * @param {{profile?: string, serverPublicKey?: string}} response
 * @param {{profile: string, serverPublicKey: string}} pinned
 * @throws {OpaqueConfigurationError}
 */
export function assertPinned(response, pinned) {
    if (response.profile !== pinned.profile) {
        throw new OpaqueConfigurationError('The server announced a different OPAQUE profile.');
    }

    if (response.serverPublicKey !== undefined
        && response.serverPublicKey !== pinned.serverPublicKey) {
        throw new OpaqueConfigurationError('The server public key does not match the pinned one.');
    }
}

/** Resuelve cuando el WebAssembly del paquete está cargado (§5, paso 1). */
export function opaqueReady() {
    return ready;
}

/**
 * `startRegistration` — sin `keyStretching` (§5, paso 3).
 *
 * @param {string} password
 * @returns {{clientRegistrationState: string, registrationRequest: string}}
 */
export function startRegistration(password) {
    return client.startRegistration({ password });
}

/**
 * `finishRegistration` — aquí, y solo aquí, corre el Argon2id (§5, paso 6).
 *
 * @param {object} params
 * @param {string} params.password
 * @param {string} params.clientRegistrationState
 * @param {string} params.registrationResponse
 * @param {string} params.serverIdentity
 * @returns {{registrationRecord: string, exportKey: string, serverStaticPublicKey: string}}
 */
export function finishRegistration({
    password,
    clientRegistrationState,
    registrationResponse,
    serverIdentity,
}) {
    return client.finishRegistration({
        password,
        clientRegistrationState,
        registrationResponse,
        identifiers: { server: serverIdentity },
        keyStretching: KEY_STRETCHING,
    });
}

/**
 * `startLogin` — sin `keyStretching` (§6.1, paso 3).
 *
 * @param {string} password
 * @returns {{clientLoginState: string, startLoginRequest: string}}
 */
export function startLogin(password) {
    return client.startLogin({ password });
}

/**
 * `finishLogin` (§6.1, paso 5).
 *
 * Devuelve `undefined` —nunca `null`— cuando la contraseña no cuadra, y **lanza** cuando la
 * configuración del KSF es inválida. Son dos casos distintos y quien llama tiene que separarlos:
 * el primero es un error de la persona, el segundo un error de despliegue.
 *
 * @param {object} params
 * @param {string} params.password
 * @param {string} params.clientLoginState
 * @param {string} params.loginResponse
 * @param {string} params.serverIdentity
 * @returns {{finishLoginRequest: string, sessionKey: string, exportKey: string,
 *           serverStaticPublicKey: string}|undefined}
 */
export function finishLogin({ password, clientLoginState, loginResponse, serverIdentity }) {
    return client.finishLogin({
        password,
        clientLoginState,
        loginResponse,
        identifiers: { server: serverIdentity },
        keyStretching: KEY_STRETCHING,
    });
}
