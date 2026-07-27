/**
 * Comprobaciones de la lógica pura de `health/sharePage.js` y de `health/shareDescriptor.js`
 * (ADR 0011).
 *
 * No se monta Alpine ni el DOM del panel: lo que se prueba aquí es lo que decide qué acaba dentro
 * del recorte, que es lo único de esta pantalla que puede equivocarse en silencio. Que un botón
 * llame a `generate()` lo comprueba `tests/Feature/SharingPageTest.php` sobre el marcado.
 *
 * Corredor incorporado de Node, como el resto de `tests/js` (ver `crypto.test.mjs`).
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
    expiryFor,
    partitionTypes,
    QR_BORDER_MODULES,
    QR_MIN_SIDE_PX,
    qrSvgFor,
    SHAREABLE_TYPES,
    shareUrlFor,
} from '../../resources/js/health/sharePage.js';
import { openShareDescriptor, sealShareDescriptor } from '../../resources/js/health/shareDescriptor.js';

/** Como el resto de tests que afirman texto: el idioma se fija, no se supone. */
setLocale('es');

const USER_ID = '9c8f2e2a-2222-4444-8888-abcdefabcdef';
const OTHER_USER_ID = '00000000-1111-4444-8888-000000000000';
const SHARE_ID = 'c0ffee00-1111-4444-8888-222233334444';
const OTHER_SHARE_ID = 'deadbeef-1111-4444-8888-222233334444';

/** @returns {Uint8Array} Clave maestra de prueba, 32 bytes deterministas. */
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

// --- Selección de tipos --------------------------------------------------------------------------

test('defaultTypeSelection: arranca con todos los tipos marcados', () => {
    const selection = defaultTypeSelection();

    assert.deepEqual(Object.keys(selection), [...SHAREABLE_TYPES]);
    assert.ok(Object.values(selection).every((value) => value === true));
});

test('partitionTypes: los excluidos se escriben, no se dan por implícitos', () => {
    const { included, excluded } = partitionTypes({ glucose: true, insulin: true });

    assert.deepEqual(included, ['glucose', 'insulin']);

    /**
     * Que los cuatro restantes aparezcan en `excluded` es la parte que importa: el paquete tiene
     * que poder decirle al profesional que las comidas no se enviaron, en vez de dejar que lea la
     * ausencia como un cero clínico.
     */
    assert.deepEqual(excluded, ['bloodPressure', 'meal', 'bodyWeight', 'temperature']);
});

test('partitionTypes: una selección vacía no incluye nada y excluye todo', () => {
    const { included, excluded } = partitionTypes({});

    assert.deepEqual(included, []);
    assert.deepEqual(excluded, [...SHAREABLE_TYPES]);
});

// --- Caducidad -----------------------------------------------------------------------------------

const TTL_CATALOG = Object.freeze([
    { token: '1h', hours: 1 },
    { token: '24h', hours: 24 },
    { token: '7d', hours: 24 * 7 },
]);

test('expiryFor: la caducidad se cuenta desde ahora y en horas exactas', () => {
    const now = new Date('2026-07-27T10:00:00.000Z');

    assert.equal(expiryFor('1h', TTL_CATALOG, now).toISOString(), '2026-07-27T11:00:00.000Z');
    assert.equal(expiryFor('24h', TTL_CATALOG, now).toISOString(), '2026-07-28T10:00:00.000Z');
    assert.equal(expiryFor('7d', TTL_CATALOG, now).toISOString(), '2026-08-03T10:00:00.000Z');
});

test('expiryFor: un TTL fuera de la lista cerrada no se inventa', () => {
    assert.throws(() => expiryFor('30d', TTL_CATALOG, new Date()), /caducidad/i);
});

// --- Cuerpo del paquete --------------------------------------------------------------------------

test('buildSharePackageBody: lleva rango, fecha, recuento y las dos listas de tipos', () => {
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

test('buildSharePackageBody: el cuerpo cierra y abre con el sobre `s1.` de verdad', async () => {
    /**
     * El compromiso `eventCount === events.length` es lo que sustituye al manifiesto que haría
     * falta si el paquete se trocease, y quien lo comprueba es `assertShareBody()` dentro del
     * módulo del sobre. Este test existe para que la forma que construye la pantalla y la que exige
     * el sobre no puedan divergir sin que falle algo.
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

test('buildShareDescriptor: lleva CK y lo que la lista necesita, y ningún evento', () => {
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

    /** Los eventos NO entran en el descriptor: la lista no los necesita y ocuparían por nada. */
    assert.equal(descriptor.events, undefined);
});

test('sealShareDescriptor/openShareDescriptor: ida y vuelta bajo la clave maestra', () => {
    adoptMasterKey(testMasterKey(), USER_ID);

    const descriptor = { v: 1, contentKey: 'AAAA', includedTypes: ['glucose'] };
    const envelope = sealShareDescriptor({ userId: USER_ID, shareId: SHARE_ID, descriptor });

    assert.ok(envelope.startsWith('v1.'), 'el descriptor es un sobre v1. corriente del ADR 0004');
    assert.deepEqual(openShareDescriptor({ userId: USER_ID, shareId: SHARE_ID, envelope }), descriptor);
});

test('openShareDescriptor: el sobre está atado a su usuario y a su recorte', () => {
    adoptMasterKey(testMasterKey(), USER_ID);

    const envelope = sealShareDescriptor({
        userId: USER_ID,
        shareId: SHARE_ID,
        descriptor: { v: 1, contentKey: 'AAAA' },
    });

    /**
     * Cambiar cualquiera de las dos mitades del dato asociado tiene que **fallar**, no devolver el
     * descriptor de otro recorte: es lo que impide que el servidor mueva un descriptor de fila.
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

test('openShareDescriptor: el identificador en mayúsculas abre el mismo sobre', () => {
    /**
     * El `id` lo genera `crypto.randomUUID()` en minúsculas, pero el que vuelve del listado podría
     * no estarlo. Si el contexto no normalizara, la lista dejaría de poder abrir sus propios
     * descriptores el día que el servidor cambiara de mayúsculas.
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

// --- Enlace y QR ---------------------------------------------------------------------------------

const TEMPLATE = 'https://phr.example.org/s/{link}';
const LINK_ID = '8f14e45f-ceea-4a7a-9f2c-cbd9e4d38ab7';

test('shareUrlFor: la clave de envío y el instante van en el fragmento y vuelven enteros', () => {
    const sendKey = generateSendKey();
    const generatedAt = new Date('2026-07-27T10:00:00.000Z');
    const url = shareUrlFor({ template: TEMPLATE, linkId: LINK_ID, sendKey, generatedAt });

    assert.ok(url.startsWith(`https://phr.example.org/s/${LINK_ID}#`));

    /**
     * El fragmento no viaja al servidor, y es la mitad que hace que un volcado de la base de datos
     * no baste. Que vuelva byte a byte es lo que hace que el enlace sirva para algo; el instante
     * viaja con él porque el lector lo necesita para reconstruir el dato asociado del paquete.
     */
    assert.deepEqual(decodeShareFragment(url.slice(url.indexOf('#') + 1)), { sendKey, generatedAt });
});

test('el QR codifica el enlace COMPLETO y cabe con holgura', () => {
    const sendKey = generateSendKey();
    const url = shareUrlFor({ template: TEMPLATE, linkId: LINK_ID, sendKey, generatedAt: new Date() });

    const encoded = encode(url, { ecc: 'M' });

    /**
     * Versión 6 (43x43 módulos) con corrección M admite 134 bytes en modo byte. Una URL típica son
     * ~106 caracteres, así que quedan casi treinta de margen para un dominio más largo antes de
     * subir de versión. Se afirma el techo, no el valor exacto: subir de versión no es un fallo,
     * pero pasar de la 10 sí querría decir que la URL creció sin que nadie lo mirara.
     */
    assert.ok(encoded.version <= 10, `el QR necesitó la versión ${encoded.version}`);
    assert.ok(url.length < 134, `la URL mide ${url.length} caracteres`);

    const svg = qrSvgFor(url);

    /** Fondo blanco dentro del propio SVG: el QR no conmuta con el tema oscuro. */
    assert.match(svg, /<rect fill="#FFFFFF"/);
    assert.match(svg, /fill="#000000"/);

    /**
     * Zona tranquila de cuatro módulos y lado mínimo de 400 px: los dos son requisitos de lectura
     * desde el otro lado de una mesa, no decisiones de estilo.
     */
    assert.equal(QR_BORDER_MODULES, 4);
    assert.ok(QR_MIN_SIDE_PX >= 400);

    /**
     * `size` de `uqr` ya cuenta el borde, así que la zona tranquila se comprueba viendo cuánto
     * crece el lado al pedir cuatro módulos en vez del uno que trae por defecto: seis módulos más
     * (tres por lado) es exactamente la diferencia entre 1 y 4 a cada lado.
     */
    const bordered = encode(url, { ecc: 'M', border: QR_BORDER_MODULES });

    assert.equal(bordered.size, encoded.size + (QR_BORDER_MODULES - 1) * 2);

    const side = bordered.size * 12;
    assert.match(svg, new RegExp(`viewBox="0 0 ${side} ${side}"`));
});

// --- Texto de la lista ---------------------------------------------------------------------------

test('describeRange: un rango abierto se dice con palabras, no con un hueco', () => {
    assert.equal(describeRange({ from: null, to: null }), 'Todo tu historial');
    assert.match(describeRange({ from: '2026-07-01T00:00:00.000000Z', to: null }), /^Desde /);
    assert.match(describeRange({ from: null, to: '2026-07-31T00:00:00.000000Z' }), /^Hasta /);
    assert.match(
        describeRange({ from: '2026-07-01T00:00:00.000000Z', to: '2026-07-31T00:00:00.000000Z' }),
        /^Del .* al /
    );
});
