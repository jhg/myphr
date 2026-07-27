/**
 * Checks of the link key construction (ADR 0011).
 *
 * Almost everything is tested without going through Argon2id, feeding a deterministic
 * `stretched`: the real profile costs more than a second per call and adds
 * nothing to the tests of the HKDF branches. Only one test really runs it, and it is
 * the one checking that the async variant with progress gives the same as the
 * synchronous one.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
    ARGON2_PARAMS,
    derivePinTag,
    deriveWrapKey,
    generatePin,
    generatePinSalt,
    generateSendKey,
    normalizePin,
    PIN_SALT_LENGTH,
    SEND_KEY_LENGTH,
    ShareKeyError,
    stretchPin,
    stretchPinAsync,
} from '../../resources/js/crypto/shareKeys.js';

const LINK_ID = '7a1b2c3d-4444-4444-8888-99998888aaaa';
const OTHER_LINK_ID = '00001111-2222-4444-8888-333344445555';
const EXPIRES_AT = '2026-07-28T08:15:00.000000Z';

const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);

afterEach(() => {
    globalThis.crypto.getRandomValues = realGetRandomValues;
});

/** @returns {Uint8Array} Simulated Argon2id output, deterministic. */
function stretched(seed = 3) {
    return new Uint8Array(ARGON2_PARAMS.dkLen).map((_, index) => (index * 7 + seed) & 0xff);
}

/** @returns {Uint8Array} Link salt, deterministic. */
function pinSalt(seed = 1) {
    return new Uint8Array(PIN_SALT_LENGTH).map((_, index) => (index + seed) & 0xff);
}

/** @returns {Uint8Array} `S`, deterministic. */
function sendKey(seed = 11) {
    return new Uint8Array(SEND_KEY_LENGTH).map((_, index) => (index * 3 + seed) & 0xff);
}

/**
 * Replaces the CSPRNG with a list of 32-bit values, so the rejection sampling can be
 * watched instead of taken on trust.
 *
 * @param {number[]} values
 * @returns {{calls: number}}
 */
function stubRandomUint32(values) {
    const state = { calls: 0 };

    globalThis.crypto.getRandomValues = (buffer) => {
        const view = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);

        view[0] = values[state.calls];
        state.calls += 1;

        return buffer;
    };

    return state;
}

test('generatePin: six digits, with leading zeros', () => {
    for (let index = 0; index < 200; index += 1) {
        assert.match(generatePin(), /^[0-9]{6}$/);
    }
});

test('generatePin: discards the values that would introduce modulo bias', () => {
    /*
     * 4,294,967,296 = 4,294 x 1,000,000 + 967,296, so the last complete multiple
     * is 4,294,000,000. The first three values fall above it and have to be
     * discarded; the fourth is the one that decides the PIN.
     */
    const state = stubRandomUint32([4294967295, 4294000000, 4294500123, 42]);

    assert.equal(generatePin(), '000042');
    assert.equal(state.calls, 4);
});

test('generatePin: the largest accepted value still gives a valid PIN', () => {
    stubRandomUint32([4293999999]);

    assert.equal(generatePin(), '999999');
});

test('generatePin: the distribution does not clump on any final digit', () => {
    const buckets = new Array(10).fill(0);
    const draws = 20000;

    for (let index = 0; index < draws; index += 1) {
        buckets[Number(generatePin().slice(-1))] += 1;
    }

    /*
     * Deliberately loose bound: this detects a structural bias (a digit that
     * never comes out, or comes out twice as often), not a normal statistical
     * deviation, which would make the test flaky.
     */
    for (const count of buckets) {
        assert.ok(count > draws / 20, `un dígito final salió solo ${count} veces de ${draws}`);
    }
});

test('generatePinSalt and generateSendKey are the length the ADR states', () => {
    assert.equal(generatePinSalt().length, 16);
    assert.equal(generateSendKey().length, 32);
    assert.notDeepEqual(generateSendKey(), generateSendKey());
});

test('normalizePin: the full-width digits of the IME fold to ASCII', () => {
    assert.equal(normalizePin('１２３４５６'), '123456');
    assert.equal(normalizePin('  042042 '), '042042');
});

test('normalizePin: rejects anything that is not six digits', () => {
    assert.throws(() => normalizePin('12345'), ShareKeyError);
    assert.throws(() => normalizePin('12345a'), ShareKeyError);
    assert.throws(() => normalizePin(123456), ShareKeyError);
});

test('derivePinTag and deriveWrapKey do not produce the same value', () => {
    const salt = pinSalt();
    const pinTag = derivePinTag({ stretched: stretched(), pinSalt: salt, linkId: LINK_ID });
    const wrapKey = deriveWrapKey({
        stretched: stretched(),
        sendKey: sendKey(),
        pinSalt: salt,
        linkId: LINK_ID,
        expiresAt: EXPIRES_AT,
    });

    assert.equal(pinTag.length, 32);
    assert.equal(wrapKey.length, 32);
    assert.notDeepEqual(pinTag, wrapKey);
});

test('both branches are deterministic: same inputs, same outputs', () => {
    assert.deepEqual(
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: LINK_ID }),
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: LINK_ID })
    );
});

test('the link identifier is normalized to lowercase', () => {
    assert.deepEqual(
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: LINK_ID }),
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: LINK_ID.toUpperCase() })
    );
});

test('changing the link changes both branches', () => {
    assert.notDeepEqual(
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: LINK_ID }),
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: OTHER_LINK_ID })
    );

    assert.notDeepEqual(
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        }),
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: OTHER_LINK_ID,
            expiresAt: EXPIRES_AT,
        })
    );
});

test('changing the expiry changes the wrap key', () => {
    assert.notDeepEqual(
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        }),
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: '2026-07-28T08:15:00.000001Z',
        })
    );
});

test('the same expiry written another way derives the same key', () => {
    assert.deepEqual(
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        }),
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: '2026-07-28T10:15:00+02:00',
        })
    );
});

test('changing S or the salt changes the wrap key', () => {
    const base = deriveWrapKey({
        stretched: stretched(),
        sendKey: sendKey(),
        pinSalt: pinSalt(),
        linkId: LINK_ID,
        expiresAt: EXPIRES_AT,
    });

    assert.notDeepEqual(
        base,
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(12),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        })
    );

    assert.notDeepEqual(
        base,
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(2),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        })
    );
});

test('the input lengths are checked', () => {
    assert.throws(() => derivePinTag({ stretched: new Uint8Array(16), pinSalt: pinSalt(), linkId: LINK_ID }), ShareKeyError);
    assert.throws(() => derivePinTag({ stretched: stretched(), pinSalt: new Uint8Array(8), linkId: LINK_ID }), ShareKeyError);
    assert.throws(
        () => deriveWrapKey({
            stretched: stretched(),
            sendKey: new Uint8Array(8),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        }),
        ShareKeyError
    );
});

test('stretchPinAsync gives the same as stretchPin and reports progress along the way', async () => {
    const salt = pinSalt();
    const progress = [];
    const asynchronous = await stretchPinAsync({
        pin: '042042',
        pinSalt: salt,
        onProgress: (value) => progress.push(value),
    });

    assert.deepEqual(asynchronous, stretchPin({ pin: '042042', pinSalt: salt }));
    assert.equal(asynchronous.length, ARGON2_PARAMS.dkLen);
    assert.ok(progress.length > 0, 'la barra de progreso no recibió ninguna llamada');
    assert.ok(progress.every((value) => value >= 0 && value <= 1));
});
