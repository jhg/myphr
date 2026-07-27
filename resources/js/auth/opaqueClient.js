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

import { KEY_STRETCHING } from './opaqueProfile.js';

export { KEY_STRETCHING };

/**
 * The package is loaded with a **dynamic** `import()`, and that is the whole reason this cache
 * exists.
 *
 * `@serenity-kit/opaque` carries its WebAssembly inlined as base64: 413,647 characters, which was
 * 78 % of the panel's main bundle. Statically imported it travelled on **every** panel screen —
 * glucose, meals, the dashboard — and was decoded and compiled on each one, when the only four
 * screens that derive keys are sign-in, registration, set-password and change-password. Loading it
 * on demand takes it off the critical path of every other screen and off the first paint of the
 * panel.
 *
 * There is no new waiting point: every caller already awaited `opaqueReady()` before touching any
 * of this, because the WebAssembly always had to be compiled before the first call (§5, step 1).
 * The download now happens inside that same wait.
 *
 * @type {Promise<typeof import('@serenity-kit/opaque')>|null}
 */
let loading = null;

/**
 * Loads the package once and keeps the module, never a copy of anything derived from it.
 *
 * @returns {Promise<typeof import('@serenity-kit/opaque')>}
 */
function load() {
    loading ??= import('@serenity-kit/opaque').then(async (module) => {
        await module.ready;

        return module;
    });

    return loading;
}

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

/**
 * Resolves when the package and its WebAssembly are loaded and compiled (§5, step 1).
 *
 * Calling it early is free and worth it: it is the one part of the sign-in path that can be
 * prepared **before** the person presses the button, since it depends on nothing they type.
 *
 * @returns {Promise<void>}
 */
export async function opaqueReady() {
    await load();
}

/**
 * `startRegistration` — without `keyStretching` (§5, step 3).
 *
 * @param {string} password
 * @returns {Promise<{clientRegistrationState: string, registrationRequest: string}>}
 */
export async function startRegistration(password) {
    const { client } = await load();

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
 * @returns {Promise<{registrationRecord: string, exportKey: string, serverStaticPublicKey: string}>}
 */
export async function finishRegistration({
    password,
    clientRegistrationState,
    registrationResponse,
    serverIdentity,
}) {
    const { client } = await load();

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
 * @returns {Promise<{clientLoginState: string, startLoginRequest: string}>}
 */
export async function startLogin(password) {
    const { client } = await load();

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
 * @returns {Promise<{finishLoginRequest: string, sessionKey: string, exportKey: string,
 *           serverStaticPublicKey: string}|undefined>}
 */
export async function finishLogin({ password, clientLoginState, loginResponse, serverIdentity }) {
    const { client } = await load();

    return client.finishLogin({
        password,
        clientLoginState,
        loginResponse,
        identifiers: { server: serverIdentity },
        keyStretching: KEY_STRETCHING,
    });
}
