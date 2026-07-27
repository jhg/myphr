/**
 * Flujo de la página del lector (`resources/js/reader/readerPage.js`, ADR 0011).
 *
 * El test que más pesa es el último: arma un recorte **exactamente como lo arma quien comparte** y
 * lo abre **exactamente como lo abre el profesional**, con un `fetch` de mentira en medio que hace
 * de servidor. Es la única forma de comprobar que las dos mitades reconstruyen el mismo dato
 * asociado, que es donde un descuido no produce un error de compilación sino un recorte que no abre
 * en la consulta.
 *
 * Corre Argon2id de verdad (los parámetros del KSF de OPAQUE), así que tarda unos segundos.
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

// --- El fragmento de la URL ----------------------------------------------------------------------

/**
 * Los reescritores de URL del correo sanitario y los portales cautivos se comen el fragmento, y sin
 * él no hay clave. Avisar **antes** de tocar el servidor evita gastar uno de los cinco intentos por
 * un problema que no es del PIN.
 */
test('un enlace sin fragmento se rechaza antes de tocar el servidor', () => {
    globalThis.fetch = () => assert.fail('no debería haber ninguna petición');

    for (const empty of ['', '#', '#   ']) {
        assert.throws(() => readFragment(empty), (failure) => (
            failure instanceof ReaderError && /arrived incomplete/.test(failure.message)
        ));
    }
});

test('un fragmento que no tiene la forma esperada se rechaza igual', () => {
    assert.throws(() => readFragment('#no-es-base64url-de-40-bytes'), ReaderError);
});

test('un fragmento válido devuelve la clave de envío y el instante de generación', () => {
    const sendKey = generateSendKey();
    const generatedAt = new Date('2026-07-20T08:00:00.000Z');

    assert.deepEqual(readFragment(`#${encodeShareFragment({ sendKey, generatedAt })}`), { sendKey, generatedAt });
});

// --- El PIN --------------------------------------------------------------------------------------

/** Quien dicta un PIN lo dicta en dos mitades; rechazar el espacio sería gastar un intento por él. */
test('el PIN se limpia de espacios y guiones antes de comprobarlo', () => {
    assert.equal(sanitizePin(' 421 803 '), '421803');
    assert.equal(sanitizePin('421-803'), '421803');
});

test('un PIN que no son seis dígitos no llega a salir del navegador', () => {
    globalThis.fetch = () => assert.fail('no debería haber ninguna petición');

    for (const bad of ['4218', '4218031', 'abcdef', '']) {
        assert.throws(() => sanitizePin(bad), ReaderError, bad);
    }
});

// --- Los mensajes ---------------------------------------------------------------------------------

/**
 * Las cuatro causas —inexistente, caducado, revocado y PIN incorrecto— dan el mismo mensaje. Lo que
 * sí se puede contar son los intentos hechos **desde este navegador**, y se dice con esas palabras:
 * el contador de verdad vive en una columna del servidor y no sale de ahí.
 */
test('el mensaje de fallo no distingue causas y sí cuenta los intentos de este navegador', () => {
    const message = attemptMessage(2, 5);

    assert.match(message, /2 of 5 failed attempts from this browser/);
    assert.match(attemptMessage(5, 5), /5 failed attempts from this browser/);

    /**
     * El mensaje enumera las cuatro causas posibles precisamente porque no dice cuál es, y lo
     * único que cambia entre dos fallos es el recuento de intentos: la parte que describe el fallo
     * es idéntica, así que no hay nada en ella de lo que deducir si el enlace existe.
     */
    const [first, second] = [attemptMessage(1, 5), attemptMessage(2, 5)];
    const generic = (text) => text.slice(0, text.indexOf('That is'));

    assert.equal(generic(first), generic(second));
    assert.match(generic(first), /PIN is wrong or the link is no longer valid/);
    assert.match(generic(first), /cannot tell you which/);
});

/**
 * Un fallo de integridad sí tiene mensaje propio: a esas alturas el PIN ya era correcto, así que lo
 * que falla es lo entregado, y eso no se calla ni se enseña a medias (ADR 0004).
 */
test('un fallo de descifrado se dice en voz alta y no se enseña nada parcial', () => {
    for (const failure of [new EnvelopeError('x'), new ShareEnvelopeError('x')]) {
        assert.match(describeReaderError(failure), /altered or incomplete/);
    }
});

// --- El recorrido completo -----------------------------------------------------------------------

/**
 * Arma un recorte igual que `health/sharePage.js` y devuelve todo lo que hace falta para abrirlo.
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
 * Servidor de mentira con las dos rutas públicas: `challenge` devuelve la sal siempre, y `open`
 * devuelve el paquete **solo** si el comprobante cuadra. Es el contrato del ADR 0011.
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

test('abre el recorte de punta a punta y no pide el paquete antes de tener el comprobante', async () => {
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

    /** El paquete se pide después del `challenge`, nunca antes: ese orden es el ADR entero. */
    assert.deepEqual(calls, [ENDPOINTS.challenge, ENDPOINTS.open]);

    /** El progreso es el real del estiramiento, no una animación: sube y termina. */
    assert.ok(progress.length > 0);
    assert.ok(progress[progress.length - 1] > progress[0]);
}, { timeout: 60_000 });

test('un PIN incorrecto no devuelve nada del paquete y sale por el fallo genérico', async () => {
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
 * El instante de generación viaja en el fragmento, no lo pone el servidor. Si llegara otro —porque
 * alguien tocó el enlace o porque el servidor sirvió otro paquete—, el dato asociado deja de cuadrar
 * y el paquete **no abre**. Nunca se enseña un recorte que no verifica.
 */
test('un instante de generación distinto del que se cifró no abre el paquete', async () => {
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
 * `S` es la mitad que no ve el servidor: con el paquete, el envoltorio y el PIN correctos, pero sin
 * la clave del fragmento, no se abre nada. Es lo que hace que un volcado de la base de datos no
 * baste.
 */
test('sin la clave del fragmento no se abre, aunque el PIN sea correcto', async () => {
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
