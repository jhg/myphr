/**
 * Comprobaciones del envoltorio del enlace y de las dos capas juntas (ADR 0011).
 *
 * No se pasa por Argon2id: la `wrapKey` se deriva de un `stretched` de prueba,
 * porque lo que se comprueba aquí es el emparejamiento entre las dos capas y no
 * el coste del KDF (eso está en `shareKeys.test.mjs`).
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

/** @returns {Uint8Array} `CK` determinista. */
function contentKey(seed = 5) {
    return new Uint8Array(32).map((_, index) => (index + seed) & 0xff);
}

/**
 * @param {string} linkId
 * @param {Date|number|string} expiresAt
 * @returns {Uint8Array} `wrapKey` de ese enlace, sin ejecutar Argon2id.
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
 * Un envío completo: paquete cifrado con su `CK` y envoltorio del enlace.
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

test('las dos capas juntas: del envoltorio sale CK y de CK sale el recorte', async () => {
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

test('el paquete de otro enlace no abre este envoltorio: es el hash del paquete', async () => {
    const mine = await buildShare();
    const other = await buildShare({ shareId: OTHER_SHARE_ID, linkId: OTHER_LINK_ID, seed: 77 });

    /*
     * El ataque que esto cierra: el servidor sirve mi envoltorio junto al
     * paquete de otra persona. Sin el hash dentro del dato asociado, el
     * envoltorio abriría igual y el profesional vería un historial que no es el
     * que le enseñaron.
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

test('cambiar un solo byte del paquete tumba el envoltorio', async () => {
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

test('cambiar el identificador del enlace rompe el descifrado', async () => {
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

test('cambiar la fecha de caducidad rompe el descifrado', async () => {
    const { packageEnvelope, wrapper } = await buildShare();

    /* Con la `wrapKey` correcta y solo la fecha del dato asociado movida: aun
     * así falla, porque la fecha entra en las dos partes. */
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

test('estirar la caducidad tampoco cuela por la vía de la clave', async () => {
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

test('un PIN distinto da otra wrapKey y el envoltorio no abre', async () => {
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

test('el envoltorio es un sobre v1. corriente y viaja como cualquier otro', async () => {
    const { wrapper } = await buildShare();

    assert.ok(wrapper.startsWith('v1.'));
});

test('sharePackageDigest: 64 bytes y solo sobre un paquete s1.', async () => {
    const { packageEnvelope } = await buildShare();

    assert.equal(sharePackageDigest(packageEnvelope).length, 64);
    assert.throws(() => sharePackageDigest('v1.abc'), ShareEnvelopeError);
});

test('encodeShareFragment/decodeShareFragment: clave e instante van y vuelven iguales', () => {
    const sendKey = new Uint8Array(SEND_KEY_LENGTH).map((_, index) => index * 5);
    const generatedAt = new Date('2026-07-27T08:15:00.123Z');
    const encoded = encodeShareFragment({ sendKey, generatedAt });

    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeShareFragment(encoded), { sendKey, generatedAt });
});

/**
 * El instante del fragmento entra en el dato asociado del paquete, así que lo que importa no es
 * que vuelva un `Date` parecido: es que `canonicalDate` dé la misma cadena byte a byte que dio al
 * cifrar. Un milisegundo perdido en el viaje es un paquete que no abre.
 */
test('decodeShareFragment conserva el instante hasta el milisegundo', () => {
    const sendKey = new Uint8Array(SEND_KEY_LENGTH).fill(7);
    const generatedAt = new Date('2026-07-27T08:15:00.007Z');

    const { generatedAt: roundTripped } = decodeShareFragment(encodeShareFragment({ sendKey, generatedAt }));

    assert.equal(canonicalDate(roundTripped), canonicalDate(generatedAt));
});

test('decodeShareFragment rechaza un fragmento que no mide lo que tiene que medir', () => {
    assert.throws(() => decodeShareFragment('AAAA'), ShareEnvelopeError);
});
