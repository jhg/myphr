/**
 * Comprobaciones de `settings.js` y `sessionBootstrap.js` (Spec 0001 §6.1 paso 10 y §6.2).
 *
 * A diferencia de `auth.test.mjs`, estos módulos sí tocan `document` (y, a través de `recovery.js`
 * y `keyring.js`, `window` y `sessionStorage`), así que cada prueba monta un DOM mínimo a mano: lo
 * justo que leen `http.js`, `recovery.js` y `sessionBootstrap.js` (`document.head`, un puñado de
 * `<meta>` y `document.querySelector('[data-phr-page]')`). Se restaura todo al final de cada
 * prueba para no filtrar estado entre ellas.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { envelopeContext, ENVELOPE_PURPOSES } from '../../resources/js/auth/context.js';
import { adoptMasterKey, forget, isUnlocked, MASTER_KEY_LENGTH } from '../../resources/js/auth/keyring.js';
import {
    forgetSettings,
    hasSettings,
    loadSettings,
    saveSettings,
    settings,
} from '../../resources/js/auth/settings.js';
import { bootstrapSession, SESSION_READY_EVENT } from '../../resources/js/auth/sessionBootstrap.js';
import { EnvelopeError, seal } from '../../resources/js/crypto/envelope.js';
import { deriveKey, KDF_LABELS } from '../../resources/js/crypto/kdf.js';

const USER_ID = '9c8f2e2a-2222-4444-8888-abcdefabcdef';

/** @returns {Uint8Array} Clave maestra de prueba, 32 bytes deterministas. */
function testMasterKey() {
    return new Uint8Array(MASTER_KEY_LENGTH).map((_, index) => index + 1);
}

/**
 * Sella `plaintext` como lo hace `setPasswordPage.js` (líneas 192-208): misma etiqueta, mismo
 * contexto como dato asociado.
 *
 * @param {Uint8Array} masterKey
 * @param {string} plaintext
 * @returns {string}
 */
function sealSettings(masterKey, plaintext) {
    const settingsContext = envelopeContext(USER_ID, ENVELOPE_PURPOSES.Settings);
    const settingsKey = deriveKey({ ikm: masterKey, label: KDF_LABELS.SETTINGS, context: settingsContext });

    return seal({ key: settingsKey, plaintext, associatedData: settingsContext });
}

/**
 * Monta un `document` mínimo. `metas` es un mapa nombre -> contenido; `dataPhrPage` simula la marca
 * de las pantallas de autenticación.
 *
 * @param {{metas?: Record<string, string>, dataPhrPage?: boolean}} [options]
 */
function installFakeDom({ metas = {}, dataPhrPage = false } = {}) {
    const dispatched = [];

    globalThis.document = {
        head: {
            querySelector(selector) {
                const match = /meta\[name="([^"]+)"\]/.exec(selector);
                const name = match === null ? null : match[1];

                if (name === null || !(name in metas)) {
                    return null;
                }

                return {
                    getAttribute: () => metas[name],
                    setAttribute(_attribute, value) {
                        metas[name] = value;
                    },
                };
            },
        },
        querySelector(selector) {
            return selector === '[data-phr-page]' && dataPhrPage ? {} : null;
        },
        dispatchEvent(event) {
            dispatched.push(event);

            return true;
        },
    };

    globalThis.window = { location: { href: '' } };

    return dispatched;
}

/**
 * `fetch` de mentira que anota las peticiones y responde 200. `settings.js` es lo único que lo usa
 * en estas pruebas, así que basta con el cuerpo que `putJson` sabe decodificar.
 *
 * @returns {Array<{url: string, options: object, body: object}>}
 */
function installFakeFetch() {
    const requests = [];

    globalThis.fetch = async (url, options) => {
        requests.push({ url, options, body: JSON.parse(options.body) });

        return { ok: true, status: 200, json: async () => ({ saved: true }) };
    };

    return requests;
}

afterEach(() => {
    forget();
    forgetSettings();
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.fetch;
});

test('loadSettings abre un sobre sellado con la misma derivación y devuelve el objeto', () => {
    const masterKey = testMasterKey();

    adoptMasterKey(masterKey, USER_ID);

    const envelope = sealSettings(masterKey, JSON.stringify({ v: 1, theme: 'dark' }));

    const loaded = loadSettings({ envelope, userId: USER_ID });

    assert.deepEqual(loaded, { v: 1, theme: 'dark' });
    assert.deepEqual(settings(), { v: 1, theme: 'dark' });
    assert.ok(hasSettings());

    /** Lo devuelto es una copia: mutarlo no toca el estado del módulo. */
    loaded.theme = 'light';
    assert.equal(settings().theme, 'dark');
});

test('loadSettings no hace nada cuando la cuenta todavía no tiene sobre', () => {
    adoptMasterKey(testMasterKey(), USER_ID);

    assert.equal(loadSettings({ envelope: undefined, userId: USER_ID }), null);
    assert.equal(loadSettings({ envelope: '', userId: USER_ID }), null);
    assert.equal(hasSettings(), false);
});

test('loadSettings no silencia un sobre que no abre (ADR 0004)', () => {
    const masterKey = testMasterKey();

    adoptMasterKey(masterKey, USER_ID);

    /** Sellado con un contexto de otro usuario: el dato asociado no cuadra al abrir. */
    const envelope = sealSettings(masterKey, '{"v":1}');

    assert.throws(
        () => loadSettings({ envelope, userId: 'otro-usuario' }),
        EnvelopeError
    );
    assert.equal(hasSettings(), false);
});

test('forgetSettings borra los ajustes cargados', () => {
    const masterKey = testMasterKey();

    adoptMasterKey(masterKey, USER_ID);
    loadSettings({ envelope: sealSettings(masterKey, '{"v":1}'), userId: USER_ID });

    assert.ok(hasSettings());

    forgetSettings();

    assert.equal(hasSettings(), false);
    assert.equal(settings(), null);
});

/**
 * La prueba que importa de la vía de escritura: lo que `saveSettings` sella lo abre `loadSettings`.
 * Si la derivación o el dato asociado divergieran, el sobre no volvería a abrirse nunca y no habría
 * forma de re-cifrarlo desde el servidor.
 */
test('saveSettings sella un sobre que loadSettings vuelve a abrir con el mismo objeto', async () => {
    installFakeDom();
    const requests = installFakeFetch();

    adoptMasterKey(testMasterKey(), USER_ID);

    const saved = await saveSettings({
        patch: { glucoseUnit: 'mmol/L' },
        userId: USER_ID,
        url: '/phr/settings',
    });

    assert.deepEqual(saved, { v: 1, glucoseUnit: 'mmol/L' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method, 'PUT');

    const envelope = requests[0].body.encryptedSettings;

    forgetSettings();

    assert.deepEqual(loadSettings({ envelope, userId: USER_ID }), { v: 1, glucoseUnit: 'mmol/L' });
});

test('saveSettings mezcla sobre lo cargado y borra la clave que llega nula', async () => {
    installFakeDom();
    const requests = installFakeFetch();

    const masterKey = testMasterKey();

    adoptMasterKey(masterKey, USER_ID);
    loadSettings({
        envelope: sealSettings(masterKey, JSON.stringify({ v: 1, glucoseUnit: 'mg/dL', theme: 'dark' })),
        userId: USER_ID,
    });

    await saveSettings({ patch: { theme: null, v: 99 }, userId: USER_ID, url: '/phr/settings' });

    assert.deepEqual(settings(), { v: 1, glucoseUnit: 'mg/dL' });

    /** La precondición apunta al sobre que se cargó, no a `*`: la cuenta ya tenía uno. */
    assert.notEqual(requests[0].options.headers['If-Match'], '*');
});

test('saveSettings no toca la memoria si la petición falla', async () => {
    installFakeDom();

    globalThis.fetch = async () => ({ ok: false, status: 412, json: async () => ({ error: 'settings_conflict' }) });

    const masterKey = testMasterKey();

    adoptMasterKey(masterKey, USER_ID);
    loadSettings({ envelope: sealSettings(masterKey, '{"v":1}'), userId: USER_ID });

    await assert.rejects(
        () => saveSettings({ patch: { glucoseUnit: 'mmol/L' }, userId: USER_ID, url: '/phr/settings' }),
        (error) => error.status === 412 && error.code === 'settings_conflict'
    );

    assert.deepEqual(settings(), { v: 1 });
});

test('bootstrapSession no hace nada en una pantalla con data-phr-page', async () => {
    const dispatched = installFakeDom({
        metas: { 'phr-user-id': USER_ID, 'phr-login-url': '/login' },
        dataPhrPage: true,
    });

    await bootstrapSession();

    assert.deepEqual(dispatched, []);
    assert.equal(globalThis.window.location.href, '');
    assert.equal(isUnlocked(), false);
});

test('bootstrapSession no hace nada sin el meta phr-user-id: no hay sesión que recuperar', async () => {
    const dispatched = installFakeDom({ metas: { 'phr-login-url': '/login' } });

    await bootstrapSession();

    assert.deepEqual(dispatched, []);
    assert.equal(globalThis.window.location.href, '');
});

test('bootstrapSession va al login cuando la recuperación dice NeedsLogin', async () => {
    /** Sin `phr-session-secret-url`, `recoverMasterKey` devuelve NeedsLogin sin tocar la red. */
    installFakeDom({ metas: { 'phr-user-id': USER_ID, 'phr-login-url': '/login' } });

    await bootstrapSession();

    assert.equal(globalThis.window.location.href, '/login');
    assert.equal(isUnlocked(), false);
});

test('bootstrapSession no vuelve a recuperar si ya hay clave en memoria', async () => {
    const dispatched = installFakeDom({
        metas: { 'phr-user-id': USER_ID, 'phr-login-url': '/login' },
    });

    adoptMasterKey(testMasterKey(), USER_ID);

    await bootstrapSession();

    /** No hubo redirección ni intento de red: `isUnlocked()` cortó antes de llamar a recuperar. */
    assert.equal(globalThis.window.location.href, '');
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, SESSION_READY_EVENT);
});

/**
 * El idioma es el único campo que viaja fuera del sobre, en claro, porque el servidor tiene que
 * resolverlo para pintar el panel (ADR 0007). `saveSettings` lo recibía de la pantalla de perfil y
 * lo dejaba caer: el cuerpo solo llevaba el sobre, así que elegir idioma no cambiaba nada y el
 * formulario respondía correctamente. Sin esta prueba el fallo es invisible.
 */
test('saveSettings envía el idioma fuera del sobre cuando se le pasa', async () => {
    installFakeDom();
    const requests = installFakeFetch();
    adoptMasterKey(testMasterKey(), USER_ID);

    await saveSettings({
        patch: { glucoseUnit: 'mg/dL' },
        userId: USER_ID,
        locale: 'zh_CN',
        url: '/phr/settings',
    });

    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].body.locale, 'zh_CN');
    assert.ok(typeof requests[0].body.encryptedSettings === 'string');
});

/**
 * Las pantallas que no tocan el idioma no deben reescribirlo: omitirlo del cuerpo es lo que
 * distingue «no lo cambio» de «ponlo a vacío».
 */
test('saveSettings omite el idioma cuando no se le pasa', async () => {
    installFakeDom();
    const requests = installFakeFetch();
    adoptMasterKey(testMasterKey(), USER_ID);

    await saveSettings({ patch: { glucoseUnit: 'mg/dL' }, userId: USER_ID, url: '/phr/settings' });

    assert.strictEqual(requests.length, 1);
    assert.ok(!('locale' in requests[0].body));
});
