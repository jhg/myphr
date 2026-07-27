/**
 * Checks of `settings.js` and `sessionBootstrap.js` (Spec 0001 §6.1 step 10 and §6.2).
 *
 * Unlike `auth.test.mjs`, these modules do touch `document` (and, through `recovery.js` and
 * `keyring.js`, `window` and `sessionStorage`), so each test mounts a minimal DOM by hand: exactly
 * what `http.js`, `recovery.js` and `sessionBootstrap.js` read (`document.head`, a handful of
 * `<meta>` and `document.querySelector('[data-phr-page]')`). Everything is restored at the end of
 * each test so no state leaks between them.
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

/** @returns {Uint8Array} Test master key, 32 deterministic bytes. */
function testMasterKey() {
    return new Uint8Array(MASTER_KEY_LENGTH).map((_, index) => index + 1);
}

/**
 * Seals `plaintext` the way `setPasswordPage.js` does (lines 192-208): same label, same context as
 * associated data.
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
 * Mounts a minimal `document`. `metas` is a name -> content map; `dataPhrPage` simulates the
 * marker of the authentication screens.
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
 * Fake `fetch` that notes the requests and answers 200. `settings.js` is the only thing that uses
 * it in these tests, so the body `putJson` can decode is enough.
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

test('loadSettings opens an envelope sealed with the same derivation and returns the object', () => {
    const masterKey = testMasterKey();

    adoptMasterKey(masterKey, USER_ID);

    const envelope = sealSettings(masterKey, JSON.stringify({ v: 1, theme: 'dark' }));

    const loaded = loadSettings({ envelope, userId: USER_ID });

    assert.deepEqual(loaded, { v: 1, theme: 'dark' });
    assert.deepEqual(settings(), { v: 1, theme: 'dark' });
    assert.ok(hasSettings());

    /** What is returned is a copy: mutating it does not touch the module state. */
    loaded.theme = 'light';
    assert.equal(settings().theme, 'dark');
});

test('loadSettings does nothing when the account has no envelope yet', () => {
    adoptMasterKey(testMasterKey(), USER_ID);

    assert.equal(loadSettings({ envelope: undefined, userId: USER_ID }), null);
    assert.equal(loadSettings({ envelope: '', userId: USER_ID }), null);
    assert.equal(hasSettings(), false);
});

test('loadSettings does not silence an envelope that does not open (ADR 0004)', () => {
    const masterKey = testMasterKey();

    adoptMasterKey(masterKey, USER_ID);

    /** Sealed with the context of another user: the associated data does not match on opening. */
    const envelope = sealSettings(masterKey, '{"v":1}');

    assert.throws(
        () => loadSettings({ envelope, userId: 'otro-usuario' }),
        EnvelopeError
    );
    assert.equal(hasSettings(), false);
});

test('forgetSettings wipes the loaded settings', () => {
    const masterKey = testMasterKey();

    adoptMasterKey(masterKey, USER_ID);
    loadSettings({ envelope: sealSettings(masterKey, '{"v":1}'), userId: USER_ID });

    assert.ok(hasSettings());

    forgetSettings();

    assert.equal(hasSettings(), false);
    assert.equal(settings(), null);
});

/**
 * The test that matters of the write path: what `saveSettings` seals is opened by `loadSettings`.
 * If the derivation or the associated data diverged, the envelope would never open again and there
 * would be no way to re-encrypt it from the server.
 */
test('saveSettings seals an envelope that loadSettings opens again with the same object', async () => {
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

test('saveSettings merges over what was loaded and deletes the key that arrives null', async () => {
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

    /** The precondition points at the envelope that was loaded, not at `*`: the account already had one. */
    assert.notEqual(requests[0].options.headers['If-Match'], '*');
});

test('saveSettings does not touch memory if the request fails', async () => {
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

test('bootstrapSession does nothing on a screen with data-phr-page', async () => {
    const dispatched = installFakeDom({
        metas: { 'phr-user-id': USER_ID, 'phr-login-url': '/login' },
        dataPhrPage: true,
    });

    await bootstrapSession();

    assert.deepEqual(dispatched, []);
    assert.equal(globalThis.window.location.href, '');
    assert.equal(isUnlocked(), false);
});

test('bootstrapSession does nothing without the phr-user-id meta: there is no session to recover', async () => {
    const dispatched = installFakeDom({ metas: { 'phr-login-url': '/login' } });

    await bootstrapSession();

    assert.deepEqual(dispatched, []);
    assert.equal(globalThis.window.location.href, '');
});

test('bootstrapSession goes to the login when the recovery says NeedsLogin', async () => {
    /** Without `phr-session-secret-url`, `recoverMasterKey` returns NeedsLogin without touching the network. */
    installFakeDom({ metas: { 'phr-user-id': USER_ID, 'phr-login-url': '/login' } });

    await bootstrapSession();

    assert.equal(globalThis.window.location.href, '/login');
    assert.equal(isUnlocked(), false);
});

test('bootstrapSession does not recover again if there already is a key in memory', async () => {
    const dispatched = installFakeDom({
        metas: { 'phr-user-id': USER_ID, 'phr-login-url': '/login' },
    });

    adoptMasterKey(testMasterKey(), USER_ID);

    await bootstrapSession();

    /** There was no redirect and no network attempt: `isUnlocked()` cut in before calling recover. */
    assert.equal(globalThis.window.location.href, '');
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, SESSION_READY_EVENT);
});

/**
 * On an F5 inside the panel, `app.js` calls `bootstrapSession()` twice: once through the
 * `readyState` branch and once through `livewire:navigated`, which also fires on the initial load.
 * Without the in-flight guard both calls found no key and both fired `POST /session-secret`, and
 * with `SESSION_DRIVER=database` the second one waits on the session lock of the first: a whole
 * round trip added to the slowest path of a reload, for a request whose answer was already coming.
 */
test('two simultaneous bootstrapSession share one single session-secret request', async () => {
    installFakeDom({
        metas: {
            'phr-user-id': USER_ID,
            'phr-login-url': '/login',
            'phr-session-secret-url': '/phr/auth/session-secret',
            'csrf-token': 'token',
        },
    });

    const requests = [];

    globalThis.fetch = async (url) => {
        requests.push(url);

        /** 401 is the normal answer when the session no longer holds the secret: it ends at the login. */
        return { ok: false, status: 401, json: async () => ({}) };
    };

    await Promise.all([bootstrapSession(), bootstrapSession()]);

    assert.deepEqual(requests, ['/phr/auth/session-secret']);
    assert.equal(globalThis.window.location.href, '/login');
});

/** And a later navigation, with the key still missing, does get a fresh attempt. */
test('the guard is released when the bootstrap ends, so a later navigation tries again', async () => {
    installFakeDom({
        metas: {
            'phr-user-id': USER_ID,
            'phr-login-url': '/login',
            'phr-session-secret-url': '/phr/auth/session-secret',
            'csrf-token': 'token',
        },
    });

    const requests = [];

    globalThis.fetch = async (url) => {
        requests.push(url);

        return { ok: false, status: 401, json: async () => ({}) };
    };

    await bootstrapSession();
    await bootstrapSession();

    assert.equal(requests.length, 2);
});

/**
 * The language is the only field that travels outside the envelope, in the clear, because the
 * server has to resolve it to paint the panel (ADR 0007). `saveSettings` used to receive it from
 * the profile screen and drop it: the body only carried the envelope, so choosing a language
 * changed nothing and the form answered correctly. Without this test the failure is invisible.
 */
test('saveSettings sends the language outside the envelope when it is passed', async () => {
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
 * The screens that do not touch the language must not rewrite it: leaving it out of the body is
 * what tells "I am not changing it" from "set it to empty".
 */
test('saveSettings leaves the language out when it is not passed', async () => {
    installFakeDom();
    const requests = installFakeFetch();
    adoptMasterKey(testMasterKey(), USER_ID);

    await saveSettings({ patch: { glucoseUnit: 'mg/dL' }, userId: USER_ID, url: '/phr/settings' });

    assert.strictEqual(requests.length, 1);
    assert.ok(!('locale' in requests[0].body));
});
