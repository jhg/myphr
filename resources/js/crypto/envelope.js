/**
 * Versioned encrypted envelope from ADR 0004.
 *
 * Transport: `v1.` followed by the binary envelope in base64url, no padding.
 *
 * ```
 * offset  bytes  field
 *      0      1  format version                 (0x01)
 *      1      1  algorithm identifier           (0x01 = XChaCha20-Poly1305-IETF)
 *      2      1  KDF identifier                 (0x01 = HKDF-SHA-512)
 *      3      1  flags                          (bit 0 = padded content)
 *      4      4  key identifier                 (reserved, always zero today)
 *      8     32  derivation salt
 *     40     24  nonce
 *     64      n  ciphertext || tag (16 bytes)
 * ```
 *
 * The key identifier is reserved even though nothing uses it today: future
 * rotation and sharing would otherwise force re-encrypting the whole
 * history, and that is exactly what the server cannot do (ADR 0004).
 *
 * **Padding to fixed sizes before encrypting** (256, 1024, 4096 bytes). The
 * ciphertext length gives the content away: without padding, the server
 * sorts records by size without decrypting anything. The content is
 * prefixed with its length in four big-endian bytes and padded with zeros
 * up to the first size that fits.
 *
 * **Associated data**: supplied by the caller (ADR 0004 and ADR 0006 fix
 * which context belongs to each feature). It goes into two places at once:
 * the `info` of the envelope subkey derivation and the AEAD associated
 * data. The whole header goes into the associated data too, so changing a
 * flag or the key identifier invalidates the tag.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

import { decodeBase64Url, encodeBase64Url } from './base64url.js';
import { deriveKey, KDF_LABELS, KEY_LENGTH } from './kdf.js';
import { zeroize } from './zeroize.js';

/** Transport prefix, also checked by the ADR 0002 guard rail. */
export const ENVELOPE_PREFIX = 'v1.';

/** Format version inside the binary envelope. */
export const ENVELOPE_VERSION = 0x01;

/** XChaCha20-Poly1305-IETF. */
export const ALGORITHM_XCHACHA20_POLY1305 = 0x01;

/** HKDF-SHA-512. */
export const KDF_HKDF_SHA512 = 0x01;

/** Flag: the content is padded to a fixed size. */
export const FLAG_PADDED = 0x01;

export const KEY_ID_LENGTH = 4;
export const SALT_LENGTH = 32;
export const NONCE_LENGTH = 24;
export const TAG_LENGTH = 16;

/** Header: version, algorithm, KDF, flags, key id, salt and nonce. */
export const HEADER_LENGTH = 4 + KEY_ID_LENGTH + SALT_LENGTH + NONCE_LENGTH;

/** Bytes taken by the length prefix of the padding. */
const LENGTH_PREFIX = 4;

/** Fixed padding sizes from ADR 0004. */
export const PADDED_SIZES = Object.freeze([256, 1024, 4096]);

/** Largest content that fits in the biggest fixed size. */
export const MAX_PADDED_CONTENT = PADDED_SIZES[PADDED_SIZES.length - 1] - LENGTH_PREFIX;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Envelope error. It does not tell tampering from corruption, because the
 * client cannot either: ADR 0004 demands treating it as a visible error and
 * never hiding the record in silence.
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
 * Pads the content to the first fixed size it fits in.
 *
 * @param {Uint8Array} content
 * @returns {Uint8Array} Length exactly one of `PADDED_SIZES`.
 * @throws {EnvelopeError} If the content does not fit in the biggest size.
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
 * Removes the padding.
 *
 * @param {Uint8Array} padded
 * @returns {Uint8Array}
 * @throws {EnvelopeError} If the size or the declared length is not valid.
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
 * Seals an envelope.
 *
 * @param {object} params
 * @param {Uint8Array} params.key 32-byte key (KEK, session key or per-record
 *        key). It is not used directly: a subkey is derived with the salt of
 *        the envelope.
 * @param {Uint8Array|string} params.plaintext Content in the clear.
 * @param {Uint8Array|string} params.associatedData Record context
 *        (ADR 0004). It may be empty, but then the envelope is tied to
 *        nothing and can be moved between rows.
 * @param {Uint8Array} [params.keyId] 4 reserved bytes; zeros by default.
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
 * Opens an envelope.
 *
 * @param {object} params
 * @param {Uint8Array} params.key Same key used to seal it.
 * @param {string} params.envelope `v1.` + base64url.
 * @param {Uint8Array|string} params.associatedData Same context used to seal it.
 * @returns {Uint8Array} Content in the clear, without padding.
 * @throws {EnvelopeError} Invalid prefix, base64url, header, size or tag.
 *         The failure does not tell tampering from corruption and must
 *         never be silenced (ADR 0004).
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
 * Same as `seal`, with text content.
 *
 * @param {{key: Uint8Array, plaintext: string, associatedData: Uint8Array|string, keyId?: Uint8Array}} params
 * @returns {string}
 */
export function sealText(params) {
    return seal(params);
}

/**
 * Same as `open`, decoding the content as strict UTF-8.
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
