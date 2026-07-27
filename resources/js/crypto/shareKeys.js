/**
 * Key construction of the share link (ADR 0011).
 *
 * ```
 * stretched = Argon2id(v0x13, PIN as NFKC UTF-8, pinSalt, m=65536 KiB, t=3, p=4, dkLen=32)
 * pinTag    = HKDF-SHA-512(ikm=stretched,    salt=pinSalt, info="myphr/share-pin-tag/v1" || 0x00 || linkId, L=32)
 * wrapKey   = HKDF-SHA-512(ikm=S||stretched, salt=pinSalt,
 *                          info="myphr/share-link/v1" || 0x00 || linkId || 0x00 || canonicalDate(expiresAt), L=32)
 * ```
 *
 * **Why the PIN goes through Argon2id and not straight into HKDF.** A
 * six-digit PIN is one million possibilities: with HKDF, which has no
 * tunable cost, all of them are tried in seconds. Argon2id alone does not
 * fix a twenty-bit secret —that is why ADR 0011 verifies the PIN online and
 * counts five attempts in a column— but it makes the attack expensive for
 * whoever dumps the database and takes `pin_tag` away.
 *
 * **Why the two branches are branches and not two uses of the same output.**
 * `pinTag` travels to the server and is stored there; `wrapKey` never leaves
 * the browser. If they were the same value, storing the tag would be storing
 * the key. By hanging both off HKDF with different labels, knowing one does
 * not give the other; and since `wrapKey` also mixes in the 256 bits of `S`,
 * which live in the URL fragment and never reach the server, brute-forcing
 * the tag brings nobody closer to the content.
 *
 * **Why `linkId` and `expiresAt` go into the `info`.** They tie the key to
 * that one link and that one expiry: the server cannot reuse the material of
 * one link in another, nor stretch the life of one by changing the date,
 * because either of the two derives a different key and the envelope stops
 * opening.
 *
 * The Argon2id parameters are the same as the OPAQUE KSF (`docs/OPAQUE.md`
 * §17 and ADR 0004), to avoid keeping two cost profiles in the project.
 * They take more than a second on a recent laptop and several on a clinic
 * machine, so there is an async variant with progress.
 */

import { argon2id, argon2idAsync } from '@noble/hashes/argon2.js';

import { canonicalDate } from './canonicalDate.js';
import { deriveKey, KDF_LABELS, KEY_LENGTH } from './kdf.js';
import { joinWithSeparator } from './shareEnvelope.js';
import { zeroize } from './zeroize.js';

/** Argon2id profile, identical to the OPAQUE KSF. Not touched without bumping the label version. */
export const ARGON2_PARAMS = Object.freeze({ version: 0x13, m: 65536, t: 3, p: 4, dkLen: 32 });

/** Bytes of the per-link salt (column `share_links.pin_salt`). */
export const PIN_SALT_LENGTH = 16;

/** Length of `S`, the send key that travels in the URL fragment. */
export const SEND_KEY_LENGTH = KEY_LENGTH;

/** PIN digits. */
export const PIN_LENGTH = 6;

/** Possible PIN values: 000000..999999. */
const PIN_RANGE = 10 ** PIN_LENGTH;

/** One digit per position, already normalized. */
const PIN_PATTERN = /^[0-9]{6}$/;

/**
 * Largest multiple of `PIN_RANGE` that fits in 32 bits.
 *
 * **Modulo bias, and why plain `% 1000000` is not used.** A 32-bit integer
 * has 4,294,967,296 values, and 4,294,967,296 = 4,294 x 1,000,000 + 967,296.
 * Reducing modulo one million, PINs from 000000 to 967295 would come from
 * 4,295 generator values and those from 967296 to 999999 from only 4,294:
 * the first ones are 0.02% more likely. It is a small bias, but a measurable
 * one in a twenty-bit secret that also protects clinical data, and removing
 * it costs one loop: values above the last complete multiple are discarded
 * (rejection sampling) and the rest is reduced without bias. The loop ends
 * with probability 1 and in practice gets it right on the first try 99.977%
 * of the time.
 */
const UNBIASED_LIMIT = 4294967296 - (4294967296 % PIN_RANGE);

const TEXT_ENCODER = new TextEncoder();

/** Error of the link key construction. */
export class ShareKeyError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'ShareKeyError';
    }
}

/**
 * Generates the PIN: six CSPRNG digits without modulo bias.
 *
 * The application generates it and the person never picks it (ADR 0011): a
 * hand-picked PIN ends up being the patient's date of birth, and there the
 * five server attempts protect nothing.
 *
 * @returns {string} Exactly six digits, with leading zeros.
 */
export function generatePin() {
    const buffer = new Uint32Array(1);

    for (;;) {
        globalThis.crypto.getRandomValues(buffer);

        if (buffer[0] < UNBIASED_LIMIT) {
            return String(buffer[0] % PIN_RANGE).padStart(PIN_LENGTH, '0');
        }
    }
}

/**
 * Per-link salt: 16 random bytes (column `pin_salt`).
 *
 * @returns {Uint8Array}
 */
export function generatePinSalt() {
    return randomBytes(PIN_SALT_LENGTH);
}

/**
 * `S`, the send key: 32 bytes from `getRandomValues`, **never derived from
 * the master key** (ADR 0011). It travels in the URL fragment, which never
 * reaches the server, and it is what makes a database dump not enough.
 *
 * @returns {Uint8Array}
 */
export function generateSendKey() {
    return randomBytes(SEND_KEY_LENGTH);
}

/**
 * `CK`, the content key that encrypts the package: 32 bytes from
 * `getRandomValues`. It lives in the descriptor encrypted under the master
 * key, which is what allows rebuilding a link without redoing the clipping.
 *
 * @returns {Uint8Array}
 */
export function generateContentKey() {
    return randomBytes(KEY_LENGTH);
}

/**
 * Normalized form of the PIN before it enters Argon2id.
 *
 * NFKC is not decoration: a keyboard with a Chinese IME produces full-width
 * digits, which in UTF-8 are different bytes from the ASCII ones and would
 * derive another key. NFKC folds them back to the usual digits. Spaces on
 * both sides are trimmed too; they come along when the PIN is pasted from a message.
 *
 * @param {string} pin
 * @returns {string}
 * @throws {ShareKeyError} If it is not six digits after normalizing.
 */
export function normalizePin(pin) {
    if (typeof pin !== 'string') {
        throw new ShareKeyError('pin must be a string.');
    }

    const normalized = pin.normalize('NFKC').trim();

    if (!PIN_PATTERN.test(normalized)) {
        throw new ShareKeyError(`pin must be ${PIN_LENGTH} digits.`);
    }

    return normalized;
}

/**
 * Stretches the PIN with Argon2id. It blocks the thread for more than a
 * second: the interface uses `stretchPinAsync`.
 *
 * @param {object} params
 * @param {string} params.pin PIN exactly as the professional types it.
 * @param {Uint8Array} params.pinSalt Link salt, 16 bytes.
 * @returns {Uint8Array} 32 bytes.
 */
export function stretchPin({ pin, pinSalt }) {
    return argon2id(TEXT_ENCODER.encode(normalizePin(pin)), assertPinSalt(pinSalt), ARGON2_PARAMS);
}

/**
 * Same as `stretchPin`, yielding the thread between blocks so the progress
 * bar gets painted. `onProgress` receives the completed fraction, 0 to 1.
 *
 * On a clinic machine this is several seconds with someone waiting in front
 * of it (ADR 0011), so the alternative to showing progress is a frozen tab
 * that the professional takes for broken.
 *
 * @param {object} params
 * @param {string} params.pin
 * @param {Uint8Array} params.pinSalt
 * @param {(progress: number) => void} [params.onProgress]
 * @returns {Promise<Uint8Array>} 32 bytes.
 */
export async function stretchPinAsync({ pin, pinSalt, onProgress }) {
    return argon2idAsync(TEXT_ENCODER.encode(normalizePin(pin)), assertPinSalt(pinSalt), {
        ...ARGON2_PARAMS,
        ...(onProgress === undefined ? {} : { onProgress }),
    });
}

/**
 * Tag branch: the only part of this construction that travels to the server.
 *
 * @param {object} params
 * @param {Uint8Array} params.stretched Argon2id output.
 * @param {Uint8Array} params.pinSalt Link salt.
 * @param {string} params.linkId Link UUIDv4 (the one that travels in the URL).
 * @returns {Uint8Array} 32 bytes, the ones the server compares in constant time.
 */
export function derivePinTag({ stretched, pinSalt, linkId }) {
    assertStretched(stretched);

    return deriveKey({
        ikm: stretched,
        label: KDF_LABELS.SHARE_PIN_TAG,
        context: TEXT_ENCODER.encode(assertIdentifier(linkId, 'linkId')),
        salt: assertPinSalt(pinSalt),
    });
}

/**
 * Wrap key branch: it never leaves the browser.
 *
 * @param {object} params
 * @param {Uint8Array} params.stretched Argon2id output.
 * @param {Uint8Array} params.sendKey `S`, 32 bytes from the URL fragment.
 * @param {Uint8Array} params.pinSalt Link salt.
 * @param {string} params.linkId Link UUIDv4.
 * @param {Date|number|string} params.expiresAt Link expiry.
 * @returns {Uint8Array} 32 bytes.
 */
export function deriveWrapKey({ stretched, sendKey, pinSalt, linkId, expiresAt }) {
    assertStretched(stretched);

    if (!(sendKey instanceof Uint8Array) || sendKey.length !== SEND_KEY_LENGTH) {
        throw new ShareKeyError(`sendKey must be a Uint8Array of ${SEND_KEY_LENGTH} bytes.`);
    }

    /*
     * `S || stretched`: without `S`, attacking the wrapper would cost the same
     * as attacking the tag, and the server has the tag. With `S` it is missing
     * 256 bits it has never seen.
     */
    const ikm = new Uint8Array(sendKey.length + stretched.length);

    ikm.set(sendKey, 0);
    ikm.set(stretched, sendKey.length);

    try {
        return deriveKey({
            ikm,
            label: KDF_LABELS.SHARE_LINK,
            context: shareLinkContext({ linkId, expiresAt }),
            salt: assertPinSalt(pinSalt),
        });
    } finally {
        zeroize(ikm);
    }
}

/**
 * `linkId || 0x00 || canonicalDate(expiresAt)`, which is at once the
 * derivation context of `wrapKey` and the body of the wrapper associated data
 * (`shareLink.js` appends the package hash to it).
 *
 * @param {object} params
 * @param {string} params.linkId
 * @param {Date|number|string} params.expiresAt
 * @returns {Uint8Array}
 */
export function shareLinkContext({ linkId, expiresAt }) {
    return joinWithSeparator([
        TEXT_ENCODER.encode(assertIdentifier(linkId, 'linkId')),
        TEXT_ENCODER.encode(canonicalDate(expiresAt)),
    ]);
}

/**
 * Both branches at once, stretching the PIN only once.
 *
 * Use it when `S` and the expiry are already known. The reader flow may need
 * to split it in two —`pinTag` for the `open`, and `wrapKey` only afterwards,
 * with the expiry that response returns—, and that is what `stretchPinAsync`,
 * `derivePinTag` and `deriveWrapKey` are for separately: stretching the PIN
 * twice would be several seconds thrown away.
 *
 * @param {object} params
 * @param {string} params.pin
 * @param {Uint8Array} params.pinSalt
 * @param {string} params.linkId
 * @param {Date|number|string} params.expiresAt
 * @param {Uint8Array} params.sendKey
 * @param {(progress: number) => void} [params.onProgress]
 * @returns {Promise<{pinTag: Uint8Array, wrapKey: Uint8Array}>}
 */
export async function deriveShareLinkKeysAsync({ pin, pinSalt, linkId, expiresAt, sendKey, onProgress }) {
    const stretched = await stretchPinAsync({ pin, pinSalt, onProgress });

    try {
        return {
            pinTag: derivePinTag({ stretched, pinSalt, linkId }),
            wrapKey: deriveWrapKey({ stretched, sendKey, pinSalt, linkId, expiresAt }),
        };
    } finally {
        zeroize(stretched);
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
 * @param {Uint8Array} pinSalt
 * @returns {Uint8Array}
 */
function assertPinSalt(pinSalt) {
    if (!(pinSalt instanceof Uint8Array) || pinSalt.length !== PIN_SALT_LENGTH) {
        throw new ShareKeyError(`pinSalt must be a Uint8Array of ${PIN_SALT_LENGTH} bytes.`);
    }

    return pinSalt;
}

/**
 * @param {Uint8Array} stretched
 * @returns {void}
 */
function assertStretched(stretched) {
    if (!(stretched instanceof Uint8Array) || stretched.length !== ARGON2_PARAMS.dkLen) {
        throw new ShareKeyError(`stretched must be a Uint8Array of ${ARGON2_PARAMS.dkLen} bytes.`);
    }
}

/**
 * Identifiers go in lowercase, like the user identifier of ADR 0004: two
 * ways of writing the same UUID would derive two different keys depending on
 * who typed it.
 *
 * @param {string} value
 * @param {string} name
 * @returns {string}
 */
function assertIdentifier(value, name) {
    if (typeof value !== 'string' || value === '') {
        throw new ShareKeyError(`${name} must be a non-empty string.`);
    }

    return value.toLowerCase();
}
