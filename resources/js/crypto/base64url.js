/**
 * URL-safe Base64 **without padding**, with strict and canonical decoding.
 *
 * Exact mirror of `app/Security/Opaque/Base64Url.php` (`docs/OPAQUE.md` §5):
 * same three rules, same byte-for-byte result for the same input.
 *
 * 1. Alphabet `A-Z a-z 0-9 - _` only: `=`, spaces, line breaks and the
 *    standard Base64 alphabet (`+`, `/`) are rejected.
 * 2. Congruent length: `length % 4 === 1` is impossible in Base64.
 * 3. Canonicity: the result is encoded again and must be exactly equal to
 *    the input, which rejects leftover bits other than zero in the last
 *    character.
 *
 * `atob` covers none of the three: it accepts padding, tolerates leftover
 * bits and does not know the URL-safe alphabet.
 */

/** URL-safe Base64 alphabet (RFC 4648 §5). */
const ALPHABET = /^[A-Za-z0-9_-]*$/;

/**
 * Encoding error. Kept apart from decryption errors so that callers can
 * tell "malformed input" from "does not decrypt".
 */
export class Base64UrlError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'Base64UrlError';
    }
}

/**
 * Encodes bytes as base64url without padding.
 *
 * @param {Uint8Array} bytes Bytes of any length (may be empty).
 * @returns {string} Only base64url alphabet characters, no `=`.
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
 * Decodes base64url without padding, strictly and canonically.
 *
 * @param {string} encoded String received from network, storage or DOM.
 * @param {string} [field] Field name, only for the error message.
 * @returns {Uint8Array} Decoded bytes.
 * @throws {Base64UrlError} Invalid alphabet, padding, spaces, impossible
 *         length or non-canonical encoding.
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
 * Decodes and demands an exact binary length, before any crypto is touched
 * (`docs/OPAQUE.md` §5).
 *
 * @param {string} encoded Received string.
 * @param {number} expectedLength Required binary length, in bytes.
 * @param {string} [field] Field name, only for the error message.
 * @returns {Uint8Array} Bytes of exactly `expectedLength`.
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
