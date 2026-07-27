/**
 * Comprobaciones del sobre `s1.` del paquete de compartición (ADR 0011).
 *
 * Corredor incorporado de Node, como el resto de `tests/js`.
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

/** @returns {Uint8Array} `CK` de prueba, determinista. */
function contentKey(seed = 7) {
    return new Uint8Array(32).map((_, index) => (index + seed) & 0xff);
}

/**
 * @param {number} count
 * @returns {object} Cuerpo del recorte con el compromiso de recuento del ADR 0011.
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

test('sealSharePackage/openSharePackage: ida y vuelta devuelve el mismo cuerpo', async () => {
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

test('el paquete no lleva el prefijo v1., que es lo que impide colarlo en un evento', async () => {
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

test('cambiar el shareId hace fallar el descifrado', async () => {
    const key = contentKey();
    const envelope = await sealSharePackage({ contentKey: key, shareId: SHARE_ID, body: body() });

    await assert.rejects(
        () => openSharePackage({ contentKey: key, envelope, shareId: OTHER_SHARE_ID, generatedAt: GENERATED_AT }),
        ShareEnvelopeError
    );
});

test('cambiar el instante de generación hace fallar el descifrado', async () => {
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

test('el paquete de otro recorte no descifra con esta clave de contenido', async () => {
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

test('un cuerpo que declara más eventos de los que trae se rechaza al abrir', async () => {
    const key = contentKey();
    const truncated = body(3);

    /*
     * Lo que un servidor hostil querría: entregar el historial al que le falta
     * la semana mala. Aquí se fabrica con la propia clave de contenido, que es
     * el peor caso posible, y aun así el compromiso del recuento lo detiene.
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

test('sellar un cuerpo con el recuento mal ni siquiera llega a cifrarse', async () => {
    await assert.rejects(
        () => sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: { ...body(3), eventCount: 4 } }),
        ShareEnvelopeError
    );
});

test('el instante de generación de dentro tiene que ser el anunciado por fuera', async () => {
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

test('la escalera es multiplicativa y va de 64 KiB a 4 MiB', () => {
    assert.deepEqual([...SHARE_PADDED_SIZES], [65536, 262144, 1048576, 4194304]);

    for (let index = 1; index < SHARE_PADDED_SIZES.length; index += 1) {
        assert.equal(SHARE_PADDED_SIZES[index], SHARE_PADDED_SIZES[index - 1] * 4);
    }
});

test('un recorte pequeño ocupa exactamente el escalón de 64 KiB', async () => {
    const envelope = await sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: body(1) });

    assert.equal(rawBytes(envelope).length, HEADER_LENGTH + SHARE_PADDED_SIZES[0] + TAG_LENGTH);
});

test('tres eventos y trescientos caen en el mismo escalón: son indistinguibles', async () => {
    const small = await sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: body(3) });
    const large = await sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: body(300) });

    assert.equal(rawBytes(small).length, rawBytes(large).length);
});

test('un recorte que no cabe comprimido en 64 KiB sube al escalón siguiente', async () => {
    /*
     * Contenido incompresible a propósito: gzip no lo reduce, así que fuerza el
     * salto de escalón. Es el caso que el suelo alto no puede tapar.
     */
    const noise = new Uint8Array(120000);

    /* `getRandomValues` no admite más de 65.536 bytes por llamada. */
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

test('la cabecera marca comprimido, porque se comprime antes de rellenar', async () => {
    const envelope = await sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: body() });

    assert.equal(rawBytes(envelope)[3] & FLAG_COMPRESSED, FLAG_COMPRESSED);
});

test('el escalón se decide sobre lo comprimido, no sobre el claro', async () => {
    const large = body(1200);

    assert.ok(JSON.stringify(large).length > SHARE_PADDED_SIZES[0]);

    const envelope = await sealSharePackage({ contentKey: contentKey(), shareId: SHARE_ID, body: large });

    /*
     * En claro no cabría en 64 KiB; comprimido sí. Si se rellenase antes de
     * comprimir, o se comprimiese el búfer ya rellenado, este paquete acabaría
     * en otro escalón y el relleno dejaría de esconder nada.
     */
    assert.equal(rawBytes(envelope).length, HEADER_LENGTH + SHARE_PADDED_SIZES[0] + TAG_LENGTH);
});

test('padToShareLadder/unpadFromShareLadder: ida y vuelta y tamaños de la escalera', () => {
    const content = new Uint8Array(1000).fill(9);
    const padded = padToShareLadder(content);

    assert.equal(padded.length, SHARE_PADDED_SIZES[0]);
    assert.deepEqual(unpadFromShareLadder(padded), content);
});

test('padToShareLadder rechaza lo que no cabe en el mayor escalón', () => {
    assert.throws(() => padToShareLadder(new Uint8Array(MAX_SHARE_PADDED_CONTENT + 1)), ShareEnvelopeError);
});

test('unpadFromShareLadder rechaza un tamaño que no es de la escalera', () => {
    assert.throws(() => unpadFromShareLadder(new Uint8Array(4096)), ShareEnvelopeError);
});
