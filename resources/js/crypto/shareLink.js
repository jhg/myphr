/**
 * The link wrapper: the small layer of ADR 0011, the one that ties a given
 * link to a given package.
 *
 * The wrapper is a plain ADR 0004 envelope (`v1.`, `crypto/envelope.js`)
 * encrypted with `wrapKey`, whose content is the 32 bytes of `CK`. Its
 * associated data is:
 *
 * ```
 * "myphr/share-link/v1" || 0x00 || linkId || 0x00 || canonicalDate(expiresAt) || 0x00 || sha512(package)
 * ```
 *
 * **Why the package hash is in there.** Without it, the server can serve the
 * wrapper of link A next to the package of B: `wrapKey` opens the wrapper, a
 * valid `CK` comes out, and with that `CK`... it would not open B's package,
 * true, but it would open any package that shared `CK`, and above all the
 * pairing is left to the server's discretion, which is exactly what
 * associated data exists to prevent. With the hash inside, the wrapper only
 * decrypts when it comes with the exact package it was created with: change
 * one byte of the package, or swap the whole package for someone else's, and
 * the tag fails before anything is shown on screen.
 *
 * That is the second lock of the system, complementary to the one of the
 * package itself (`shareEnvelope.js`), which is tied to `shareId` and to the
 * generation instant. Both layers have associated data, and neither can be moved.
 *
 * **What exactly is hashed**: the UTF-8 bytes of the transport string as it
 * arrives, `s1.` included. Hashing what is received instead of what is
 * decoded stops two different encodings of the same envelope from giving
 * different hashes, and makes the check possible before decoding anything.
 */

import { sha512 } from '@noble/hashes/sha2.js';

import { decodeBase64Url, encodeBase64Url } from './base64url.js';
import { open as openEnvelope, seal as sealEnvelope } from './envelope.js';
import { KDF_LABELS, KEY_LENGTH } from './kdf.js';
import { joinWithSeparator, ShareEnvelopeError, SHARE_PREFIX } from './shareEnvelope.js';
import { SEND_KEY_LENGTH, shareLinkContext } from './shareKeys.js';

const TEXT_ENCODER = new TextEncoder();

/** Length of the package hash inside the associated data. */
export const PACKAGE_DIGEST_LENGTH = 64;

/**
 * Hash of the package exactly as it travels.
 *
 * @param {string} packageEnvelope `s1.` + base64url.
 * @returns {Uint8Array} 64 bytes.
 * @throws {ShareEnvelopeError} If it is not a package with its prefix.
 */
export function sharePackageDigest(packageEnvelope) {
    if (typeof packageEnvelope !== 'string' || !packageEnvelope.startsWith(SHARE_PREFIX)) {
        throw new ShareEnvelopeError('Share package does not start with the s1. prefix.');
    }

    return sha512(TEXT_ENCODER.encode(packageEnvelope));
}

/**
 * Associated data of the wrapper.
 *
 * @param {object} params
 * @param {string} params.linkId Link UUIDv4, the one that travels in the URL.
 * @param {Date|number|string} params.expiresAt Link expiry.
 * @param {string} params.packageEnvelope `s1.` package it is paired with.
 * @returns {Uint8Array}
 */
export function shareWrapperContext({ linkId, expiresAt, packageEnvelope }) {
    return joinWithSeparator([
        TEXT_ENCODER.encode(KDF_LABELS.SHARE_LINK),
        shareLinkContext({ linkId, expiresAt }),
        sharePackageDigest(packageEnvelope),
    ]);
}

/**
 * Seals the wrapper: `CK` under `wrapKey`.
 *
 * @param {object} params
 * @param {Uint8Array} params.wrapKey Output of `deriveWrapKey`.
 * @param {Uint8Array} params.contentKey `CK`, 32 bytes.
 * @param {string} params.linkId
 * @param {Date|number|string} params.expiresAt
 * @param {string} params.packageEnvelope `s1.` package this link opens.
 * @returns {string} `v1.` + base64url, for the `share_links.wrapper` column.
 */
export function sealShareWrapper({ wrapKey, contentKey, linkId, expiresAt, packageEnvelope }) {
    assertKey(contentKey, 'contentKey');

    return sealEnvelope({
        key: wrapKey,
        plaintext: contentKey,
        associatedData: shareWrapperContext({ linkId, expiresAt, packageEnvelope }),
    });
}

/**
 * Opens the wrapper and returns `CK`.
 *
 * @param {object} params
 * @param {Uint8Array} params.wrapKey
 * @param {string} params.wrapper `wrapper` column exactly as the server serves it.
 * @param {string} params.linkId
 * @param {Date|number|string} params.expiresAt
 * @param {string} params.packageEnvelope Package received in the same response.
 * @returns {Uint8Array} `CK`, 32 bytes.
 * @throws {import('./envelope.js').EnvelopeError} If it does not open: wrong PIN,
 *         tampered link or expiry, or a package that is not its own. It is
 *         never silenced (ADR 0004).
 */
export function openShareWrapper({ wrapKey, wrapper, linkId, expiresAt, packageEnvelope }) {
    const contentKey = openEnvelope({
        key: wrapKey,
        envelope: wrapper,
        associatedData: shareWrapperContext({ linkId, expiresAt, packageEnvelope }),
    });

    assertKey(contentKey, 'contentKey');

    return contentKey;
}

/**
 * Fragment length in bytes: `S` plus the generation instant.
 *
 * **Why the instant travels here and is not set by the server.** Opening the
 * package means rebuilding its associated data, which is
 * `"myphr/share/v1" || 0x00 || shareId || 0x00 || canonicalDate(generatedAt)`,
 * and that has to be known **before** decrypting. `shareId` is a column and
 * the server knows it; the generation instant it does not know, because the
 * client picks it while building the clipping and no column stores it: ADR
 * 0011 lists the columns of `shares` one by one, and adding a `generated_at`
 * would add a new date in the clear to a table designed to carry no date it
 * did not need.
 *
 * So it travels in the fragment, the only channel that never reaches the
 * server. It costs eleven URL characters (43 → 54 in base64url) and in
 * exchange the reader does not depend on the server telling the truth about
 * anything that enters the crypto. Eight big-endian bytes with the epoch in
 * milliseconds: JavaScript `Date` has no more precision, and `canonicalDate`
 * of an epoch in milliseconds and of its `Date` give exactly the same string.
 */
export const SEND_FRAGMENT_LENGTH = SEND_KEY_LENGTH + 8;

/**
 * URL fragment: `S` and the generation instant of the clipping, together.
 *
 * The fragment never reaches the server, which is why `S` can travel there;
 * what it does reach is the professional's browser history, its cloud sync
 * and screenshots (ADR 0011, "Consequences"). This codec fixes none of that:
 * it only guarantees the bytes go and come back identical.
 *
 * @param {object} params
 * @param {Uint8Array} params.sendKey `S`, 32 bytes.
 * @param {Date|number} params.generatedAt Generation instant of the clipping.
 * @returns {string} base64url, without `#`.
 */
export function encodeShareFragment({ sendKey, generatedAt }) {
    assertKey(sendKey, 'sendKey');

    const milliseconds = generatedAt instanceof Date ? generatedAt.getTime() : generatedAt;

    if (!Number.isSafeInteger(milliseconds)) {
        throw new ShareEnvelopeError('generatedAt must be a Date or an epoch in milliseconds.');
    }

    const fragment = new Uint8Array(SEND_FRAGMENT_LENGTH);

    fragment.set(sendKey, 0);
    new DataView(fragment.buffer).setBigUint64(SEND_KEY_LENGTH, BigInt(milliseconds), false);

    return encodeBase64Url(fragment);
}

/**
 * @param {string} encoded What came in `location.hash`, already without `#`.
 * @returns {{sendKey: Uint8Array, generatedAt: Date}}
 * @throws {import('./base64url.js').Base64UrlError} If it is not canonical base64url.
 * @throws {ShareEnvelopeError} If its length is not the expected one.
 */
export function decodeShareFragment(encoded) {
    const bytes = decodeBase64Url(encoded, 'share fragment');

    if (bytes.length !== SEND_FRAGMENT_LENGTH) {
        throw new ShareEnvelopeError(`share fragment must be ${SEND_FRAGMENT_LENGTH} bytes.`);
    }

    const milliseconds = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .getBigUint64(SEND_KEY_LENGTH, false);

    if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ShareEnvelopeError('share fragment carries an out-of-range instant.');
    }

    return {
        sendKey: bytes.slice(0, SEND_KEY_LENGTH),
        generatedAt: new Date(Number(milliseconds)),
    };
}

/**
 * @param {Uint8Array} key
 * @param {string} name
 * @returns {void}
 */
function assertKey(key, name) {
    const expected = name === 'sendKey' ? SEND_KEY_LENGTH : KEY_LENGTH;

    if (!(key instanceof Uint8Array) || key.length !== expected) {
        throw new ShareEnvelopeError(`${name} must be a Uint8Array of ${expected} bytes.`);
    }
}
