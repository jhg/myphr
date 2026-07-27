/**
 * Checks of the link wrapper and of both layers together (ADR 0011).
 *
 * Argon2id is not used: the `wrapKey` is derived from a test `stretched`,
 * because what is checked here is the pairing between the two layers and not
 * the cost of the KDF (that is in `shareKeys.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalDate } from '../../resources/js/crypto/canonicalDate.js';
import { EnvelopeError } from '../../resources/js/crypto/envelope.js';
import { openSharePackage, sealSharePackage, ShareEnvelopeError } from '../../resources/js/crypto/shareEnvelope.js';
import { ARGON2_PARAMS, deriveWrapKey, PIN_SALT_LENGTH, SEND_KEY_LENGTH } from '../../resources/js/crypto/shareKeys.js';
import {
    decodeShareFragment,
    encodeShareFragment,
    openShareWrapper,
    sealShareWrapper,
    sharePackageDigest,
} from '../../resources/js/crypto/shareLink.js';

const SHARE_ID = '3f0c1e2a-1111-4444-8888-0123456789ab';
const OTHER_SHARE_ID = '99998888-7777-4444-8888-666655554444';
const LINK_ID = '7a1b2c3d-4444-4444-8888-99998888aaaa';
const OTHER_LINK_ID = '00001111-2222-4444-8888-333344445555';
const GENERATED_AT = '2026-07-27T08:15:00.000000Z';
const EXPIRES_AT = '2026-07-28T08:15:00.000000Z';

/** @returns {Uint8Array} Deterministic `CK`. */
function contentKey(seed = 5) {
    return new Uint8Array(32).map((_, index) => (index + seed) & 0xff);
}

/**
 * @param {string} linkId
 * @param {Date|number|string} expiresAt
 * @returns {Uint8Array} `wrapKey` of that link, without running Argon2id.
 */
function wrapKeyFor(linkId = LINK_ID, expiresAt = EXPIRES_AT) {
    return deriveWrapKey({
        stretched: new Uint8Array(ARGON2_PARAMS.dkLen).fill(0x2a),
        sendKey: new Uint8Array(SEND_KEY_LENGTH).fill(0x0b),
        pinSalt: new Uint8Array(PIN_SALT_LENGTH).fill(0x33),
        linkId,
        expiresAt,
    });
}

/**
 * @param {number} count
 * @param {string} generatedAt
 * @returns {object}
 */
function body(count = 2, generatedAt = GENERATED_AT) {
    return {
        v: 1,
        generatedAt,
        rangeFrom: '2026-04-27T00:00:00.000000Z',
        rangeTo: '2026-07-27T00:00:00.000000Z',
        includedTypes: ['glucose'],
        excludedTypes: [],
        eventCount: count,
        events: Array.from({ length: count }, (_, index) => ({ occurredAt: GENERATED_AT, value: index })),
    };
}

/**
 * A complete send: package encrypted with its `CK` and link wrapper.
 *
 * @param {object} [params]
 * @returns {Promise<{packageEnvelope: string, wrapper: string, contentKey: Uint8Array}>}
 */
async function buildShare({ shareId = SHARE_ID, linkId = LINK_ID, seed = 5 } = {}) {
    const key = contentKey(seed);
    const packageEnvelope = await sealSharePackage({ contentKey: key, shareId, body: body() });
    const wrapper = sealShareWrapper({
        wrapKey: wrapKeyFor(linkId),
        contentKey: key,
        linkId,
        expiresAt: EXPIRES_AT,
        packageEnvelope,
    });

    return { packageEnvelope, wrapper, contentKey: key };
}

test('both layers together: CK comes out of the wrapper and the clipping out of CK', async () => {
    const { packageEnvelope, wrapper } = await buildShare();

    const recovered = openShareWrapper({
        wrapKey: wrapKeyFor(),
        wrapper,
        linkId: LINK_ID,
        expiresAt: EXPIRES_AT,
        packageEnvelope,
    });

    assert.deepEqual(recovered, contentKey());

    const opened = await openSharePackage({
        contentKey: recovered,
        envelope: packageEnvelope,
        shareId: SHARE_ID,
        generatedAt: GENERATED_AT,
    });

    assert.equal(opened.eventCount, 2);
});

test('the package of another link does not open this wrapper: it is the package hash', async () => {
    const mine = await buildShare();
    const other = await buildShare({ shareId: OTHER_SHARE_ID, linkId: OTHER_LINK_ID, seed: 77 });

    /*
     * The attack this closes: the server serves my wrapper next to somebody
     * else's package. Without the hash inside the associated data, the wrapper
     * would open all the same and the professional would see a history that is
     * not the one they were shown.
     */
    assert.throws(
        () => openShareWrapper({
            wrapKey: wrapKeyFor(),
            wrapper: mine.wrapper,
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
            packageEnvelope: other.packageEnvelope,
        }),
        EnvelopeError
    );
});

test('changing a single byte of the package takes the wrapper down', async () => {
    const { packageEnvelope, wrapper } = await buildShare();
    const tampered = `${packageEnvelope.slice(0, -1)}${packageEnvelope.endsWith('A') ? 'B' : 'A'}`;

    assert.throws(
        () => openShareWrapper({
            wrapKey: wrapKeyFor(),
            wrapper,
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
            packageEnvelope: tampered,
        }),
        EnvelopeError
    );
});

test('changing the link identifier breaks the decryption', async () => {
    const { packageEnvelope, wrapper } = await buildShare();

    assert.throws(
        () => openShareWrapper({
            wrapKey: wrapKeyFor(),
            wrapper,
            linkId: OTHER_LINK_ID,
            expiresAt: EXPIRES_AT,
            packageEnvelope,
        }),
        EnvelopeError
    );
});

test('changing the expiry date breaks the decryption', async () => {
    const { packageEnvelope, wrapper } = await buildShare();

    /* With the right `wrapKey` and only the date of the associated data moved: it
     * still fails, because the date enters both parts. */
    assert.throws(
        () => openShareWrapper({
            wrapKey: wrapKeyFor(),
            wrapper,
            linkId: LINK_ID,
            expiresAt: '2026-08-28T08:15:00.000000Z',
            packageEnvelope,
        }),
        EnvelopeError
    );
});

test('stretching the expiry does not get through the key route either', async () => {
    const { packageEnvelope, wrapper } = await buildShare();

    assert.throws(
        () => openShareWrapper({
            wrapKey: wrapKeyFor(LINK_ID, '2026-08-28T08:15:00.000000Z'),
            wrapper,
            linkId: LINK_ID,
            expiresAt: '2026-08-28T08:15:00.000000Z',
            packageEnvelope,
        }),
        EnvelopeError
    );
});

test('a different PIN gives another wrapKey and the wrapper does not open', async () => {
    const { packageEnvelope, wrapper } = await buildShare();
    const wrongPinKey = deriveWrapKey({
        stretched: new Uint8Array(ARGON2_PARAMS.dkLen).fill(0x2b),
        sendKey: new Uint8Array(SEND_KEY_LENGTH).fill(0x0b),
        pinSalt: new Uint8Array(PIN_SALT_LENGTH).fill(0x33),
        linkId: LINK_ID,
        expiresAt: EXPIRES_AT,
    });

    assert.throws(
        () => openShareWrapper({
            wrapKey: wrongPinKey,
            wrapper,
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
            packageEnvelope,
        }),
        EnvelopeError
    );
});

test('the wrapper is a plain v1. envelope and travels like any other', async () => {
    const { wrapper } = await buildShare();

    assert.ok(wrapper.startsWith('v1.'));
});

test('sharePackageDigest: 64 bytes and only over an s1. package', async () => {
    const { packageEnvelope } = await buildShare();

    assert.equal(sharePackageDigest(packageEnvelope).length, 64);
    assert.throws(() => sharePackageDigest('v1.abc'), ShareEnvelopeError);
});

test('encodeShareFragment/decodeShareFragment: key and instant go and come back the same', () => {
    const sendKey = new Uint8Array(SEND_KEY_LENGTH).map((_, index) => index * 5);
    const generatedAt = new Date('2026-07-27T08:15:00.123Z');
    const encoded = encodeShareFragment({ sendKey, generatedAt });

    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeShareFragment(encoded), { sendKey, generatedAt });
});

/**
 * The instant of the fragment enters the associated data of the package, so what matters is not
 * that a similar `Date` comes back: it is that `canonicalDate` gives the same string byte for byte
 * as it gave when encrypting. One millisecond lost on the way is a package that does not open.
 */
test('decodeShareFragment keeps the instant down to the millisecond', () => {
    const sendKey = new Uint8Array(SEND_KEY_LENGTH).fill(7);
    const generatedAt = new Date('2026-07-27T08:15:00.007Z');

    const { generatedAt: roundTripped } = decodeShareFragment(encodeShareFragment({ sendKey, generatedAt }));

    assert.equal(canonicalDate(roundTripped), canonicalDate(generatedAt));
});

test('decodeShareFragment rejects a fragment whose length is not the expected one', () => {
    assert.throws(() => decodeShareFragment('AAAA'), ShareEnvelopeError);
});
