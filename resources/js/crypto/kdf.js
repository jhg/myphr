/**
 * HKDF-SHA-512 (RFC 5869) con las etiquetas versionadas del proyecto.
 *
 * Usa `@noble/hashes` 2.2.0, que produce byte a byte lo mismo que
 * `app/Security/Opaque/HkdfSha512.php` (`docs/OPAQUE.md` §17): ambos son
 * RFC 5869 sobre HMAC-SHA-512, así que los vectores cruzados son directos.
 *
 * Todas las etiquetas llevan versión en el propio texto. Cambiar el
 * significado de una derivación obliga a subir su versión, nunca a reutilizar
 * la etiqueta: dos usos distintos con la misma etiqueta producen la misma
 * clave para contextos distintos.
 */

import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha512 } from '@noble/hashes/sha2.js';

/** HashLen de SHA-512 en bytes (RFC 5869 §2). */
export const HASH_LENGTH = 64;

/** Longitud máxima de salida de Expand: 255 * HashLen (RFC 5869 §2.3). */
export const MAX_OUTPUT_LENGTH = 255 * HASH_LENGTH;

/** Longitud de una clave simétrica del proyecto (XChaCha20-Poly1305). */
export const KEY_LENGTH = 32;

/**
 * Etiquetas versionadas. La de la KEK está fijada por la spec
 * (`docs/specs/0001-account-provisioning-and-session-bootstrap.md` §5, paso 7).
 */
export const KDF_LABELS = Object.freeze({
    /** exportKey de OPAQUE -> Key Encryption Key que envuelve la UMK. */
    KEK: 'myphr/kek/v1',
    /** Secreto de sesión -> clave que envuelve la UMK en `sessionStorage`. */
    SESSION: 'myphr/session/v1',
    /** UMK -> clave por registro, con el contexto del registro concatenado. */
    RECORD: 'myphr/record/v1',
    /** UMK -> clave del sobre de configuración del usuario (ADR 0007). */
    SETTINGS: 'myphr/settings/v1',
    /** Clave del sobre -> subclave de ese sobre concreto, con su sal (ADR 0004). */
    ENVELOPE: 'myphr/envelope/v1',
});

const TEXT_ENCODER = new TextEncoder();

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

    throw new TypeError(`${name} must be a Uint8Array or a string.`);
}

/**
 * HKDF-Extract (RFC 5869 §2.2).
 *
 * @param {Uint8Array|string} salt Salt binario, posiblemente vacío.
 * @param {Uint8Array|string} ikm Input Keying Material.
 * @returns {Uint8Array} PRK de 64 bytes.
 */
export function hkdfExtract(salt, ikm) {
    return extract(sha512, toBytes(ikm, 'ikm'), toBytes(salt, 'salt'));
}

/**
 * HKDF-Expand (RFC 5869 §2.3).
 *
 * @param {Uint8Array} prk PRK de al menos 64 bytes.
 * @param {Uint8Array|string} info Contexto, posiblemente vacío.
 * @param {number} length L, entre 1 y 16320 bytes.
 * @returns {Uint8Array}
 */
export function hkdfExpand(prk, info, length) {
    assertLength(length);

    if (!(prk instanceof Uint8Array) || prk.length < HASH_LENGTH) {
        throw new TypeError(`prk must be a Uint8Array of at least ${HASH_LENGTH} bytes.`);
    }

    return expand(sha512, prk, toBytes(info, 'info'), length);
}

/**
 * HKDF completo (Extract + Expand) sobre SHA-512.
 *
 * @param {object} params
 * @param {Uint8Array|string} params.ikm Material de entrada.
 * @param {Uint8Array|string} [params.salt] Salt, vacío por defecto.
 * @param {Uint8Array|string} [params.info] Contexto, vacío por defecto.
 * @param {number} [params.length] Bytes de salida, 32 por defecto.
 * @returns {Uint8Array}
 */
export function hkdfSha512({ ikm, salt = new Uint8Array(0), info = new Uint8Array(0), length = KEY_LENGTH }) {
    assertLength(length);

    return expand(
        sha512,
        extract(sha512, toBytes(ikm, 'ikm'), toBytes(salt, 'salt')),
        toBytes(info, 'info'),
        length
    );
}

/**
 * Deriva una clave con una etiqueta versionada del proyecto y, opcionalmente,
 * el contexto del registro concatenado detrás.
 *
 * `info = label || 0x00 || context`. El separador impide que dos pares
 * (etiqueta, contexto) distintos produzcan el mismo `info` por concatenación.
 *
 * @param {object} params
 * @param {Uint8Array|string} params.ikm Material de entrada (exportKey, UMK...).
 * @param {string} params.label Una de `KDF_LABELS` (o cualquier etiqueta versionada).
 * @param {Uint8Array|string} [params.context] Contexto del registro (ADR 0004).
 * @param {Uint8Array|string} [params.salt] Salt, vacío por defecto.
 * @param {number} [params.length] Bytes de salida, 32 por defecto.
 * @returns {Uint8Array}
 */
export function deriveKey({ ikm, label, context, salt = new Uint8Array(0), length = KEY_LENGTH }) {
    if (typeof label !== 'string' || label === '') {
        throw new TypeError('label must be a non-empty string.');
    }

    const labelBytes = TEXT_ENCODER.encode(label);
    let info = labelBytes;

    if (context !== undefined && context !== null) {
        const contextBytes = toBytes(context, 'context');

        info = new Uint8Array(labelBytes.length + 1 + contextBytes.length);
        info.set(labelBytes, 0);
        info[labelBytes.length] = 0x00;
        info.set(contextBytes, labelBytes.length + 1);
    }

    return hkdfSha512({ ikm, salt, info, length });
}

/**
 * @param {number} length
 * @returns {void}
 */
function assertLength(length) {
    if (!Number.isInteger(length) || length < 1 || length > MAX_OUTPUT_LENGTH) {
        throw new RangeError(`HKDF output length must be an integer between 1 and ${MAX_OUTPUT_LENGTH}.`);
    }
}
