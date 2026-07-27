/**
 * HKDF-SHA-512 (RFC 5869) with the versioned labels of this project.
 *
 * Uses `@noble/hashes` 2.2.0, which produces byte for byte the same as
 * `app/Security/Opaque/HkdfSha512.php` (`docs/OPAQUE.md` §17): both are
 * RFC 5869 over HMAC-SHA-512, so cross test vectors are straightforward.
 *
 * Every label carries its version in the text itself. Changing the meaning
 * of a derivation forces a version bump, never a reuse of the label: two
 * different uses with the same label produce the same key for different
 * contexts.
 */

import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha512 } from '@noble/hashes/sha2.js';

/** SHA-512 HashLen in bytes (RFC 5869 §2). */
export const HASH_LENGTH = 64;

/** Maximum Expand output length: 255 * HashLen (RFC 5869 §2.3). */
export const MAX_OUTPUT_LENGTH = 255 * HASH_LENGTH;

/** Length of a symmetric key in this project (XChaCha20-Poly1305). */
export const KEY_LENGTH = 32;

/**
 * Versioned labels. The KEK one is fixed by the spec
 * (`docs/specs/0001-account-provisioning-and-session-bootstrap.md` §5, step 7).
 */
export const KDF_LABELS = Object.freeze({
    /** OPAQUE exportKey -> Key Encryption Key that wraps the UMK. */
    KEK: 'myphr/kek/v1',
    /** Session secret -> key that wraps the UMK in `sessionStorage`. */
    SESSION: 'myphr/session/v1',
    /** UMK -> per-record key, with the record context appended. */
    RECORD: 'myphr/record/v1',
    /** UMK -> key of the user configuration envelope (ADR 0007). */
    SETTINGS: 'myphr/settings/v1',
    /** Envelope key -> subkey of that one envelope, with its salt (ADR 0004). */
    ENVELOPE: 'myphr/envelope/v1',
    /** Associated data of the share package (ADR 0011). Derives no key: it labels the context. */
    SHARE: 'myphr/share/v1',
    /** Stretched PIN + send key -> key that wraps `CK` in a link (ADR 0011). */
    SHARE_LINK: 'myphr/share-link/v1',
    /** Stretched PIN -> tag the server compares before letting the request through (ADR 0011). */
    SHARE_PIN_TAG: 'myphr/share-pin-tag/v1',
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
 * @param {Uint8Array|string} salt Binary salt, possibly empty.
 * @param {Uint8Array|string} ikm Input Keying Material.
 * @returns {Uint8Array} 64-byte PRK.
 */
export function hkdfExtract(salt, ikm) {
    return extract(sha512, toBytes(ikm, 'ikm'), toBytes(salt, 'salt'));
}

/**
 * HKDF-Expand (RFC 5869 §2.3).
 *
 * @param {Uint8Array} prk PRK of at least 64 bytes.
 * @param {Uint8Array|string} info Context, possibly empty.
 * @param {number} length L, between 1 and 16320 bytes.
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
 * Full HKDF (Extract + Expand) over SHA-512.
 *
 * @param {object} params
 * @param {Uint8Array|string} params.ikm Input material.
 * @param {Uint8Array|string} [params.salt] Salt, empty by default.
 * @param {Uint8Array|string} [params.info] Context, empty by default.
 * @param {number} [params.length] Output bytes, 32 by default.
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
 * Derives a key with a versioned project label and, optionally, the record
 * context appended behind it.
 *
 * `info = label || 0x00 || context`. The separator stops two different
 * (label, context) pairs from producing the same `info` by concatenation.
 *
 * @param {object} params
 * @param {Uint8Array|string} params.ikm Input material (exportKey, UMK...).
 * @param {string} params.label One of `KDF_LABELS` (or any versioned label).
 * @param {Uint8Array|string} [params.context] Record context (ADR 0004).
 * @param {Uint8Array|string} [params.salt] Salt, empty by default.
 * @param {number} [params.length] Output bytes, 32 by default.
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
