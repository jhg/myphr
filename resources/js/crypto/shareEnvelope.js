/**
 * Share package envelope: the `s1.` sibling format of ADR 0011.
 *
 * Transport: `s1.` followed by the binary envelope in base64url, no padding.
 * The header is **the same 64 bytes as ADR 0004** (`crypto/envelope.js`),
 * with the same algorithm and KDF identifiers, and only three things change:
 * the transport prefix, the padding ladder and one new flag.
 *
 * ```
 * offset  bytes  field
 *      0      1  format version                 (0x01)
 *      1      1  algorithm identifier           (0x01 = XChaCha20-Poly1305-IETF)
 *      2      1  KDF identifier                 (0x01 = HKDF-SHA-512)
 *      3      1  flags                          (bit 0 = padded, bit 1 = compressed)
 *      4      4  key identifier                 (reserved, always zero today)
 *      8     32  derivation salt
 *     40     24  nonce
 *     64      n  ciphertext || tag (16 bytes)
 * ```
 *
 * **Why a different prefix.** `EnvelopeValidator` (and its client sibling)
 * demands `v1.`, so the `s1.` prefix stops a share package from being
 * slipped into the `payload` column of an event, or the other way round. The
 * price, which ADR 0011 states plainly: both ADR 0002 guard rails abort any
 * long string that does not start with `v1.`, and that is why the package
 * **does not travel over Livewire** but over its own HTTP endpoint.
 *
 * **Its own multiplicative ladder**: 64 KiB, 256 KiB, 1 MiB and 4 MiB. The
 * ADR 0004 one stops at 4,092 bytes and three months of glucose readings are
 * about 110 KB. The high floor is what does the work: almost every real
 * clipping fits compressed inside 64 KiB and they are indistinguishable from
 * each other, so the server cannot subtract two exports of the same range to
 * isolate the weight of one clinical type. Each step being four times the
 * previous one keeps the number of steps at four: the fewer the steps, the
 * less information there is in knowing which one an export fell into.
 *
 * **Compress BEFORE padding, never after.** The order is not a performance
 * preference: compressing the already padded buffer would collapse the
 * padding zeros and the ciphertext would go back to the size of the real
 * content, which is exactly what the padding exists to hide. The order is
 * compress, pad, encrypt; and on opening, decrypt, unpad, decompress.
 * descomprimir.
 *
 * **One single envelope, no chunking** (ADR 0011). With chunks, a hostile
 * server that delivers all but the last one produces a coherent history
 * missing the week of the hypoglycaemias, without any tag failing. What acts
 * here as a commitment to the whole content is the plaintext itself: it
 * carries the event count, and `openSharePackage` rejects the package if
 * that number does not match the events it brings. That is why there is no
 * chunk manifest: there are no chunks to manifest.
 *
 * **Associated data**: `"myphr/share/v1" || 0x00 || shareId || 0x00 ||
 * canonicalDate(generatedAt)`, plus the whole header, just like in ADR 0004.
 * It carries no `user_id`, a deliberate exception in ADR 0011: the reader,
 * that is the professional, builds it, and putting it there would hand them
 * a stable patient identifier, correlatable across two different exports.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

import { decodeBase64Url, encodeBase64Url } from './base64url.js';
import { canonicalDate } from './canonicalDate.js';
import { deriveKey, KDF_LABELS, KEY_LENGTH } from './kdf.js';
import { zeroize } from './zeroize.js';
import {
    ALGORITHM_XCHACHA20_POLY1305,
    FLAG_PADDED,
    HEADER_LENGTH,
    KDF_HKDF_SHA512,
    KEY_ID_LENGTH,
    NONCE_LENGTH,
    SALT_LENGTH,
    TAG_LENGTH,
    ENVELOPE_VERSION,
} from './envelope.js';

/** Package transport prefix. Deliberately different from the `v1.` of ADR 0004. */
export const SHARE_PREFIX = 's1.';

/** Flag: the content is gzip compressed underneath the padding. */
export const FLAG_COMPRESSED = 0x02;

/** Bytes taken by the length prefix of the padding. */
const LENGTH_PREFIX = 4;

/** Padding ladder specific to ADR 0011: 64 KiB, 256 KiB, 1 MiB and 4 MiB. */
export const SHARE_PADDED_SIZES = Object.freeze([65536, 262144, 1048576, 4194304]);

/** Largest compressed content that fits in the biggest step. */
export const MAX_SHARE_PADDED_CONTENT = SHARE_PADDED_SIZES[SHARE_PADDED_SIZES.length - 1] - LENGTH_PREFIX;

/**
 * Expansion cap when decompressing. The AEAD already authenticates the
 * buffer before we get here, so a decompression bomb can only be built by
 * whoever holds the content key, that is the owner themselves. Even so the
 * limit is free and it keeps a format bug from taking down the
 * professional's tab in the middle of an appointment.
 */
export const MAX_DECOMPRESSED_LENGTH = 64 * 1024 * 1024;

/** Label of the package associated data (ADR 0011). */
export const SHARE_CONTEXT_LABEL = KDF_LABELS.SHARE;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Share envelope error. As in ADR 0004, it does not tell tampering from
 * corruption, because the client cannot either: in both cases it is a
 * visible error and never a package shown half-way.
 */
export class ShareEnvelopeError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'ShareEnvelopeError';
    }
}

/**
 * Associated data of the package, in bytes.
 *
 * `shareId` goes in lowercase and `generatedAt` in the canonical form of ADR
 * 0004 (`YYYY-MM-DDTHH:MM:SS.ffffffZ`), never formatted by hand: these bytes
 * must come out identical for whoever encrypts and whoever decrypts, and one
 * byte of difference is a failed decryption.
 *
 * @param {object} params
 * @param {string} params.shareId Package UUIDv4 (column `shares.id`).
 * @param {Date|number|string} params.generatedAt Generation instant of the clipping.
 * @returns {Uint8Array} `"myphr/share/v1" || 0x00 || shareId || 0x00 || canonicalDate(generatedAt)`.
 */
export function sharePackageContext({ shareId, generatedAt }) {
    return joinWithSeparator([
        TEXT_ENCODER.encode(SHARE_CONTEXT_LABEL),
        TEXT_ENCODER.encode(assertIdentifier(shareId, 'shareId')),
        TEXT_ENCODER.encode(canonicalDate(generatedAt)),
    ]);
}

/**
 * Joins parts with the `0x00` separator, the same one `deriveKey` uses.
 * Without a separator, two different pairs of values would produce the same
 * concatenation and therefore the same associated data.
 *
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
export function joinWithSeparator(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0) + Math.max(parts.length - 1, 0);
    const joined = new Uint8Array(length);
    let offset = 0;

    parts.forEach((part, index) => {
        if (index > 0) {
            joined[offset] = 0x00;
            offset += 1;
        }

        joined.set(part, offset);
        offset += part.length;
    });

    return joined;
}

/**
 * Pads to the first ladder step it fits in, with the real length in four
 * big-endian bytes in front.
 *
 * @param {Uint8Array} content Content **already compressed**.
 * @returns {Uint8Array} Length exactly one of `SHARE_PADDED_SIZES`.
 * @throws {ShareEnvelopeError} If it does not fit in the biggest step.
 */
export function padToShareLadder(content) {
    const needed = content.length + LENGTH_PREFIX;
    const size = SHARE_PADDED_SIZES.find((candidate) => candidate >= needed);

    if (size === undefined) {
        throw new ShareEnvelopeError(
            `Compressed package of ${content.length} bytes exceeds the largest share size (${MAX_SHARE_PADDED_CONTENT} bytes).`
        );
    }

    const padded = new Uint8Array(size);

    new DataView(padded.buffer).setUint32(0, content.length, false);
    padded.set(content, LENGTH_PREFIX);

    return padded;
}

/**
 * Removes the ladder padding.
 *
 * @param {Uint8Array} padded
 * @returns {Uint8Array}
 * @throws {ShareEnvelopeError} If the size is not a step or the declared length does not fit.
 */
export function unpadFromShareLadder(padded) {
    if (!SHARE_PADDED_SIZES.includes(padded.length)) {
        throw new ShareEnvelopeError(`Padded package of ${padded.length} bytes does not match any share size.`);
    }

    const declared = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0, false);

    if (declared > padded.length - LENGTH_PREFIX) {
        throw new ShareEnvelopeError('Padded package declares a length larger than its own size.');
    }

    return padded.slice(LENGTH_PREFIX, LENGTH_PREFIX + declared);
}

/**
 * Compresses with `CompressionStream('gzip')`, native in Safari 16.4 and
 * Chromium (ADR 0011), adding no dependency to the bundle.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function gzip(bytes) {
    return streamThrough(bytes, new CompressionStream('gzip'));
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 * @throws {ShareEnvelopeError} If the bytes are not valid gzip or they go past the expansion cap.
 */
export async function gunzip(bytes) {
    let decompressed;

    try {
        decompressed = await streamThrough(bytes, new DecompressionStream('gzip'));
    } catch {
        throw new ShareEnvelopeError('Package content is not valid gzip.');
    }

    if (decompressed.length > MAX_DECOMPRESSED_LENGTH) {
        throw new ShareEnvelopeError(`Package expands to more than ${MAX_DECOMPRESSED_LENGTH} bytes.`);
    }

    return decompressed;
}

/**
 * @param {Uint8Array} bytes
 * @param {TransformStream} transform
 * @returns {Promise<Uint8Array>}
 */
async function streamThrough(bytes, transform) {
    const writer = transform.writable.getWriter();
    const written = writer.write(bytes).then(() => writer.close());
    const collected = new Response(transform.readable).arrayBuffer();

    await written;

    return new Uint8Array(await collected);
}

/**
 * Seals the package from bytes already in the clear.
 *
 * @param {object} params
 * @param {Uint8Array} params.contentKey `CK`: 32 bytes from `getRandomValues`.
 * @param {Uint8Array|string} params.plaintext Package content.
 * @param {string} params.shareId Package UUIDv4.
 * @param {Date|number|string} params.generatedAt Generation instant.
 * @param {Uint8Array} [params.keyId] 4 reserved bytes; zeros by default.
 * @returns {Promise<string>} `s1.` + base64url.
 */
export async function sealSharePackageBytes({ contentKey, plaintext, shareId, generatedAt, keyId }) {
    assertKey(contentKey);

    const associatedData = sharePackageContext({ shareId, generatedAt });
    const salt = randomBytes(SALT_LENGTH);
    const nonce = randomBytes(NONCE_LENGTH);
    const header = new Uint8Array(HEADER_LENGTH);

    header[0] = ENVELOPE_VERSION;
    header[1] = ALGORITHM_XCHACHA20_POLY1305;
    header[2] = KDF_HKDF_SHA512;
    header[3] = FLAG_PADDED | FLAG_COMPRESSED;

    if (keyId !== undefined) {
        if (!(keyId instanceof Uint8Array) || keyId.length !== KEY_ID_LENGTH) {
            throw new ShareEnvelopeError(`keyId must be a Uint8Array of ${KEY_ID_LENGTH} bytes.`);
        }

        header.set(keyId, 4);
    }

    header.set(salt, 8);
    header.set(nonce, 8 + SALT_LENGTH);

    const content = toBytes(plaintext, 'plaintext');
    const compressed = await gzip(content);
    const padded = padToShareLadder(compressed);
    const packageKey = deriveKey({
        ikm: contentKey,
        label: KDF_LABELS.ENVELOPE,
        context: associatedData,
        salt,
    });

    try {
        const sealed = xchacha20poly1305(packageKey, nonce, aeadAssociatedData(header, associatedData)).encrypt(padded);
        const envelope = new Uint8Array(HEADER_LENGTH + sealed.length);

        envelope.set(header, 0);
        envelope.set(sealed, HEADER_LENGTH);

        return SHARE_PREFIX + encodeBase64Url(envelope);
    } finally {
        zeroize(packageKey, padded, compressed);
    }
}

/**
 * Opens the package and returns its bytes in the clear.
 *
 * @param {object} params
 * @param {Uint8Array} params.contentKey `CK`, exactly as it came out of the wrapper.
 * @param {string} params.envelope `s1.` + base64url.
 * @param {string} params.shareId Same identifier used to seal it.
 * @param {Date|number|string} params.generatedAt Same instant used to seal it.
 * @returns {Promise<Uint8Array>}
 * @throws {ShareEnvelopeError} Invalid prefix, base64url, header, step or tag.
 *         It is never silenced (ADR 0004).
 */
export async function openSharePackageBytes({ contentKey, envelope, shareId, generatedAt }) {
    assertKey(contentKey);

    if (typeof envelope !== 'string' || !envelope.startsWith(SHARE_PREFIX)) {
        throw new ShareEnvelopeError('Share package does not start with the s1. prefix.');
    }

    const bytes = decodeBase64Url(envelope.slice(SHARE_PREFIX.length), 'share package');

    if (bytes.length < HEADER_LENGTH + TAG_LENGTH + SHARE_PADDED_SIZES[0]) {
        throw new ShareEnvelopeError(`Share package is too short: ${bytes.length} bytes.`);
    }

    if (bytes[0] !== ENVELOPE_VERSION) {
        throw new ShareEnvelopeError(`Unsupported share package version: ${bytes[0]}.`);
    }

    if (bytes[1] !== ALGORITHM_XCHACHA20_POLY1305) {
        throw new ShareEnvelopeError(`Unsupported share package algorithm: ${bytes[1]}.`);
    }

    if (bytes[2] !== KDF_HKDF_SHA512) {
        throw new ShareEnvelopeError(`Unsupported share package KDF: ${bytes[2]}.`);
    }

    if ((bytes[3] & FLAG_PADDED) !== FLAG_PADDED) {
        throw new ShareEnvelopeError('Share package is not marked as padded.');
    }

    const header = bytes.slice(0, HEADER_LENGTH);
    const salt = bytes.slice(8, 8 + SALT_LENGTH);
    const nonce = bytes.slice(8 + SALT_LENGTH, HEADER_LENGTH);
    const sealed = bytes.slice(HEADER_LENGTH);

    if (!SHARE_PADDED_SIZES.includes(sealed.length - TAG_LENGTH)) {
        throw new ShareEnvelopeError(
            `Share package ciphertext of ${sealed.length} bytes does not match any share size.`
        );
    }

    const associatedData = sharePackageContext({ shareId, generatedAt });
    const packageKey = deriveKey({
        ikm: contentKey,
        label: KDF_LABELS.ENVELOPE,
        context: associatedData,
        salt,
    });

    let padded;

    try {
        padded = xchacha20poly1305(packageKey, nonce, aeadAssociatedData(header, associatedData)).decrypt(sealed);
    } catch {
        throw new ShareEnvelopeError(
            'Share package could not be decrypted: wrong key, wrong associated data, or corruption.'
        );
    } finally {
        zeroize(packageKey);
    }

    let compressed;

    try {
        compressed = unpadFromShareLadder(padded);
    } finally {
        zeroize(padded);
    }

    /*
     * The flag rules: today it always compresses, but a reader has to read
     * what the header says and not what it assumes, because the header is
     * authenticated and a future version might not compress.
     */
    if ((bytes[3] & FLAG_COMPRESSED) !== FLAG_COMPRESSED) {
        return compressed;
    }

    try {
        return await gunzip(compressed);
    } finally {
        zeroize(compressed);
    }
}

/**
 * Seals the package from the clipping body in the clear.
 *
 * The body carries the exact range, the generation instant, the event count
 * and the lists of included and excluded types (ADR 0011). `generatedAt`
 * comes from the body itself and not from a separate parameter, so that the
 * instant entering the associated data and the one the professional sees on
 * screen are the same by construction.
 *
 * @param {object} params
 * @param {Uint8Array} params.contentKey `CK`.
 * @param {string} params.shareId Package UUIDv4.
 * @param {{generatedAt: (Date|number|string), eventCount: number, events: unknown[]}} params.body
 * @returns {Promise<string>} `s1.` + base64url.
 * @throws {ShareEnvelopeError} If the body does not meet its own commitment.
 */
export async function sealSharePackage({ contentKey, shareId, body }) {
    assertShareBody(body);

    return sealSharePackageBytes({
        contentKey,
        plaintext: JSON.stringify({ ...body, generatedAt: canonicalDate(body.generatedAt) }),
        shareId,
        generatedAt: body.generatedAt,
    });
}

/**
 * Opens the package and returns its body already parsed.
 *
 * It checks two things the AEAD alone does not say out loud:
 *
 * 1. That `eventCount` matches the events it brings. This is the commitment
 *    that replaces the chunk manifest: without it, an incomplete delivery
 *    would read as a coherent history missing the bad week.
 * 2. That the `generatedAt` the server put outside the envelope is the same
 *    one inside. The reader needs the outside one to build the associated
 *    data, so it arrives over a channel the server controls; if it lied it
 *    would no longer decrypt, and this check also makes the error explicit.
 *
 * @param {object} params
 * @param {Uint8Array} params.contentKey `CK`.
 * @param {string} params.envelope `s1.` + base64url.
 * @param {string} params.shareId Package identifier.
 * @param {Date|number|string} params.generatedAt Announced generation instant.
 * @returns {Promise<object>} Body in the clear.
 * @throws {ShareEnvelopeError}
 */
export async function openSharePackage({ contentKey, envelope, shareId, generatedAt }) {
    const bytes = await openSharePackageBytes({ contentKey, envelope, shareId, generatedAt });
    let body;

    try {
        body = JSON.parse(TEXT_DECODER.decode(bytes));
    } catch {
        throw new ShareEnvelopeError('Share package content is not valid UTF-8 JSON.');
    } finally {
        zeroize(bytes);
    }

    assertShareBody(body);

    if (body.generatedAt !== canonicalDate(generatedAt)) {
        throw new ShareEnvelopeError('Share package was generated at a different instant than announced.');
    }

    return body;
}

/**
 * @param {any} body
 * @returns {void}
 * @throws {ShareEnvelopeError}
 */
export function assertShareBody(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new ShareEnvelopeError('Share package body must be an object.');
    }

    if (!Array.isArray(body.events)) {
        throw new ShareEnvelopeError('Share package body must carry an events array.');
    }

    if (!Number.isInteger(body.eventCount) || body.eventCount !== body.events.length) {
        throw new ShareEnvelopeError(
            `Share package declares ${body.eventCount} events but carries ${body.events.length}.`
        );
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

    throw new ShareEnvelopeError(`${name} must be a Uint8Array or a string.`);
}

/**
 * Identifiers go in lowercase, like the user identifier of ADR 0004: two
 * ways of writing the same UUID would produce two different associated data
 * and a failed decryption depending on who typed it.
 *
 * @param {string} value
 * @param {string} name
 * @returns {string}
 */
function assertIdentifier(value, name) {
    if (typeof value !== 'string' || value === '') {
        throw new ShareEnvelopeError(`${name} must be a non-empty string.`);
    }

    return value.toLowerCase();
}

/**
 * @param {Uint8Array} key
 * @returns {void}
 */
function assertKey(key) {
    if (!(key instanceof Uint8Array) || key.length !== KEY_LENGTH) {
        throw new ShareEnvelopeError(`contentKey must be a Uint8Array of ${KEY_LENGTH} bytes.`);
    }
}
