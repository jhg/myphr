/**
 * Cliente HTTP de los endpoints de autenticación (Spec 0001 §4).
 *
 * Todas las peticiones llevan el token CSRF y `credentials: 'same-origin'`. La respuesta de
 * `login/finish` trae un token nuevo, porque `session()->regenerate()` regeneró también el CSRF:
 * hay que escribirlo en el `<meta>` **antes** de navegar (§5, paso 19), o el siguiente POST
 * autenticado responde 419 de forma intermitente.
 */

/** Error de transporte o de contrato. `status` es `null` cuando la petición ni salió. */
export class AuthRequestError extends Error {
    /**
     * @param {string} message
     * @param {number|null} status
     * @param {string|null} code Campo `error` del cuerpo, cuando lo hay.
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

/** @returns {string} Token CSRF vigente, o cadena vacía si la página no lo publica. */
export function csrfToken() {
    return csrfMeta()?.getAttribute('content') ?? '';
}

/**
 * Escribe el token CSRF nuevo en el `<meta>` (§5, paso 19).
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
 * Petición con cuerpo JSON contra un endpoint del panel.
 *
 * El método y las cabeceras extra son parámetros para que el CSRF y `credentials: 'same-origin'`
 * sigan viviendo en un único sitio: un segundo cliente HTTP sería un segundo sitio donde olvidarlos.
 *
 * @param {string} method
 * @param {string} url
 * @param {object} body
 * @param {Record<string, string>} headers Cabeceras adicionales (`If-Match`, por ejemplo).
 * @returns {Promise<any>} Cuerpo decodificado de una respuesta 2xx.
 * @throws {AuthRequestError} Cualquier respuesta no 2xx, cualquier cuerpo que no sea JSON y
 *         cualquier fallo de red.
 */
async function sendJson(method, url, body, headers) {
    let response;

    try {
        response = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-TOKEN': csrfToken(),
                ...headers,
            },
            body: JSON.stringify(body),
        });
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
 * POST con cuerpo JSON contra un endpoint del panel.
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
 * PUT con cuerpo JSON contra un endpoint del panel.
 *
 * @param {string} url
 * @param {object} [body]
 * @param {Record<string, string>} [headers]
 * @returns {Promise<any>}
 */
export function putJson(url, body = {}, headers = {}) {
    return sendJson('PUT', url, body, headers);
}
