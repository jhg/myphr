/**
 * Base64 URL-safe **sin padding** con decodificación estricta y canónica.
 *
 * Espejo exacto de `app/Security/Opaque/Base64Url.php` (`docs/OPAQUE.md` §5):
 * mismas tres reglas, mismo resultado byte a byte para la misma entrada.
 *
 * 1. Alfabeto `A-Z a-z 0-9 - _` únicamente: se rechazan `=`, espacios, saltos
 *    de línea y el alfabeto Base64 estándar (`+`, `/`).
 * 2. Longitud congruente: `length % 4 === 1` es imposible en Base64.
 * 3. Canonicidad: se vuelve a codificar el resultado y se exige igualdad
 *    exacta con la entrada, lo que rechaza los bits sobrantes distintos de
 *    cero en el último carácter.
 *
 * `atob` no cubre ninguna de las tres: acepta padding, tolera bits sobrantes
 * y no conoce el alfabeto URL-safe.
 */

/** Alfabeto Base64 URL-safe (RFC 4648 §5). */
const ALPHABET = /^[A-Za-z0-9_-]*$/;

/**
 * Error de codificación. Se distingue de los errores de descifrado para que
 * quien llama pueda separar "entrada malformada" de "no descifra".
 */
export class Base64UrlError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'Base64UrlError';
    }
}

/**
 * Codifica bytes en base64url sin padding.
 *
 * @param {Uint8Array} bytes Bytes de cualquier longitud (puede ser vacía).
 * @returns {string} Sólo caracteres del alfabeto base64url, sin `=`.
 */
export function encodeBase64Url(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        throw new Base64UrlError('encodeBase64Url expects a Uint8Array.');
    }

    let binary = '';

    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodifica base64url sin padding de forma estricta y canónica.
 *
 * @param {string} encoded Cadena recibida (red, almacenamiento o DOM).
 * @param {string} [field] Nombre del campo, sólo para el mensaje de error.
 * @returns {Uint8Array} Bytes decodificados.
 * @throws {Base64UrlError} Alfabeto inválido, padding, espacios, longitud
 *         imposible o codificación no canónica.
 */
export function decodeBase64Url(encoded, field = 'value') {
    if (typeof encoded !== 'string') {
        throw new Base64UrlError(`Field ${field} is not valid base64url.`);
    }

    if (!ALPHABET.test(encoded)) {
        throw new Base64UrlError(`Field ${field} is not valid base64url.`);
    }

    if (encoded.length % 4 === 1) {
        throw new Base64UrlError(`Field ${field} has an impossible base64url length.`);
    }

    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
        + '='.repeat((4 - (encoded.length % 4)) % 4);

    let binary;

    try {
        binary = atob(padded);
    } catch {
        throw new Base64UrlError(`Field ${field} is not valid base64url.`);
    }

    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    if (encodeBase64Url(bytes) !== encoded) {
        throw new Base64UrlError(`Field ${field} is not canonical base64url.`);
    }

    return bytes;
}

/**
 * Decodifica y exige una longitud binaria exacta, antes de tocar criptografía
 * (`docs/OPAQUE.md` §5).
 *
 * @param {string} encoded Cadena recibida.
 * @param {number} expectedLength Longitud binaria exigida, en bytes.
 * @param {string} [field] Nombre del campo, sólo para el mensaje de error.
 * @returns {Uint8Array} Bytes de longitud exactamente `expectedLength`.
 * @throws {Base64UrlError}
 */
export function decodeBase64UrlExactly(encoded, expectedLength, field = 'value') {
    const bytes = decodeBase64Url(encoded, field);

    if (bytes.length !== expectedLength) {
        throw new Base64UrlError(
            `Field ${field} must be ${expectedLength} bytes, got ${bytes.length}.`
        );
    }

    return bytes;
}
