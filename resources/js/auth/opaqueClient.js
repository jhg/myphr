/**
 * The only place in the project that calls `@serenity-kit/opaque` (Spec 0001 §10).
 *
 * It wraps three things that, spread over the screens, would end up diverging:
 *
 * 1. The **frozen KSF**. `keyStretching` goes in `finishRegistration` and in `finishLogin`, never
 *    in the `start*` calls (§5, "What breaks if the order is altered"): passing it in the `start`
 *    is ignored in silence and the registration stays tied to the package default, so every
 *    future login fails as "wrong password".
 * 2. The **`identifiers.server`**, which has to match character for character the server
 *    `OPAQUE_SERVER_IDENTITY`. It arrives in a `<meta>` of the panel `<head>`.
 * 3. The **pinning** of the profile and of the server public key before deriving anything (§5,
 *    step 5): during registration there is no `server_mac` yet and nothing else authenticates the server.
 */

import { client, ready } from '@serenity-kit/opaque';

/**
 * Argon2id v0x13, m=64 MiB, t=3, p=4: the parameters named by the
 * `OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1` profile (`docs/OPAQUE.md` §2).
 *
 * Frozen on purpose: if these numbers change without changing the profile name, everyone's login
 * behaves like a wrong password, with no hint that the problem is configuration (§7).
 */
export const KEY_STRETCHING = Object.freeze({
    'argon2id-custom': Object.freeze({ iterations: 3, memory: 65536, parallelism: 4 }),
});

/** Client configuration error. Told apart from "wrong password" on purpose. */
export class OpaqueConfigurationError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'OpaqueConfigurationError';
    }
}

/**
 * Reads a `<meta name="...">` from the document.
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
 * Public parameters published by the panel `<head>`.
 *
 * @returns {{profile: string, serverIdentity: string, serverPublicKey: string}}
 * @throws {OpaqueConfigurationError} If any is missing: without them there is no pinning possible
 *         and deriving anyway would be deriving against an unauthenticated server.
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
 * Checks the profile and the public key the server returns against the ones pinned on the page
 * (§5, step 5). It is called **before** `finishRegistration`, not after.
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

/** Resolves when the package WebAssembly is loaded (§5, step 1). */
export function opaqueReady() {
    return ready;
}

/**
 * `startRegistration` — without `keyStretching` (§5, step 3).
 *
 * @param {string} password
 * @returns {{clientRegistrationState: string, registrationRequest: string}}
 */
export function startRegistration(password) {
    return client.startRegistration({ password });
}

/**
 * `finishRegistration` — here, and only here, Argon2id runs (§5, step 6).
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
 * `startLogin` — without `keyStretching` (§6.1, step 3).
 *
 * @param {string} password
 * @returns {{clientLoginState: string, startLoginRequest: string}}
 */
export function startLogin(password) {
    return client.startLogin({ password });
}

/**
 * `finishLogin` (§6.1, step 5).
 *
 * It returns `undefined` —never `null`— when the password does not match, and it **throws** when
 * the KSF configuration is invalid. These are two different cases and the caller has to keep them
 * apart: the first is a mistake by the person, the second a deployment mistake.
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
