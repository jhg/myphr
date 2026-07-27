/**
 * Mitad de JavaScript del test de extremo a extremo del recorte compartido
 * (`tests/Feature/ShareRoundTripTest.php`, ADR 0011).
 *
 * Existe porque la costura que rompió esta funcionalidad no vive en ninguno de
 * los dos lados, sino entre ellos: `canonicalDate(expiresAt)` entra en el `info`
 * de `wrapKey` y en el dato asociado del envoltorio, lo cifra el navegador y lo
 * relee el servidor. Un test de PHP solo, o de JavaScript solo, no la ve. Este
 * script cifra con los módulos reales de `resources/js/crypto/` y el test de
 * Pest pone en medio la base de datos y las rutas HTTP de verdad.
 *
 * Dos órdenes, que se corresponden con las dos pantallas:
 *
 * * `seal`  — lo que hace `health/sharePage.js` al armar el recorte. Escribe en
 *   la salida el cuerpo del `POST /phr/shares` y, aparte, el material de clave
 *   que en la aplicación real viaja en el fragmento de la URL.
 * * `open`  — lo que hace `reader/readerPage.js` con la respuesta de
 *   `POST /s/{link}/open`: deriva `wrapKey` con el `expiresAt` **que devuelve el
 *   servidor**, abre el envoltorio y con `CK` abre el paquete.
 *
 * El PIN no se estira con Argon2id aquí: `stretched` llega ya hecho desde el
 * test. Argon2id no toca ninguna de las dos puntas de esta costura (depende del
 * PIN y de la sal, nunca de la caducidad ni del identificador) y cuesta más de
 * un segundo por lado; su comportamiento lo cubre `tests/js/shareKeys.test.mjs`.
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
 * @returns {Promise<string>} Todo lo que llegue por la entrada estándar.
 */
async function readStdin() {
    const chunks = [];

    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Cifra el recorte igual que la pantalla de crear.
 *
 * @param {{pin: string, stretched: string, ttlHours: number, eventCount: number, masterKey: string}} input
 * @returns {Promise<object>}
 */
async function seal(input) {
    const stretched = decodeBase64Url(input.stretched, 'stretched');
    const masterKey = decodeBase64Url(input.masterKey, 'masterKey');

    /**
     * Igual que `sharePage.js`: un `new Date()` corriente, con sus milisegundos,
     * y la caducidad calculada sobre él. Ese instante con fracción es justo lo
     * que la base de datos tiene que devolver intacto.
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

    /** El descriptor es un sobre `v1.` corriente bajo la clave maestra (ADR 0011). */
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
        /** Lo que en la aplicación real viaja tras el `#` y nunca llega al servidor. */
        fragment: encodeShareFragment({ sendKey, generatedAt }),
        expiresAtSealed: canonicalDate(expiresAt),
        eventCount: events.length,
    };
}

/**
 * Abre el recorte igual que el lector, con lo que haya contestado el servidor.
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
    // El test necesita el nombre del error, no solo el mensaje: `EnvelopeError`
    // es el fallo del envoltorio y `ShareEnvelopeError` el del paquete, y saber
    // cuál de los dos revienta es la mitad del diagnóstico.
    process.stdout.write(JSON.stringify({
        ok: false,
        error: failure?.name ?? 'Error',
        message: failure?.message ?? String(failure),
    }));
}
