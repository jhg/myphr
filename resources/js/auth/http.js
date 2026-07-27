/**
 * HTTP client of the authentication endpoints (Spec 0001 §4).
 *
 * Every request carries the CSRF token and `credentials: 'same-origin'`. The `login/finish`
 * response brings a new token, because `session()->regenerate()` regenerated the CSRF too: it
 * must be written into the `<meta>` **before** navigating (§5, step 19), or the next authenticated
 * POST answers 419 now and then.
 */

/** Transport or contract error. `status` is `null` when the request never went out. */
export class AuthRequestError extends Error {
    /**
     * @param {string} message
     * @param {number|null} status
     * @param {string|null} code Body `error` field, when there is one.
     */
    constructor(message, status = null, code = null) {
        super(message);
        this.name = 'AuthRequestError';
        this.status = status;
        this.code = code;
    }
}

/** @returns {HTMLMetaElement|null} */
function csrfMeta() {
    return document.head?.querySelector('meta[name="csrf-token"]') ?? null;
}

/** @returns {string} Current CSRF token, or an empty string if the page does not publish it. */
export function csrfToken() {
    return csrfMeta()?.getAttribute('content') ?? '';
}

/**
 * Writes the new CSRF token into the `<meta>` (§5, step 19).
 *
 * @param {string|undefined} token
 */
export function updateCsrfToken(token) {
    if (typeof token !== 'string' || token === '') {
        return;
    }

    csrfMeta()?.setAttribute('content', token);
}

/**
 * Request with a JSON body against a panel endpoint.
 *
 * The method and the extra headers are parameters so that the CSRF and `credentials:
 * 'same-origin'` keep living in a single place: a second HTTP client would be a second place to forget them.
 *
 * @param {string} method
 * @param {string} url
 * @param {object|undefined} body JSON body, or `undefined` to send none (`GET`).
 * @param {Record<string, string>} headers Extra headers (`If-Match`, for example).
 * @returns {Promise<any>} Decoded body of a 2xx response.
 * @throws {AuthRequestError} Any non-2xx response, any body that is not JSON and any network
 *         failure.
 */
async function sendJson(method, url, body, headers) {
    let response;

    /**
     * `fetch` throws a `TypeError` if a body is attached to a `GET`, so the body is left out when
     * there is none instead of sending the `"undefined"` that `JSON.stringify` would produce.
     */
    const request = {
        method,
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-TOKEN': csrfToken(),
            ...headers,
        },
    };

    if (body !== undefined) {
        request.body = JSON.stringify(body);
    }

    try {
        response = await fetch(url, request);
    } catch {
        throw new AuthRequestError('The request could not be sent.');
    }

    let payload = null;

    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const code = payload !== null && typeof payload.error === 'string' ? payload.error : null;

        throw new AuthRequestError(`Request to ${url} failed.`, response.status, code);
    }

    if (payload === null || typeof payload !== 'object') {
        throw new AuthRequestError(`Request to ${url} did not return JSON.`, response.status);
    }

    return payload;
}

/**
 * POST with a JSON body against a panel endpoint.
 *
 * @param {string} url
 * @param {object} [body]
 * @param {Record<string, string>} [headers]
 * @returns {Promise<any>}
 */
export function postJson(url, body = {}, headers = {}) {
    return sendJson('POST', url, body, headers);
}

/**
 * PUT with a JSON body against a panel endpoint.
 *
 * @param {string} url
 * @param {object} [body]
 * @param {Record<string, string>} [headers]
 * @returns {Promise<any>}
 */
export function putJson(url, body = {}, headers = {}) {
    return sendJson('PUT', url, body, headers);
}

/**
 * GET expecting JSON, with the same CSRF and the same credentials as the rest.
 *
 * The shared clippings listing uses it (ADR 0011). It goes through here and not through a loose
 * `fetch` so that the session and the token keep living in a single place: a second HTTP client
 * would be a second place to forget them.
 *
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<any>}
 */
export function getJson(url, headers = {}) {
    return sendJson('GET', url, undefined, headers);
}

/**
 * DELETE expecting JSON. The revocation of a shared clipping uses it (ADR 0011).
 *
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<any>}
 */
export function deleteJson(url, headers = {}) {
    return sendJson('DELETE', url, undefined, headers);
}
