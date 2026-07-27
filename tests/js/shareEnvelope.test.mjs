/**
 * Checks of the `s1.` envelope of the share package (ADR 0011).
 *
 * Node's built-in runner, like the rest of `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeBase64Url } from '../../resources/js/crypto/base64url.js';
import { HEADER_LENGTH, TAG_LENGTH } from '../../resources/js/crypto/envelope.js';
import {
    FLAG_COMPRESSED,
    MAX_SHARE_PADDED_CONTENT,
    openSharePackage,
    openSharePackageBytes,
    padToShareLadder,
    sealSharePackage,
    sealSharePackageBytes,
    SHARE_PADDED_SIZES,
    SHARE_PREFIX,
    ShareEnvelopeError,
    unpadFromShareLadder,
} from '../../resources/js/crypto/shareEnvelope.js';

const SHARE_ID = '3f0c1e2a-1111-4444-8888-0123456789ab';
const OTHER_SHARE_ID = '11112222-3333-4444-8888-cccccccccccc';
const GENERATED_AT = '2026-07-27T08:15:00.000000Z';

/** @returns {Uint8Array} Test `CK`, deterministic. */
function contentKey(seed = 7) {
    return new Uint8Array(32).map((_, index) => (index + seed) & 0xff);
}

/**
 * @param {number} count
 * @returns {object} Clipping body with the count commitment of ADR 0011.
 */
function body(count = 3) {
    return {
        v: 1,
        generatedAt: GENERATED_AT,
        rangeFrom: '2026-04-27T00:00:00.000000Z',
        rangeTo: '2026-07-27T00:00:00.000000Z',
        includedTypes: ['glucose', 'insulin'],
        excludedTypes: ['meal'],
        eventCount: count,
        events: Array.from({ length: count }, (_, index) => ({
            occurredAt: `2026-07-2${index}T09:00:00.000000Z`,
            type: 'glucose',
            data: { value: `1${index}2`, unit: 'mg/dL' },
        })),
    };
}

/**
 * @param {string} envelope
 * @returns {Uint8Array}
 */
function rawBytes(envelope) {
    return decodeBase64Url(envelope.slice(SHARE_PREFIX.length), 'envelope');
}

test('sealSharePackage/openSharePackage: the round trip returns the same body', async () => {
    const key = contentKey();
    const envelope = await sealSharePackage({ contentKey: key, shareId: SHARE_ID, body: body() });

    assert.ok(envelope.startsWith(SHARE_PREFIX));

    const opened = await openSharePackage({
        contentKey: key,
        envelope,
        shareId: SHARE_ID,
        generatedAt: GENERATED_AT,
    });

    assert.deepEqual(opened, body());
});

test('the package carries no v1. prefix, which is what stops it being slipped into an event', async () => {
    const envelope = await sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: body() });

    assert.ok(!envelope.startsWith('v1.'));
    await assert.rejects(
        () => openSharePackageBytes({
            contentKey: contentKey(),
            envelope: `v1.${envelope.slice(SHARE_PREFIX.length)}`,
            shareId: SHARE_ID,
            generatedAt: GENERATED_AT,
        }),
        ShareEnvelopeError
    );
});

test('changing the shareId makes the decryption fail', async () => {
    const key = contentKey();
    const envelope = await sealSharePackage({ contentKey: key, shareId: SHARE_ID, body: body() });

    await assert.rejects(
        () => openSharePackage({ contentKey: key, envelope, shareId: OTHER_SHARE_ID, generatedAt: GENERATED_AT }),
        ShareEnvelopeError
    );
});

test('changing the generation instant makes the decryption fail', async () => {
    const key = contentKey();
    const envelope = await sealSharePackage({ contentKey: key, shareId: SHARE_ID, body: body() });

    await assert.rejects(
        () => openSharePackage({
            contentKey: key,
            envelope,
            shareId: SHARE_ID,
            generatedAt: '2026-07-27T08:15:00.000001Z',
        }),
        ShareEnvelopeError
    );
});

test('the package of another clipping does not decrypt with this content key', async () => {
    const envelope = await sealSharePackage({
        contentKey: contentKey(99),
        shareId: OTHER_SHARE_ID,
        body: body(2),
    });

    await assert.rejects(
        () => openSharePackage({
            contentKey: contentKey(),
            envelope,
            shareId: OTHER_SHARE_ID,
            generatedAt: GENERATED_AT,
        }),
        ShareEnvelopeError
    );
});

test('a body declaring more events than it brings is rejected on opening', async () => {
    const key = contentKey();
    const truncated = body(3);

    /*
     * What a hostile server would want: delivering the history missing the bad
     * week. Here it is built with the content key itself, which is the worst
     * possible case, and even so the count commitment stops it.
     */
    truncated.events.pop();

    const envelope = await sealSharePackageBytes({
        contentKey: key,
        plaintext: JSON.stringify(truncated),
        shareId: SHARE_ID,
        generatedAt: GENERATED_AT,
    });

    await assert.rejects(
        () => openSharePackage({ contentKey: key, envelope, shareId: SHARE_ID, generatedAt: GENERATED_AT }),
        /declares 3 events but carries 2/
    );
});

test('sealing a body with the wrong count does not even get to be encrypted', async () => {
    await assert.rejects(
        () => sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: { ...body(3), eventCount: 4 } }),
        ShareEnvelopeError
    );
});

test('the generation instant inside has to be the one announced outside', async () => {
    const key = contentKey();
    const envelope = await sealSharePackageBytes({
        contentKey: key,
        plaintext: JSON.stringify({ ...body(1), generatedAt: '2020-01-01T00:00:00.000000Z' }),
        shareId: SHARE_ID,
        generatedAt: GENERATED_AT,
    });

    await assert.rejects(
        () => openSharePackage({ contentKey: key, envelope, shareId: SHARE_ID, generatedAt: GENERATED_AT }),
        /generated at a different instant/
    );
});

test('the ladder is multiplicative and goes from 64 KiB to 4 MiB', () => {
    assert.deepEqual([...SHARE_PADDED_SIZES], [65536, 262144, 1048576, 4194304]);

    for (let index = 1; index < SHARE_PADDED_SIZES.length; index += 1) {
        assert.equal(SHARE_PADDED_SIZES[index], SHARE_PADDED_SIZES[index - 1] * 4);
    }
});

test('a small clipping takes exactly the 64 KiB step', async () => {
    const envelope = await sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: body(1) });

    assert.equal(rawBytes(envelope).length, HEADER_LENGTH + SHARE_PADDED_SIZES[0] + TAG_LENGTH);
});

test('three events and three hundred fall in the same step: they are indistinguishable', async () => {
    const small = await sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: body(3) });
    const large = await sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: body(300) });

    assert.equal(rawBytes(small).length, rawBytes(large).length);
});

test('a clipping that does not fit compressed in 64 KiB moves up to the next step', async () => {
    /*
     * Deliberately incompressible content: gzip does not reduce it, so it forces
     * the step jump. It is the case the high floor cannot cover.
     */
    const noise = new Uint8Array(120000);

    /* `getRandomValues` accepts no more than 65,536 bytes per call. */
    for (let offset = 0; offset < noise.length; offset += 65536) {
        globalThis.crypto.getRandomValues(noise.subarray(offset, Math.min(offset + 65536, noise.length)));
    }

    const envelope = await sealSharePackageBytes({
        contentKey: contentKey(),
        plaintext: noise,
        shareId: SHARE_ID,
        generatedAt: GENERATED_AT,
    });

    assert.equal(rawBytes(envelope).length, HEADER_LENGTH + SHARE_PADDED_SIZES[1] + TAG_LENGTH);
});

test('the header marks compressed, because it compresses before padding', async () => {
    const envelope = await sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: body() });

    assert.equal(rawBytes(envelope)[3] & FLAG_COMPRESSED, FLAG_COMPRESSED);
});

test('the step is decided over the compressed content, not over the clear one', async () => {
    const large = body(1200);

    assert.ok(JSON.stringify(large).length > SHARE_PADDED_SIZES[0]);

    const envelope = await sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: large });

    /*
     * In the clear it would not fit in 64 KiB; compressed it does. If it were padded
     * before compressing, or the already padded buffer were compressed, this package
     * would end up in another step and the padding would stop hiding anything.
     */
    assert.equal(rawBytes(envelope).length, HEADER_LENGTH + SHARE_PADDED_SIZES[0] + TAG_LENGTH);
});

test('padToShareLadder/unpadFromShareLadder: round trip and ladder sizes', () => {
    const content = new Uint8Array(1000).fill(9);
    const padded = padToShareLadder(content);

    assert.equal(padded.length, SHARE_PADDED_SIZES[0]);
    assert.deepEqual(unpadFromShareLadder(padded), content);
});

test('padToShareLadder rejects what does not fit in the biggest step', () => {
    assert.throws(() => padToShareLadder(new Uint8Array(MAX_SHARE_PADDED_CONTENT + 1)), ShareEnvelopeError);
});

test('unpadFromShareLadder rejects a size that is not on the ladder', () => {
    assert.throws(() => unpadFromShareLadder(new Uint8Array(4096)), ShareEnvelopeError);
});
