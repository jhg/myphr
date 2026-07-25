/**
 * Sobre cifrado versionado del ADR 0004.
 *
 * Transporte: `v1.` seguido de base64url sin padding del sobre binario.
 *
 * ```
 * offset  bytes  campo
 *      0      1  versión del formato            (0x01)
 *      1      1  identificador de algoritmo     (0x01 = XChaCha20-Poly1305-IETF)
 *      2      1  identificador de KDF           (0x01 = HKDF-SHA-512)
 *      3      1  banderas                       (bit 0 = contenido rellenado)
 *      4      4  identificador de clave         (reservado, hoy siempre cero)
 *      8     32  sal de la derivación
 *     40     24  nonce
 *     64      n  ciphertext || tag (16 bytes)
 * ```
 *
 * El identificador de clave se reserva aunque hoy no se use: la rotación y la
 * compartición futuras exigirían si no re-cifrar todo el histórico, y eso es
 * justamente lo que el servidor no puede hacer (ADR 0004).
 *
 * **Relleno a tamaños fijos antes de cifrar** (256, 1024, 4096 bytes). La
 * longitud del ciphertext delata el contenido: sin relleno, el servidor
 * clasifica los registros por tamaño sin descifrar nada. El contenido se
 * prefija con su longitud en cuatro bytes big-endian y se rellena de ceros
 * hasta el primer tamaño que quepa.
 *
 * **Dato asociado**: lo aporta quien llama (ADR 0004 y ADR 0006 fijan qué
 * contexto es para cada funcionalidad). Entra en dos sitios a la vez: en el
 * `info` de la derivación de la subclave del sobre y en el dato asociado del
 * AEAD. La cabecera completa entra también en el dato asociado, de modo que
 * cambiar una bandera o el identificador de clave invalida el tag.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

import { decodeBase64Url, encodeBase64Url } from './base64url.js';
import { deriveKey, KDF_LABELS, KEY_LENGTH } from './kdf.js';
import { zeroize } from './zeroize.js';

/** Prefijo de transporte, comprobado también por el guardarraíl del ADR 0002. */
export const ENVELOPE_PREFIX = 'v1.';

/** Versión del formato dentro del sobre binario. */
export const ENVELOPE_VERSION = 0x01;

/** XChaCha20-Poly1305-IETF. */
export const ALGORITHM_XCHACHA20_POLY1305 = 0x01;

/** HKDF-SHA-512. */
export const KDF_HKDF_SHA512 = 0x01;

/** Bandera: el contenido va rellenado a tamaño fijo. */
export const FLAG_PADDED = 0x01;

export const KEY_ID_LENGTH = 4;
export const SALT_LENGTH = 32;
export const NONCE_LENGTH = 24;
export const TAG_LENGTH = 16;

/** Cabecera: versión, algoritmo, KDF, banderas, id de clave, sal y nonce. */
export const HEADER_LENGTH = 4 + KEY_ID_LENGTH + SALT_LENGTH + NONCE_LENGTH;

/** Bytes que consume el prefijo de longitud del relleno. */
const LENGTH_PREFIX = 4;

/** Tamaños fijos de relleno del ADR 0004. */
export const PADDED_SIZES = Object.freeze([256, 1024, 4096]);

/** Contenido máximo que cabe en el mayor de los tamaños fijos. */
export const MAX_PADDED_CONTENT = PADDED_SIZES[PADDED_SIZES.length - 1] - LENGTH_PREFIX;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Error del sobre. No distingue manipulación de corrupción, porque el cliente
 * tampoco puede: el ADR 0004 exige tratarlo como error visible y nunca ocultar
 * el registro en silencio.
 */
export class EnvelopeError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'EnvelopeError';
    }
}

/**
 * @param {number} length
 * @returns {Uint8Array}
 */
function randomBytes(length) {
    const bytes = new Uint8Array(length);

    globalThis.crypto.getRandomValues(bytes);

    return bytes;
}

/**
 * @param {Uint8Array|string} value
 * @param {string} name
 * @returns {Uint8Array}
 */
function toBytes(value, name) {
    if (value instanceof Uint8Array) {
        return value;
    }

    if (typeof value === 'string') {
        return TEXT_ENCODER.encode(value);
    }

    throw new EnvelopeError(`${name} must be a Uint8Array or a string.`);
}

/**
 * Rellena el contenido al primer tamaño fijo en que quepa.
 *
 * @param {Uint8Array} content
 * @returns {Uint8Array} Longitud exactamente uno de `PADDED_SIZES`.
 * @throws {EnvelopeError} Si el contenido no cabe en el mayor de los tamaños.
 */
export function pad(content) {
    const needed = content.length + LENGTH_PREFIX;
    const size = PADDED_SIZES.find((candidate) => candidate >= needed);

    if (size === undefined) {
        throw new EnvelopeError(
            `Content of ${content.length} bytes exceeds the largest fixed size (${MAX_PADDED_CONTENT} bytes of content).`
        );
    }

    const padded = new Uint8Array(size);
    const view = new DataView(padded.buffer);

    view.setUint32(0, content.length, false);
    padded.set(content, LENGTH_PREFIX);

    return padded;
}

/**
 * Quita el relleno.
 *
 * @param {Uint8Array} padded
 * @returns {Uint8Array}
 * @throws {EnvelopeError} Si el tamaño o la longitud declarada no son válidos.
 */
export function unpad(padded) {
    if (!PADDED_SIZES.includes(padded.length)) {
        throw new EnvelopeError(`Padded content has a size of ${padded.length} bytes, which is not a fixed size.`);
    }

    const declared = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0, false);

    if (declared > padded.length - LENGTH_PREFIX) {
        throw new EnvelopeError('Padded content declares a length larger than its own size.');
    }

    return padded.slice(LENGTH_PREFIX, LENGTH_PREFIX + declared);
}

/**
 * @param {Uint8Array} header
 * @param {Uint8Array} associatedData
 * @returns {Uint8Array}
 */
function aeadAssociatedData(header, associatedData) {
    const combined = new Uint8Array(header.length + associatedData.length);

    combined.set(header, 0);
    combined.set(associatedData, header.length);

    return combined;
}

/**
 * Cierra un sobre.
 *
 * @param {object} params
 * @param {Uint8Array} params.key Clave de 32 bytes (KEK, clave de sesión o
 *        clave por registro). No se usa directamente: se deriva una subclave
 *        con la sal del sobre.
 * @param {Uint8Array|string} params.plaintext Contenido en claro.
 * @param {Uint8Array|string} params.associatedData Contexto del registro
 *        (ADR 0004). Puede ser vacío, pero entonces el sobre no queda atado a
 *        nada y es movible entre filas.
 * @param {Uint8Array} [params.keyId] 4 bytes reservados; ceros por defecto.
 * @returns {string} `v1.` + base64url.
 */
export function seal({ key, plaintext, associatedData, keyId }) {
    assertKey(key);

    const salt = randomBytes(SALT_LENGTH);
    const nonce = randomBytes(NONCE_LENGTH);
    const header = new Uint8Array(HEADER_LENGTH);

    header[0] = ENVELOPE_VERSION;
    header[1] = ALGORITHM_XCHACHA20_POLY1305;
    header[2] = KDF_HKDF_SHA512;
    header[3] = FLAG_PADDED;

    if (keyId !== undefined) {
        if (!(keyId instanceof Uint8Array) || keyId.length !== KEY_ID_LENGTH) {
            throw new EnvelopeError(`keyId must be a Uint8Array of ${KEY_ID_LENGTH} bytes.`);
        }

        header.set(keyId, 4);
    }

    header.set(salt, 8);
    header.set(nonce, 8 + SALT_LENGTH);

    const associatedDataBytes = toBytes(associatedData, 'associatedData');
    const padded = pad(toBytes(plaintext, 'plaintext'));
    const envelopeKey = deriveKey({
        ikm: key,
        label: KDF_LABELS.ENVELOPE,
        context: associatedDataBytes,
        salt,
    });

    try {
        const sealed = xchacha20poly1305(
            envelopeKey,
            nonce,
            aeadAssociatedData(header, associatedDataBytes)
        ).encrypt(padded);

        const envelope = new Uint8Array(HEADER_LENGTH + sealed.length);

        envelope.set(header, 0);
        envelope.set(sealed, HEADER_LENGTH);

        return ENVELOPE_PREFIX + encodeBase64Url(envelope);
    } finally {
        zeroize(envelopeKey, padded);
    }
}

/**
 * Abre un sobre.
 *
 * @param {object} params
 * @param {Uint8Array} params.key Misma clave que se usó al cerrarlo.
 * @param {string} params.envelope `v1.` + base64url.
 * @param {Uint8Array|string} params.associatedData Mismo contexto que al cerrarlo.
 * @returns {Uint8Array} Contenido en claro, sin relleno.
 * @throws {EnvelopeError} Prefijo, base64url, cabecera, tamaño o tag inválidos.
 *         El fallo no distingue manipulación de corrupción y nunca debe
 *         silenciarse (ADR 0004).
 */
export function open({ key, envelope, associatedData }) {
    assertKey(key);

    if (typeof envelope !== 'string' || !envelope.startsWith(ENVELOPE_PREFIX)) {
        throw new EnvelopeError('Envelope does not start with the v1. prefix.');
    }

    const bytes = decodeBase64Url(envelope.slice(ENVELOPE_PREFIX.length), 'envelope');

    if (bytes.length < HEADER_LENGTH + TAG_LENGTH + PADDED_SIZES[0]) {
        throw new EnvelopeError(`Envelope is too short: ${bytes.length} bytes.`);
    }

    if (bytes[0] !== ENVELOPE_VERSION) {
        throw new EnvelopeError(`Unsupported envelope version: ${bytes[0]}.`);
    }

    if (bytes[1] !== ALGORITHM_XCHACHA20_POLY1305) {
        throw new EnvelopeError(`Unsupported envelope algorithm: ${bytes[1]}.`);
    }

    if (bytes[2] !== KDF_HKDF_SHA512) {
        throw new EnvelopeError(`Unsupported envelope KDF: ${bytes[2]}.`);
    }

    if ((bytes[3] & FLAG_PADDED) !== FLAG_PADDED) {
        throw new EnvelopeError('Envelope is not marked as padded.');
    }

    const header = bytes.slice(0, HEADER_LENGTH);
    const salt = bytes.slice(8, 8 + SALT_LENGTH);
    const nonce = bytes.slice(8 + SALT_LENGTH, HEADER_LENGTH);
    const sealed = bytes.slice(HEADER_LENGTH);

    if (!PADDED_SIZES.includes(sealed.length - TAG_LENGTH)) {
        throw new EnvelopeError(`Envelope ciphertext of ${sealed.length} bytes does not match any fixed size.`);
    }

    const associatedDataBytes = toBytes(associatedData, 'associatedData');
    const envelopeKey = deriveKey({
        ikm: key,
        label: KDF_LABELS.ENVELOPE,
        context: associatedDataBytes,
        salt,
    });

    let padded;

    try {
        padded = xchacha20poly1305(
            envelopeKey,
            nonce,
            aeadAssociatedData(header, associatedDataBytes)
        ).decrypt(sealed);
    } catch {
        throw new EnvelopeError('Envelope could not be decrypted: wrong key, wrong associated data, or corruption.');
    } finally {
        zeroize(envelopeKey);
    }

    try {
        return unpad(padded);
    } finally {
        zeroize(padded);
    }
}

/**
 * Igual que `seal`, con contenido de texto.
 *
 * @param {{key: Uint8Array, plaintext: string, associatedData: Uint8Array|string, keyId?: Uint8Array}} params
 * @returns {string}
 */
export function sealText(params) {
    return seal(params);
}

/**
 * Igual que `open`, decodificando el contenido como UTF-8 estricto.
 *
 * @param {{key: Uint8Array, envelope: string, associatedData: Uint8Array|string}} params
 * @returns {string}
 */
export function openText(params) {
    const bytes = open(params);

    try {
        return TEXT_DECODER.decode(bytes);
    } finally {
        zeroize(bytes);
    }
}

/**
 * @param {Uint8Array} key
 * @returns {void}
 */
function assertKey(key) {
    if (!(key instanceof Uint8Array) || key.length !== KEY_LENGTH) {
        throw new EnvelopeError(`key must be a Uint8Array of ${KEY_LENGTH} bytes.`);
    }
}
