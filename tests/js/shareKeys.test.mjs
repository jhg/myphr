/**
 * Comprobaciones de la construcción de claves del enlace (ADR 0011).
 *
 * Casi todo se prueba sin pasar por Argon2id, alimentando un `stretched`
 * determinista: el perfil real cuesta más de un segundo por llamada y no aporta
 * nada a los tests de las ramas HKDF. Solo un test lo ejecuta de verdad, y es
 * el que comprueba que la variante asíncrona con progreso da lo mismo que la
 * síncrona.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
    ARGON2_PARAMS,
    derivePinTag,
    deriveWrapKey,
    generatePin,
    generatePinSalt,
    generateSendKey,
    normalizePin,
    PIN_SALT_LENGTH,
    SEND_KEY_LENGTH,
    ShareKeyError,
    stretchPin,
    stretchPinAsync,
} from '../../resources/js/crypto/shareKeys.js';

const LINK_ID = '7a1b2c3d-4444-4444-8888-99998888aaaa';
const OTHER_LINK_ID = '00001111-2222-4444-8888-333344445555';
const EXPIRES_AT = '2026-07-28T08:15:00.000000Z';

const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);

afterEach(() => {
    globalThis.crypto.getRandomValues = realGetRandomValues;
});

/** @returns {Uint8Array} Salida de Argon2id simulada, determinista. */
function stretched(seed = 3) {
    return new Uint8Array(ARGON2_PARAMS.dkLen).map((_, index) => (index * 7 + seed) & 0xff);
}

/** @returns {Uint8Array} Sal del enlace, determinista. */
function pinSalt(seed = 1) {
    return new Uint8Array(PIN_SALT_LENGTH).map((_, index) => (index + seed) & 0xff);
}

/** @returns {Uint8Array} `S`, determinista. */
function sendKey(seed = 11) {
    return new Uint8Array(SEND_KEY_LENGTH).map((_, index) => (index * 3 + seed) & 0xff);
}

/**
 * Sustituye el CSPRNG por una lista de valores de 32 bits, para poder mirar el
 * muestreo por rechazo en vez de creérselo.
 *
 * @param {number[]} values
 * @returns {{calls: number}}
 */
function stubRandomUint32(values) {
    const state = { calls: 0 };

    globalThis.crypto.getRandomValues = (buffer) => {
        const view = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);

        view[0] = values[state.calls];
        state.calls += 1;

        return buffer;
    };

    return state;
}

test('generatePin: seis dígitos, con los ceros a la izquierda', () => {
    for (let index = 0; index < 200; index += 1) {
        assert.match(generatePin(), /^[0-9]{6}$/);
    }
});

test('generatePin: descarta los valores que introducirían sesgo de módulo', () => {
    /*
     * 4.294.967.296 = 4.294 x 1.000.000 + 967.296, así que el último múltiplo
     * completo es 4.294.000.000. Los tres primeros valores caen por encima y se
     * tienen que descartar; el cuarto es el que decide el PIN.
     */
    const state = stubRandomUint32([4294967295, 4294000000, 4294500123, 42]);

    assert.equal(generatePin(), '000042');
    assert.equal(state.calls, 4);
});

test('generatePin: el mayor valor aceptado sigue dando un PIN válido', () => {
    stubRandomUint32([4293999999]);

    assert.equal(generatePin(), '999999');
});

test('generatePin: la distribución no se apelmaza en ningún dígito final', () => {
    const buckets = new Array(10).fill(0);
    const draws = 20000;

    for (let index = 0; index < draws; index += 1) {
        buckets[Number(generatePin().slice(-1))] += 1;
    }

    /*
     * Cota holgada a propósito: esto detecta un sesgo estructural (un dígito
     * que no sale nunca, o que sale el doble), no una desviación estadística
     * normal, que haría el test intermitente.
     */
    for (const count of buckets) {
        assert.ok(count > draws / 20, `un dígito final salió solo ${count} veces de ${draws}`);
    }
});

test('generatePinSalt y generateSendKey miden lo que dice el ADR', () => {
    assert.equal(generatePinSalt().length, 16);
    assert.equal(generateSendKey().length, 32);
    assert.notDeepEqual(generateSendKey(), generateSendKey());
});

test('normalizePin: los dígitos de ancho completo del IME se pliegan a ASCII', () => {
    assert.equal(normalizePin('１２３４５６'), '123456');
    assert.equal(normalizePin('  042042 '), '042042');
});

test('normalizePin: rechaza lo que no son seis dígitos', () => {
    assert.throws(() => normalizePin('12345'), ShareKeyError);
    assert.throws(() => normalizePin('12345a'), ShareKeyError);
    assert.throws(() => normalizePin(123456), ShareKeyError);
});

test('derivePinTag y deriveWrapKey no producen el mismo valor', () => {
    const salt = pinSalt();
    const pinTag = derivePinTag({ stretched: stretched(), pinSalt: salt, linkId: LINK_ID });
    const wrapKey = deriveWrapKey({
        stretched: stretched(),
        sendKey: sendKey(),
        pinSalt: salt,
        linkId: LINK_ID,
        expiresAt: EXPIRES_AT,
    });

    assert.equal(pinTag.length, 32);
    assert.equal(wrapKey.length, 32);
    assert.notDeepEqual(pinTag, wrapKey);
});

test('las dos ramas son deterministas: mismas entradas, mismas salidas', () => {
    assert.deepEqual(
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: LINK_ID }),
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: LINK_ID })
    );
});

test('el identificador del enlace se normaliza a minúsculas', () => {
    assert.deepEqual(
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: LINK_ID }),
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: LINK_ID.toUpperCase() })
    );
});

test('cambiar el enlace cambia las dos ramas', () => {
    assert.notDeepEqual(
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: LINK_ID }),
        derivePinTag({ stretched: stretched(), pinSalt: pinSalt(), linkId: OTHER_LINK_ID })
    );

    assert.notDeepEqual(
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        }),
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: OTHER_LINK_ID,
            expiresAt: EXPIRES_AT,
        })
    );
});

test('cambiar la caducidad cambia la clave de envoltura', () => {
    assert.notDeepEqual(
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        }),
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: '2026-07-28T08:15:00.000001Z',
        })
    );
});

test('la misma caducidad escrita de otra forma deriva la misma clave', () => {
    assert.deepEqual(
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        }),
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: '2026-07-28T10:15:00+02:00',
        })
    );
});

test('cambiar S o la sal cambia la clave de envoltura', () => {
    const base = deriveWrapKey({
        stretched: stretched(),
        sendKey: sendKey(),
        pinSalt: pinSalt(),
        linkId: LINK_ID,
        expiresAt: EXPIRES_AT,
    });

    assert.notDeepEqual(
        base,
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(12),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        })
    );

    assert.notDeepEqual(
        base,
        deriveWrapKey({
            stretched: stretched(),
            sendKey: sendKey(),
            pinSalt: pinSalt(2),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        })
    );
});

test('las longitudes de las entradas se comprueban', () => {
    assert.throws(() => derivePinTag({ stretched: new Uint8Array(16), pinSalt: pinSalt(), linkId: LINK_ID }), ShareKeyError);
    assert.throws(() => derivePinTag({ stretched: stretched(), pinSalt: new Uint8Array(8), linkId: LINK_ID }), ShareKeyError);
    assert.throws(
        () => deriveWrapKey({
            stretched: stretched(),
            sendKey: new Uint8Array(8),
            pinSalt: pinSalt(),
            linkId: LINK_ID,
            expiresAt: EXPIRES_AT,
        }),
        ShareKeyError
    );
});

test('stretchPinAsync da lo mismo que stretchPin y va informando del progreso', async () => {
    const salt = pinSalt();
    const progress = [];
    const asynchronous = await stretchPinAsync({
        pin: '042042',
        pinSalt: salt,
        onProgress: (value) => progress.push(value),
    });

    assert.deepEqual(asynchronous, stretchPin({ pin: '042042', pinSalt: salt }));
    assert.equal(asynchronous.length, ARGON2_PARAMS.dkLen);
    assert.ok(progress.length > 0, 'la barra de progreso no recibió ninguna llamada');
    assert.ok(progress.every((value) => value >= 0 && value <= 1));
});
