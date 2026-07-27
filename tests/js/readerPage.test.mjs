/**
 * Flow of the reader page (`resources/js/reader/readerPage.js`, ADR 0011).
 *
 * The test that weighs most is the last one: it builds a clipping **exactly as whoever shares
 * builds it** and opens it **exactly as the professional opens it**, with a fake `fetch` in
 * between acting as the server. It is the only way to check that both halves rebuild the same
 * associated data, which is where an oversight produces no compilation error but a clipping that
 * does not open in the appointment.
 *
 * It runs Argon2id for real (the OPAQUE KSF parameters), so it takes a few seconds.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { canonicalDate } from '../../resources/js/crypto/canonicalDate.js';
import { encodeBase64Url } from '../../resources/js/crypto/base64url.js';
import { EnvelopeError } from '../../resources/js/crypto/envelope.js';
import { sealSharePackage, ShareEnvelopeError } from '../../resources/js/crypto/shareEnvelope.js';
import {
    deriveShareLinkKeysAsync,
    generateContentKey,
    generatePin,
    generatePinSalt,
    generateSendKey,
} from '../../resources/js/crypto/shareKeys.js';
import { encodeShareFragment, sealShareWrapper } from '../../resources/js/crypto/shareLink.js';
import { DEFAULT_LOCALE, setLocale } from '../../resources/js/i18n/index.js';
import {
    attemptMessage,
    describeReaderError,
    openClipping,
    requestPinSalt,
    readFragment,
    ReaderError,
    sanitizePin,
} from '../../resources/js/reader/readerPage.js';

const LINK_ID = '8f14e45f-ceea-4a7a-9f2c-cbd9e4d38ab7';
const SHARE_ID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const originalFetch = globalThis.fetch;

afterEach(() => {
    setLocale(DEFAULT_LOCALE);
    globalThis.fetch = originalFetch;
});

// --- The URL fragment ------------------------------------------------------------------------------

/**
 * The URL rewriters of healthcare mail and captive portals eat the fragment, and without it there
 * is no key. Warning **before** touching the server avoids spending one of the five attempts on a
 * problem that is not the PIN's.
 */
test('a link with no fragment is rejected before touching the server', () => {
    globalThis.fetch = () => assert.fail('no debería haber ninguna petición');

    for (const empty of ['', '#', '#   ']) {
        assert.throws(() => readFragment(empty), (failure) => (
            failure instanceof ReaderError && /arrived incomplete/.test(failure.message)
        ));
    }
});

test('a fragment that does not have the expected shape is rejected too', () => {
    assert.throws(() => readFragment('#no-es-base64url-de-40-bytes'), ReaderError);
});

test('a valid fragment returns the send key and the generation instant', () => {
    const sendKey = generateSendKey();
    const generatedAt = new Date('2026-07-20T08:00:00.000Z');

    assert.deepEqual(readFragment(`#${encodeShareFragment({ sendKey, generatedAt })}`), { sendKey, generatedAt });
});

// --- The PIN -------------------------------------------------------------------------------------

/** Whoever dictates a PIN dictates it in two halves; rejecting the space would spend an attempt on it. */
test('the PIN is cleaned of spaces and dashes before checking it', () => {
    assert.equal(sanitizePin(' 421 803 '), '421803');
    assert.equal(sanitizePin('421-803'), '421803');
});

test('a PIN that is not six digits never leaves the browser', () => {
    globalThis.fetch = () => assert.fail('no debería haber ninguna petición');

    for (const bad of ['4218', '4218031', 'abcdef', '']) {
        assert.throws(() => sanitizePin(bad), ReaderError, bad);
    }
});

// --- The messages ----------------------------------------------------------------------------------

/**
 * The four causes —non-existent, expired, revoked and wrong PIN— give the same message. What can
 * be counted are the attempts made **from this browser**, and it is said in those words: the real
 * counter lives in a server column and never leaves it.
 */
test('the failure message does not tell causes apart and does count the attempts of this browser', () => {
    const message = attemptMessage(2, 5);

    assert.match(message, /2 of 5 failed attempts from this browser/);
    assert.match(attemptMessage(5, 5), /5 failed attempts from this browser/);

    /**
     * The message lists the four possible causes precisely because it does not say which one it
     * is, and the only thing that changes between two failures is the attempt count: the part
     * describing the failure is identical, so there is nothing in it to deduce whether the link exists.
     */
    const [first, second] = [attemptMessage(1, 5), attemptMessage(2, 5)];
    const generic = (text) => text.slice(0, text.indexOf('That is'));

    assert.equal(generic(first), generic(second));
    assert.match(generic(first), /PIN is wrong or the link is no longer valid/);
    assert.match(generic(first), /cannot tell you which/);
});

/**
 * An integrity failure does get a message of its own: by then the PIN was already correct, so what
 * fails is what was delivered, and that is neither silenced nor shown half-way (ADR 0004).
 */
test('a decryption failure is said out loud and nothing partial is shown', () => {
    for (const failure of [new EnvelopeError('x'), new ShareEnvelopeError('x')]) {
        assert.match(describeReaderError(failure), /altered or incomplete/);
    }
});

// --- The full walk -----------------------------------------------------------------------------------

/**
 * Builds a clipping just like `health/sharePage.js` and returns everything needed to open it.
 *
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function buildClipping({ events = [] } = {}) {
    const generatedAt = new Date('2026-07-20T08:00:00.000Z');
    const expiresAt = new Date('2026-07-21T08:00:00.000Z');
    const contentKey = generateContentKey();
    const sendKey = generateSendKey();
    const pinSalt = generatePinSalt();
    const pin = generatePin();

    const body = {
        v: 1,
        generatedAt: canonicalDate(generatedAt),
        range: { from: '2026-06-20T00:00:00.000000Z', to: null },
        includedTypes: ['glucose'],
        excludedTypes: ['meal'],
        eventCount: events.length,
        events,
    };

    const packageEnvelope = await sealSharePackage({ contentKey, shareId: SHARE_ID, body });
    const keys = await deriveShareLinkKeysAsync({ pin, pinSalt, linkId: LINK_ID, expiresAt, sendKey });
    const wrapper = sealShareWrapper({
        wrapKey: keys.wrapKey,
        contentKey,
        linkId: LINK_ID,
        expiresAt,
        packageEnvelope,
    });

    return { pin, pinSalt, sendKey, generatedAt, expiresAt, packageEnvelope, wrapper, keys, body };
}

/**
 * Fake server with the two public routes: `challenge` always returns the salt, and `open` returns
 * the package **only** if the proof matches. It is the contract of ADR 0011.
 *
 * @param {object} clipping
 * @returns {{calls: list<string>}}
 */
function stubServer(clipping) {
    const calls = [];

    globalThis.fetch = async (url, options) => {
        calls.push(url);

        if (url.endsWith('/challenge')) {
            return new Response(JSON.stringify({ pinSalt: encodeBase64Url(clipping.pinSalt) }), { status: 200 });
        }

        const sent = JSON.parse(options.body).pinTag;

        if (sent !== encodeBase64Url(clipping.keys.pinTag)) {
            return new Response(JSON.stringify({ error: 'invalid_share_link' }), { status: 403 });
        }

        return new Response(JSON.stringify({
            wrapper: clipping.wrapper,
            package: clipping.packageEnvelope,
            shareId: SHARE_ID,
            expiresAt: canonicalDate(clipping.expiresAt),
        }), { status: 200 });
    };

    return { calls };
}

const ENDPOINTS = { challenge: `/s/${LINK_ID}/challenge`, open: `/s/${LINK_ID}/open` };

test('it opens the clipping end to end and does not ask for the package before having the proof', async () => {
    const glucose = {
        occurredAt: '2026-07-19T07:15:00.000000Z',
        content: {
            v: 1,
            type: 'glucose',
            tz: '+02:00',
            origin: 'manual',
            recordedBy: 'self',
            data: { value: '112', unit: 'mg/dL', loinc: '41653-7', method: 'capillary' },
        },
    };

    const clipping = await buildClipping({ events: [glucose] });
    const { calls } = stubServer(clipping);
    const progress = [];

    const body = await openClipping({
        endpoints: ENDPOINTS,
        linkId: LINK_ID,
        pin: clipping.pin,
        sendKey: clipping.sendKey,
        generatedAt: clipping.generatedAt,
        onProgress: (fraction) => progress.push(fraction),
    });

    assert.deepEqual(body.events, [glucose]);
    assert.equal(body.eventCount, 1);
    assert.deepEqual(body.excludedTypes, ['meal']);

    /** The package is asked for after the `challenge`, never before: that order is the whole ADR. */
    assert.deepEqual(calls, [ENDPOINTS.challenge, ENDPOINTS.open]);

    /** The progress is the real one of the stretching, not an animation: it rises and finishes. */
    assert.ok(progress.length > 0);
    assert.ok(progress[progress.length - 1] > progress[0]);
}, { timeout: 60_000 });

/**
 * The salt depends on nothing the professional types, so the screen asks for it while the page is
 * still loading and hands the promise to `openClipping`. What must not happen is a second request:
 * that would put back the very round trip this exists to remove, and it would happen with someone
 * already waiting with the PIN typed.
 */
test('a salt fetched in advance is used as is, without asking for the challenge again', async () => {
    const clipping = await buildClipping();
    const { calls } = stubServer(clipping);

    const pinSalt = requestPinSalt(ENDPOINTS);

    const body = await openClipping({
        endpoints: ENDPOINTS,
        linkId: LINK_ID,
        pin: clipping.pin,
        pinSalt,
        sendKey: clipping.sendKey,
        generatedAt: clipping.generatedAt,
    });

    assert.equal(body.eventCount, 0);
    assert.deepEqual(calls, [ENDPOINTS.challenge, ENDPOINTS.open]);
}, { timeout: 60_000 });

test('a wrong PIN returns nothing of the package and leaves through the generic failure', async () => {
    const clipping = await buildClipping();

    stubServer(clipping);

    await assert.rejects(
        () => openClipping({
            endpoints: ENDPOINTS,
            linkId: LINK_ID,
            pin: clipping.pin === '000000' ? '111111' : '000000',
            sendKey: clipping.sendKey,
            generatedAt: clipping.generatedAt,
        }),
        (failure) => failure instanceof ReaderError && failure.message === '',
    );
}, { timeout: 60_000 });

/**
 * The generation instant travels in the fragment, the server does not set it. If another one
 * arrived —because somebody touched the link or the server served another package—, the
 * associated data stops matching and the package **does not open**. Nothing unverified is shown.
 */
test('a generation instant different from the one encrypted does not open the package', async () => {
    const clipping = await buildClipping();

    stubServer(clipping);

    await assert.rejects(
        () => openClipping({
            endpoints: ENDPOINTS,
            linkId: LINK_ID,
            pin: clipping.pin,
            sendKey: clipping.sendKey,
            generatedAt: new Date(clipping.generatedAt.getTime() + 1000),
        }),
        (failure) => failure instanceof EnvelopeError || failure instanceof ShareEnvelopeError,
    );
}, { timeout: 60_000 });

/**
 * `S` is the half the server does not see: with the right package, wrapper and PIN, but without
 * the key of the fragment, nothing opens. It is what makes a database dump not enough.
 * baste.
 */
test('without the key of the fragment it does not open, even with the right PIN', async () => {
    const clipping = await buildClipping();

    stubServer(clipping);

    await assert.rejects(
        () => openClipping({
            endpoints: ENDPOINTS,
            linkId: LINK_ID,
            pin: clipping.pin,
            sendKey: generateSendKey(),
            generatedAt: clipping.generatedAt,
        }),
        EnvelopeError,
    );
}, { timeout: 60_000 });
