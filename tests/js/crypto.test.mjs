/**
 * Checks of the client crypto modules.
 *
 * Vitest is not installed and adding dependencies needs approval, so this uses Node's built-in
 * test runner.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    Base64UrlError,
    decodeBase64Url,
    decodeBase64UrlExactly,
    encodeBase64Url,
} from '../../resources/js/crypto/base64url.js';
import { canonicalDate, CanonicalDateError } from '../../resources/js/crypto/canonicalDate.js';
import {
    deriveKey,
    hkdfSha512,
    KDF_LABELS,
} from '../../resources/js/crypto/kdf.js';
import {
    ENVELOPE_PREFIX,
    EnvelopeError,
    HEADER_LENGTH,
    MAX_PADDED_CONTENT,
    open,
    openText,
    pad,
    PADDED_SIZES,
    seal,
    TAG_LENGTH,
    unpad,
} from '../../resources/js/crypto/envelope.js';
import { zeroize } from '../../resources/js/crypto/zeroize.js';

const key = () => new Uint8Array(32).fill(7);
const bytes = (...values) => new Uint8Array(values);

test('base64url: round trip without padding', () => {
    for (let length = 0; length <= 32; length += 1) {
        const input = new Uint8Array(length).map((_, index) => (index * 37) % 256);
        const encoded = encodeBase64Url(input);

        assert.match(encoded, /^[A-Za-z0-9_-]*$/);
        assert.deepEqual(decodeBase64Url(encoded), input);
    }
});

test('base64url: URL-safe alphabet, never the standard one', () => {
    assert.equal(encodeBase64Url(bytes(0xfb, 0xff)), '-_8');
    assert.deepEqual(decodeBase64Url('-_8'), bytes(0xfb, 0xff));
});

test('base64url: rejects padding, the standard alphabet and spaces', () => {
    for (const invalid of ['QQ==', 'QQ=', '+/8', 'QQ ', 'QQ\n', 'QQ\tQQ', 'Á']) {
        assert.throws(() => decodeBase64Url(invalid), Base64UrlError, `should reject ${JSON.stringify(invalid)}`);
    }
});

test('base64url: rejects an impossible length', () => {
    assert.throws(() => decodeBase64Url('A'), Base64UrlError);
    assert.throws(() => decodeBase64Url('AAAAA'), Base64UrlError);
});

test('base64url: rejects a non-canonical encoding (leftover bits)', () => {
    // "QQ" is the canonical form of 0x41. "QR".."QZ" decode to the same byte
    // with non-zero leftover bits.
    assert.deepEqual(decodeBase64Url('QQ'), bytes(0x41));

    for (const nonCanonical of ['QR', 'QZ', 'Qh', 'AAB']) {
        assert.throws(() => decodeBase64Url(nonCanonical), Base64UrlError, `should reject ${nonCanonical}`);
    }
});

test('base64url: exact length', () => {
    assert.deepEqual(decodeBase64UrlExactly('QQ', 1), bytes(0x41));
    assert.throws(() => decodeBase64UrlExactly('QQ', 32), Base64UrlError);
});

test('canonicalDate: always six digits, Z suffix', () => {
    assert.equal(canonicalDate(new Date(Date.UTC(2026, 6, 25, 9, 8, 7, 6))), '2026-07-25T09:08:07.006000Z');
    assert.equal(canonicalDate(new Date(Date.UTC(2026, 0, 1))), '2026-01-01T00:00:00.000000Z');
    assert.equal(canonicalDate(0), '1970-01-01T00:00:00.000000Z');
});

test('canonicalDate: keeps the microseconds of the string and normalizes the offset', () => {
    assert.equal(canonicalDate('2026-07-25T11:08:07.123456Z'), '2026-07-25T11:08:07.123456Z');
    assert.equal(canonicalDate('2026-07-25T13:08:07.123456+02:00'), '2026-07-25T11:08:07.123456Z');
    assert.equal(canonicalDate('2026-07-25 11:08:07.5Z'), '2026-07-25T11:08:07.500000Z');
    // It is truncated, never rounded: rounding would move the instant.
    assert.equal(canonicalDate('2026-07-25T11:08:07.1234569Z'), '2026-07-25T11:08:07.123456Z');
});

test('canonicalDate: rejects what is ambiguous or invalid', () => {
    for (const invalid of ['2026-07-25T11:08:07', '2026-07-25', 'not a date', '2026-02-30T00:00:00Z']) {
        assert.throws(() => canonicalDate(invalid), CanonicalDateError, `should reject ${invalid}`);
    }

    assert.throws(() => canonicalDate(new Date('nope')), CanonicalDateError);
});

test('kdf: HKDF-SHA-512 is deterministic and the label separates the uses', () => {
    const ikm = new Uint8Array(32).fill(1);
    const kek = deriveKey({ ikm, label: KDF_LABELS.KEK });

    assert.equal(kek.length, 32);
    assert.deepEqual(deriveKey({ ikm, label: KDF_LABELS.KEK }), kek);
    assert.notDeepEqual(deriveKey({ ikm, label: KDF_LABELS.SESSION }), kek);
    assert.notDeepEqual(deriveKey({ ikm, label: KDF_LABELS.KEK, context: 'x' }), kek);
    assert.notDeepEqual(deriveKey({ ikm, label: KDF_LABELS.KEK, salt: 'x' }), kek);
});

test('kdf: RFC 5869 has no SHA-512 vector, but the length and the empty salt behave', () => {
    const okm = hkdfSha512({ ikm: 'ikm', length: 64 });

    assert.equal(okm.length, 64);
    assert.deepEqual(hkdfSha512({ ikm: 'ikm', salt: new Uint8Array(0), length: 64 }), okm);
    assert.throws(() => hkdfSha512({ ikm: 'ikm', length: 0 }), RangeError);
});

test('envelope: the padding produces exactly the fixed sizes', () => {
    assert.deepEqual(PADDED_SIZES, [256, 1024, 4096]);

    for (const [contentLength, expected] of [[0, 256], [251, 256], [252, 256], [253, 1024], [1020, 1024], [1021, 4096], [4092, 4096]]) {
        assert.equal(pad(new Uint8Array(contentLength)).length, expected, `content of ${contentLength} bytes`);
    }

    assert.throws(() => pad(new Uint8Array(MAX_PADDED_CONTENT + 1)), EnvelopeError);
});

test('envelope: the padding is reversible', () => {
    for (const length of [0, 1, 200, 252, 253, 1000, 4092]) {
        const content = new Uint8Array(length).map((_, index) => index % 256);

        assert.deepEqual(unpad(pad(content)), content);
    }
});

test('envelope: round trip', () => {
    const associatedData = 'user:0198e2a0-0000-7000-8000-000000000000|2026-07-25T11:08:07.123456Z';
    const envelope = seal({ key: key(), plaintext: '{"v":1,"type":"glucose"}', associatedData });

    assert.ok(envelope.startsWith(ENVELOPE_PREFIX));
    assert.equal(openText({ key: key(), envelope, associatedData }), '{"v":1,"type":"glucose"}');
});

test('envelope: two encryptions of the same content give different envelopes', () => {
    const associatedData = 'ctx';

    assert.notEqual(
        seal({ key: key(), plaintext: 'same', associatedData }),
        seal({ key: key(), plaintext: 'same', associatedData })
    );
});

test('envelope: the envelope length does not depend on the content length within a fixed size', () => {
    const associatedData = 'ctx';
    const short = seal({ key: key(), plaintext: 'a', associatedData });
    const long = seal({ key: key(), plaintext: 'a'.repeat(200), associatedData });

    assert.equal(short.length, long.length);
});

test('envelope: the encrypted size is a fixed size plus header and tag', () => {
    const envelope = seal({ key: key(), plaintext: 'a', associatedData: 'ctx' });
    const raw = decodeBase64Url(envelope.slice(ENVELOPE_PREFIX.length));

    assert.equal(raw.length, HEADER_LENGTH + PADDED_SIZES[0] + TAG_LENGTH);
});

test('envelope: different associated data makes the decryption fail', () => {
    const envelope = seal({ key: key(), plaintext: 'secreto', associatedData: 'user:a|2026-07-25T00:00:00.000000Z' });

    assert.throws(
        () => open({ key: key(), envelope, associatedData: 'user:b|2026-07-25T00:00:00.000000Z' }),
        EnvelopeError
    );
    assert.throws(
        () => open({ key: key(), envelope, associatedData: 'user:a|2026-07-26T00:00:00.000000Z' }),
        EnvelopeError
    );
    assert.throws(() => open({ key: key(), envelope, associatedData: '' }), EnvelopeError);
});

test('envelope: a different key makes the decryption fail', () => {
    const envelope = seal({ key: key(), plaintext: 'secreto', associatedData: 'ctx' });

    assert.throws(() => open({ key: new Uint8Array(32).fill(8), envelope, associatedData: 'ctx' }), EnvelopeError);
});

test('envelope: any altered byte makes the decryption fail', () => {
    const associatedData = 'ctx';
    const envelope = seal({ key: key(), plaintext: 'secreto', associatedData });
    const raw = decodeBase64Url(envelope.slice(ENVELOPE_PREFIX.length));

    for (const index of [3, 4, 8, 40, HEADER_LENGTH, raw.length - 1]) {
        const tampered = Uint8Array.from(raw);

        tampered[index] ^= 0x01;

        assert.throws(
            () => open({ key: key(), envelope: ENVELOPE_PREFIX + encodeBase64Url(tampered), associatedData }),
            EnvelopeError,
            `byte ${index} should be authenticated`
        );
    }
});

test('envelope: rejects impossible prefixes, versions and sizes', () => {
    const envelope = seal({ key: key(), plaintext: 'x', associatedData: 'ctx' });

    assert.throws(() => open({ key: key(), envelope: envelope.slice(3), associatedData: 'ctx' }), EnvelopeError);
    assert.throws(() => open({ key: key(), envelope: 'v1.AAAA', associatedData: 'ctx' }), EnvelopeError);
    assert.throws(() => seal({ key: new Uint8Array(16), plaintext: 'x', associatedData: 'ctx' }), EnvelopeError);
});

test('zeroize: wipes and tolerates nulls', () => {
    const buffer = new Uint8Array([1, 2, 3]);

    zeroize(buffer, null, undefined);

    assert.deepEqual(buffer, new Uint8Array([0, 0, 0]));
});
