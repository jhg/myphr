/**
 * JavaScript half of the end-to-end test of the shared clipping
 * (`tests/Feature/ShareRoundTripTest.php`, ADR 0011).
 *
 * It exists because the seam that broke this feature lives on neither of the
 * two sides, but between them: `canonicalDate(expiresAt)` enters the `info` of
 * `wrapKey` and the associated data of the wrapper, the browser encrypts it and
 * the server reads it back. A PHP-only or JavaScript-only test does not see it.
 * This script encrypts with the real modules of `resources/js/crypto/` and the
 * Pest test puts the real database and HTTP routes in between.
 *
 * Two commands, matching the two screens:
 *
 * * `seal`  — what `health/sharePage.js` does when building the clipping. It
 *   writes to the output the body of the `POST /phr/shares` and, apart, the key
 *   material that in the real application travels in the URL fragment.
 * * `open`  — what `reader/readerPage.js` does with the response of
 *   `POST /s/{link}/open`: it derives `wrapKey` with the `expiresAt` **the
 *   server returns**, opens the wrapper and with `CK` opens the package.
 *
 * The PIN is not stretched with Argon2id here: `stretched` arrives ready from
 * the test. Argon2id touches neither end of this seam (it depends on the PIN
 * and the salt, never on the expiry or the identifier) and costs more than a
 * second per side; its behaviour is covered by `tests/js/shareKeys.test.mjs`.
 */

import { adoptMasterKey, forget } from '../../../resources/js/auth/keyring.js';
import { decodeBase64Url, encodeBase64Url } from '../../../resources/js/crypto/base64url.js';
import { canonicalDate } from '../../../resources/js/crypto/canonicalDate.js';
import { openSharePackage, sealSharePackage } from '../../../resources/js/crypto/shareEnvelope.js';
import { derivePinTag, deriveWrapKey } from '../../../resources/js/crypto/shareKeys.js';
import { seal as sealEnvelope } from '../../../resources/js/crypto/envelope.js';
import {
    encodeShareFragment,
    decodeShareFragment,
    openShareWrapper,
    sealShareWrapper,
} from '../../../resources/js/crypto/shareLink.js';
import { openEvent, sealEvent } from '../../../resources/js/health/eventEnvelope.js';
import { sealShareDescriptor } from '../../../resources/js/health/shareDescriptor.js';
import { buildSharePackageBody, partitionTypes } from '../../../resources/js/health/sharePage.js';

/**
 * @returns {Promise<string>} Everything arriving on standard input.
 */
async function readStdin() {
    const chunks = [];

    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Encrypts the clipping just like the create screen.
 *
 * @param {{pin: string, stretched: string, ttlHours: number, eventCount: number, masterKey: string}} input
 * @returns {Promise<object>}
 */
async function seal(input) {
    const stretched = decodeBase64Url(input.stretched, 'stretched');
    const masterKey = decodeBase64Url(input.masterKey, 'masterKey');

    /**
     * Just like `sharePage.js`: a plain `new Date()`, with its milliseconds, and
     * the expiry computed on it. That instant with a fraction is exactly what
     * the database has to return intact.
     */
    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + input.ttlHours * 3600 * 1000);

    const shareId = globalThis.crypto.randomUUID();
    const linkId = globalThis.crypto.randomUUID();

    const sendKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const contentKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const pinSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));

    const events = Array.from({ length: input.eventCount }, (_, index) => ({
        id: globalThis.crypto.randomUUID(),
        type: 'glucose',
        occurredAt: canonicalDate(new Date(generatedAt.getTime() - index * 3600 * 1000)),
        value: String(90 + index),
    }));

    const body = {
        generatedAt,
        eventCount: events.length,
        events,
        included: ['glucose'],
        excluded: [],
        range: {
            from: canonicalDate(new Date(generatedAt.getTime() - 90 * 24 * 3600 * 1000)),
            to: canonicalDate(generatedAt),
        },
    };

    const packageEnvelope = await sealSharePackage({ contentKey, shareId, body });

    /** The descriptor is a plain `v1.` envelope under the master key (ADR 0011). */
    const descriptor = sealEnvelope({
        key: masterKey,
        plaintext: new TextEncoder().encode(JSON.stringify({
            contentKey: encodeBase64Url(contentKey),
            expiresAt: canonicalDate(expiresAt),
        })),
        associatedData: new TextEncoder().encode(`share-descriptor:${shareId}`),
    });

    const pinTag = derivePinTag({ stretched, pinSalt, linkId });
    const wrapKey = deriveWrapKey({ stretched, sendKey, pinSalt, linkId, expiresAt });

    const wrapper = sealShareWrapper({ wrapKey, contentKey, linkId, expiresAt, packageEnvelope });

    return {
        request: {
            id: shareId,
            payload: packageEnvelope,
            descriptor,
            expiresAt: canonicalDate(expiresAt),
            link: {
                id: linkId,
                pinSalt: encodeBase64Url(pinSalt),
                pinTag: encodeBase64Url(pinTag),
                wrapper,
            },
        },
        linkId,
        pin: input.pin,
        pinSalt: encodeBase64Url(pinSalt),
        pinTag: encodeBase64Url(pinTag),
        /** What in the real application travels after the `#` and never reaches the server. */
        fragment: encodeShareFragment({ sendKey, generatedAt }),
        expiresAtSealed: canonicalDate(expiresAt),
        eventCount: events.length,
    };
}

/**
 * Opens the clipping just like the reader, with whatever the server answered.
 *
 * @param {{stretched: string, pinSalt: string, fragment: string, linkId: string, opened: object}} input
 * @returns {Promise<object>}
 */
async function open(input) {
    const stretched = decodeBase64Url(input.stretched, 'stretched');
    const pinSalt = decodeBase64Url(input.pinSalt, 'pinSalt');
    const { sendKey, generatedAt } = decodeShareFragment(input.fragment);

    const { wrapper, package: packageEnvelope, shareId, expiresAt } = input.opened;

    const wrapKey = deriveWrapKey({ stretched, sendKey, pinSalt, linkId: input.linkId, expiresAt });

    const contentKey = openShareWrapper({ wrapKey, wrapper, linkId: input.linkId, expiresAt, packageEnvelope });

    const body = await openSharePackage({
        contentKey,
        envelope: packageEnvelope,
        shareId,
        generatedAt: canonicalDate(generatedAt),
    });

    return {
        eventCount: body.eventCount,
        events: body.events.length,
        generatedAt: body.generatedAt,
        /**
         * The clipping as the professional reads it. The end-to-end test asserts on this, not just
         * on the count: a clipping that opens but carries other people's numbers would pass a count.
         */
        includedTypes: body.includedTypes ?? null,
        excludedTypes: body.excludedTypes ?? null,
        contents: body.events.map((event) => ({ occurredAt: event.occurredAt, content: event.content })),
    };
}

/**
 * Seals health events the way any recording screen does, so the test can put
 * envelopes in the database that the sharing screen will really be able to open.
 *
 * @param {{masterKey: string, userId: string, events: list<{occurredAt: string, content: object}>}} input
 * @returns {Promise<{events: list<{occurredAt: string, payload: string}>}>}
 */
async function sealEvents(input) {
    adoptMasterKey(decodeBase64Url(input.masterKey, 'masterKey'), input.userId);

    try {
        return {
            events: input.events.map((event) => ({
                occurredAt: event.occurredAt,
                payload: sealEvent({
                    userId: input.userId,
                    occurredAt: event.occurredAt,
                    content: event.content,
                }),
            })),
        };
    } finally {
        forget();
    }
}

/**
 * Builds the clipping out of the envelopes the screen just read from the server,
 * with the real functions of `health/sharePage.js`.
 *
 * This is the command that closes the loop the plain `seal` leaves open: `seal`
 * makes its events up, so it proves the crypto seam but says nothing about the
 * read that feeds it — which is exactly the step that broke in production.
 *
 * @param {{masterKey: string, userId: string, stretched: string, pin: string, ttlHours: number,
 *          types: Record<string, boolean>, range: {from: string|null, to: string|null},
 *          rawEvents: list<{occurredAt: string, payload: string}>}} input
 * @returns {Promise<object>}
 */
async function sealFetched(input) {
    const stretched = decodeBase64Url(input.stretched, 'stretched');

    adoptMasterKey(decodeBase64Url(input.masterKey, 'masterKey'), input.userId);

    try {
        const { included, excluded } = partitionTypes(input.types);

        const events = input.rawEvents
            .map((rawEvent) => ({
                occurredAt: rawEvent.occurredAt,
                content: openEvent({
                    userId: input.userId,
                    occurredAt: rawEvent.occurredAt,
                    envelope: rawEvent.payload,
                }),
            }))
            .filter((event) => included.includes(event.content?.type));

        const generatedAt = new Date();
        const expiresAt = new Date(generatedAt.getTime() + input.ttlHours * 3600 * 1000);

        const shareId = globalThis.crypto.randomUUID();
        const linkId = globalThis.crypto.randomUUID();

        const sendKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
        const contentKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
        const pinSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));

        const body = buildSharePackageBody({
            events,
            included,
            excluded,
            range: input.range,
            generatedAt,
        });

        const packageEnvelope = await sealSharePackage({ contentKey, shareId, body });

        const descriptor = sealShareDescriptor({
            userId: input.userId,
            shareId,
            descriptor: {
                v: 1,
                contentKey: encodeBase64Url(contentKey),
                generatedAt: body.generatedAt,
                expiresAt: canonicalDate(expiresAt),
                range: body.range,
                includedTypes: body.includedTypes,
                excludedTypes: body.excludedTypes,
                eventCount: body.eventCount,
            },
        });

        const pinTag = derivePinTag({ stretched, pinSalt, linkId });
        const wrapKey = deriveWrapKey({ stretched, sendKey, pinSalt, linkId, expiresAt });

        return {
            request: {
                id: shareId,
                payload: packageEnvelope,
                descriptor,
                expiresAt: canonicalDate(expiresAt),
                link: {
                    id: linkId,
                    pinSalt: encodeBase64Url(pinSalt),
                    pinTag: encodeBase64Url(pinTag),
                    wrapper: sealShareWrapper({ wrapKey, contentKey, linkId, expiresAt, packageEnvelope }),
                },
            },
            linkId,
            pinSalt: encodeBase64Url(pinSalt),
            pinTag: encodeBase64Url(pinTag),
            fragment: encodeShareFragment({ sendKey, generatedAt }),
            expiresAtSealed: canonicalDate(expiresAt),
            eventCount: body.eventCount,
            includedTypes: body.includedTypes,
            excludedTypes: body.excludedTypes,
        };
    } finally {
        forget();
    }
}

const COMMANDS = { seal, open, sealEvents, sealFetched };

const command = process.argv[2];
const input = JSON.parse(await readStdin());

try {
    const result = await COMMANDS[command](input);

    process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (failure) {
    // The test needs the name of the error, not just the message: `EnvelopeError`
    // is the failure of the wrapper and `ShareEnvelopeError` that of the package,
    // and knowing which of the two blows up is half the diagnosis.
    process.stdout.write(JSON.stringify({
        ok: false,
        error: failure?.name ?? 'Error',
        message: failure?.message ?? String(failure),
    }));
}
