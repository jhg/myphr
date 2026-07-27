/**
 * Checks of the pure logic of `health/sharePage.js` and of `health/shareDescriptor.js`
 * (ADR 0011).
 *
 * Neither Alpine nor the panel DOM is mounted: what is tested here is what decides what ends up
 * inside the clipping, which is the only thing on this screen that can go wrong in silence. That a
 * button calls `generate()` is checked by `tests/Feature/SharingPageTest.php` over the markup.
 *
 * Node's built-in runner, like the rest of `tests/js` (see `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { encode } from 'uqr';

import { adoptMasterKey, forget, MASTER_KEY_LENGTH } from '../../resources/js/auth/keyring.js';
import { decodeBase64Url } from '../../resources/js/crypto/base64url.js';
import { EnvelopeError } from '../../resources/js/crypto/envelope.js';
import { openSharePackage, sealSharePackage } from '../../resources/js/crypto/shareEnvelope.js';
import { generateContentKey, generateSendKey } from '../../resources/js/crypto/shareKeys.js';
import { decodeShareFragment } from '../../resources/js/crypto/shareLink.js';
import { setLocale } from '../../resources/js/i18n/index.js';
import {
    buildShareDescriptor,
    buildSharePackageBody,
    defaultTypeSelection,
    describeRange,
    describeReadError,
    describeShareError,
    expiryFor,
    partitionTypes,
    QR_BORDER_MODULES,
    QR_MIN_SIDE_PX,
    qrSvgFor,
    SHAREABLE_TYPES,
    shareUrlFor,
} from '../../resources/js/health/sharePage.js';
import { openShareDescriptor, sealShareDescriptor } from '../../resources/js/health/shareDescriptor.js';

/** Like the rest of the tests that assert text: the language is set, not assumed. */
setLocale('es');

const USER_ID = '9c8f2e2a-2222-4444-8888-abcdefabcdef';
const OTHER_USER_ID = '00000000-1111-4444-8888-000000000000';
const SHARE_ID = 'c0ffee00-1111-4444-8888-222233334444';
const OTHER_SHARE_ID = 'deadbeef-1111-4444-8888-222233334444';

/** @returns {Uint8Array} Test master key, 32 deterministic bytes. */
function testMasterKey() {
    return new Uint8Array(MASTER_KEY_LENGTH).map((_, index) => index + 1);
}

/**
 * @param {string} type
 * @param {string} occurredAt
 * @returns {{occurredAt: string, content: object}}
 */
function eventOf(type, occurredAt) {
    return { occurredAt, content: { v: 1, type, tz: '+02:00', data: { value: '120' } } };
}

afterEach(() => {
    forget();
});

// --- Type selection --------------------------------------------------------------------------------

test('defaultTypeSelection: it starts with every type ticked', () => {
    const selection = defaultTypeSelection();

    assert.deepEqual(Object.keys(selection), [...SHAREABLE_TYPES]);
    assert.ok(Object.values(selection).every((value) => value === true));
});

test('partitionTypes: the excluded ones are written out, not taken as implicit', () => {
    const { included, excluded } = partitionTypes({ glucose: true, insulin: true });

    assert.deepEqual(included, ['glucose', 'insulin']);

    /**
     * The four remaining ones appearing in `excluded` is the part that matters: the package has to
     * be able to tell the professional that the meals were not sent, instead of letting them read
     * the absence as a clinical zero.
     */
    assert.deepEqual(excluded, ['bloodPressure', 'meal', 'bodyWeight', 'temperature']);
});

test('partitionTypes: an empty selection includes nothing and excludes everything', () => {
    const { included, excluded } = partitionTypes({});

    assert.deepEqual(included, []);
    assert.deepEqual(excluded, [...SHAREABLE_TYPES]);
});

// --- Expiry ------------------------------------------------------------------------------------

const TTL_CATALOG = Object.freeze([
    { token: '1h', hours: 1 },
    { token: '24h', hours: 24 },
    { token: '7d', hours: 24 * 7 },
]);

test('expiryFor: the expiry is counted from now and in exact hours', () => {
    const now = new Date('2026-07-27T10:00:00.000Z');

    assert.equal(expiryFor('1h', TTL_CATALOG, now).toISOString(), '2026-07-27T11:00:00.000Z');
    assert.equal(expiryFor('24h', TTL_CATALOG, now).toISOString(), '2026-07-28T10:00:00.000Z');
    assert.equal(expiryFor('7d', TTL_CATALOG, now).toISOString(), '2026-08-03T10:00:00.000Z');
});

test('expiryFor: a TTL outside the closed list is not invented', () => {
    assert.throws(() => expiryFor('30d', TTL_CATALOG, new Date()), /caducidad/i);
});

// --- Package body --------------------------------------------------------------------------------

test('buildSharePackageBody: it carries range, date, count and the two type lists', () => {
    const events = [eventOf('glucose', '2026-07-20T08:00:00.000000Z'), eventOf('insulin', '2026-07-19T08:00:00.000000Z')];

    const body = buildSharePackageBody({
        events,
        included: ['glucose', 'insulin'],
        excluded: ['meal'],
        range: { from: '2026-07-01T00:00:00.000000Z', to: null },
        generatedAt: new Date('2026-07-27T10:00:00.000Z'),
    });

    assert.equal(body.v, 1);
    assert.equal(body.generatedAt, '2026-07-27T10:00:00.000000Z');
    assert.deepEqual(body.range, { from: '2026-07-01T00:00:00.000000Z', to: null });
    assert.deepEqual(body.includedTypes, ['glucose', 'insulin']);
    assert.deepEqual(body.excludedTypes, ['meal']);
    assert.equal(body.eventCount, 2);
    assert.equal(body.events.length, 2);
    assert.deepEqual(body.events[0], events[0]);
});

test('buildSharePackageBody: the body seals and opens with the real `s1.` envelope', async () => {
    /**
     * The `eventCount === events.length` commitment is what replaces the manifest that would be
     * needed if the package were chunked, and what checks it is `assertShareBody()` inside the
     * envelope module. This test exists so that the shape the screen builds and the shape the
     * envelope demands cannot diverge without something failing.
     */
    const contentKey = generateContentKey();
    const generatedAt = new Date('2026-07-27T10:00:00.000Z');

    const body = buildSharePackageBody({
        events: [eventOf('glucose', '2026-07-20T08:00:00.000000Z')],
        included: ['glucose'],
        excluded: ['meal'],
        range: { from: null, to: null },
        generatedAt,
    });

    const envelope = await sealSharePackage({ contentKey, shareId: SHARE_ID, body });

    assert.ok(envelope.startsWith('s1.'));

    const opened = await openSharePackage({
        contentKey,
        envelope,
        shareId: SHARE_ID,
        generatedAt,
    });

    assert.deepEqual(opened, body);
});

// --- Descriptor ----------------------------------------------------------------------------------

test('buildShareDescriptor: it carries CK and what the list needs, and no event', () => {
    const contentKey = generateContentKey();
    const body = buildSharePackageBody({
        events: [eventOf('glucose', '2026-07-20T08:00:00.000000Z')],
        included: ['glucose'],
        excluded: ['meal'],
        range: { from: '2026-07-01T00:00:00.000000Z', to: null },
        generatedAt: new Date('2026-07-27T10:00:00.000Z'),
    });

    const descriptor = buildShareDescriptor({
        contentKey,
        body,
        expiresAt: new Date('2026-07-28T10:00:00.000Z'),
    });

    assert.deepEqual(decodeBase64Url(descriptor.contentKey), contentKey);
    assert.equal(descriptor.expiresAt, '2026-07-28T10:00:00.000000Z');
    assert.deepEqual(descriptor.range, body.range);
    assert.deepEqual(descriptor.includedTypes, ['glucose']);
    assert.deepEqual(descriptor.excludedTypes, ['meal']);
    assert.equal(descriptor.eventCount, 1);

    /** The events do NOT enter the descriptor: the list does not need them and they would weigh for nothing. */
    assert.equal(descriptor.events, undefined);
});

test('sealShareDescriptor/openShareDescriptor: round trip under the master key', () => {
    adoptMasterKey(testMasterKey(), USER_ID);

    const descriptor = { v: 1, contentKey: 'AAAA', includedTypes: ['glucose'] };
    const envelope = sealShareDescriptor({ userId: USER_ID, shareId: SHARE_ID, descriptor });

    assert.ok(envelope.startsWith('v1.'), 'el descriptor es un sobre v1. corriente del ADR 0004');
    assert.deepEqual(openShareDescriptor({ userId: USER_ID, shareId: SHARE_ID, envelope }), descriptor);
});

test('openShareDescriptor: the envelope is tied to its user and to its clipping', () => {
    adoptMasterKey(testMasterKey(), USER_ID);

    const envelope = sealShareDescriptor({
        userId: USER_ID,
        shareId: SHARE_ID,
        descriptor: { v: 1, contentKey: 'AAAA' },
    });

    /**
     * Changing either half of the associated data has to **fail**, not return the descriptor of
     * another clipping: it is what stops the server moving a descriptor between rows.
     */
    assert.throws(
        () => openShareDescriptor({ userId: USER_ID, shareId: OTHER_SHARE_ID, envelope }),
        EnvelopeError
    );
    assert.throws(
        () => openShareDescriptor({ userId: OTHER_USER_ID, shareId: SHARE_ID, envelope }),
        EnvelopeError
    );
});

test('openShareDescriptor: the identifier in uppercase opens the same envelope', () => {
    /**
     * The `id` is generated by `crypto.randomUUID()` in lowercase, but the one coming back from
     * the listing might not be. If the context did not normalize, the list would stop being able
     * to open its own descriptors the day the server changed the case.
     */
    adoptMasterKey(testMasterKey(), USER_ID);

    const envelope = sealShareDescriptor({
        userId: USER_ID,
        shareId: SHARE_ID,
        descriptor: { v: 1 },
    });

    assert.deepEqual(
        openShareDescriptor({ userId: USER_ID.toUpperCase(), shareId: SHARE_ID.toUpperCase(), envelope }),
        { v: 1 }
    );
});

// --- Link and QR ---------------------------------------------------------------------------------

const TEMPLATE = 'https://phr.example.org/s/{link}';
const LINK_ID = '8f14e45f-ceea-4a7a-9f2c-cbd9e4d38ab7';

test('shareUrlFor: the send key and the instant go in the fragment and come back whole', () => {
    const sendKey = generateSendKey();
    const generatedAt = new Date('2026-07-27T10:00:00.000Z');
    const url = shareUrlFor({ template: TEMPLATE, linkId: LINK_ID, sendKey, generatedAt });

    assert.ok(url.startsWith(`https://phr.example.org/s/${LINK_ID}#`));

    /**
     * The fragment does not travel to the server, and it is the half that makes a database dump
     * not enough. That it comes back byte for byte is what makes the link useful; the instant
     * travels with it because the reader needs it to rebuild the associated data of the package.
     */
    assert.deepEqual(decodeShareFragment(url.slice(url.indexOf('#') + 1)), { sendKey, generatedAt });
});

test('the QR encodes the COMPLETE link and fits with room to spare', () => {
    const sendKey = generateSendKey();
    const url = shareUrlFor({ template: TEMPLATE, linkId: LINK_ID, sendKey, generatedAt: new Date() });

    const encoded = encode(url, { ecc: 'M' });

    /**
     * Version 6 (43x43 modules) with correction M takes 134 bytes in byte mode. A typical URL is
     * ~106 characters, so almost thirty are left for a longer domain before going up a version.
     * The ceiling is asserted, not the exact value: going up a version is not a failure, but going
     * past 10 would mean the URL grew with nobody looking.
     */
    assert.ok(encoded.version <= 10, `el QR necesitó la versión ${encoded.version}`);
    assert.ok(url.length < 134, `la URL mide ${url.length} caracteres`);

    const svg = qrSvgFor(url);

    /** White background inside the SVG itself: the QR does not switch with the dark theme. */
    assert.match(svg, /<rect fill="#FFFFFF"/);
    assert.match(svg, /fill="#000000"/);

    /**
     * Quiet zone of four modules and a minimum side of 400 px: both are requirements for reading
     * from across a table, not style decisions.
     */
    assert.equal(QR_BORDER_MODULES, 4);
    assert.ok(QR_MIN_SIDE_PX >= 400);

    /**
     * The `size` of `uqr` already counts the border, so the quiet zone is checked by seeing how
     * much the side grows when asking for four modules instead of the default one: six modules
     * more (three per side) is exactly the difference between 1 and 4 on each side.
     */
    const bordered = encode(url, { ecc: 'M', border: QR_BORDER_MODULES });

    assert.equal(bordered.size, encoded.size + (QR_BORDER_MODULES - 1) * 2);

    const side = bordered.size * 12;
    assert.match(svg, new RegExp(`viewBox="0 0 ${side} ${side}"`));
});

// --- Text of the list ---------------------------------------------------------------------------

test('describeRange: an open range is said with words, not with a gap', () => {
    assert.equal(describeRange({ from: null, to: null }), 'Todo tu historial');
    assert.match(describeRange({ from: '2026-07-01T00:00:00.000000Z', to: null }), /^Desde /);
    assert.match(describeRange({ from: null, to: '2026-07-31T00:00:00.000000Z' }), /^Hasta /);
    assert.match(
        describeRange({ from: '2026-07-01T00:00:00.000000Z', to: '2026-07-31T00:00:00.000000Z' }),
        /^Del .* al /
    );
});

// --- What whoever shares is told when something fails --------------------------------------------

/**
 * A read that fails is not an encryption that fails, and the screen used to say the second.
 *
 * Livewire rejects with a bare `{status, body, json, errors}`, which is not an `Error`, so it fell
 * through every named case of `describeShareError` and landed on "the clipping could not be created".
 * That sentence blames the clipping — the part that never ran — and leaves the person unsure whether
 * anything was sent. This is the regression test of the message, not of the transport: the transport
 * is `tests/Feature/SharingFlowTest.php`.
 */
test('describeReadError: a read failure says nothing was shared, not that the encryption failed', () => {
    assert.equal(
        describeReadError({ status: 500, body: null, json: null, errors: null }),
        'No se han podido leer tus registros, así que no se ha creado ningún recorte ni se ha compartido nada.',
    );
});

test('describeReadError: a 404 or a 419 are said as a stale tab, with the reload up front', () => {
    for (const status of [404, 419]) {
        assert.match(describeReadError({ status }), /^Esta página está desactualizada/);
    }
});

test('describeReadError: a request that never got an answer is the network, not the data', () => {
    assert.equal(
        describeReadError({ status: null }),
        'No hemos podido contactar con el servidor. Inténtalo de nuevo.',
    );
});

test('describeShareError: the Livewire rejection does not fall into the generic message', () => {
    const message = describeShareError({ status: 404, body: null, json: null, errors: null });

    assert.match(message, /^Esta página está desactualizada/);
    assert.notEqual(message, 'No se ha podido crear el recorte.');
});
