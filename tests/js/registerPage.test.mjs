/**
 * Checks of the pure functions of `registerPage.js` (public sign-up).
 *
 * Only what needs no DOM: `submit()` and `run()` depend on `document`, `window` and the
 * `@serenity-kit/opaque` WebAssembly, like the rest of `tests/js/auth.test.mjs`. What can be
 * tested without mounting anything is the password comparison and the translation of the server
 * failure, including the case of its own 409 `login_taken`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AuthRequestError } from '../../resources/js/auth/http.js';
import { OpaqueConfigurationError } from '../../resources/js/auth/opaqueClient.js';
import { describeFailure, passwordsMatch } from '../../resources/js/auth/registerPage.js';
import { setLocale, t } from '../../resources/js/i18n/index.js';

// --- passwordsMatch -------------------------------------------------------------------------------

test('passwordsMatch: accepts two identical passwords', () => {
    assert.equal(passwordsMatch('correct horse battery staple', 'correct horse battery staple'), true);
});

test('passwordsMatch: rejects any difference, including capitalization alone', () => {
    assert.equal(passwordsMatch('Secreto123', 'secreto123'), false);
    assert.equal(passwordsMatch('Secreto123', 'Secreto124'), false);
    assert.equal(passwordsMatch('Secreto123', ''), false);
});

// --- describeFailure --------------------------------------------------------------------------

test('describeFailure: the 409 login_taken is a case of its own, with the action flagged', () => {
    setLocale('en');

    const described = describeFailure(new AuthRequestError('Request failed.', 409, 'login_taken'));

    assert.equal(described.message, t('register.error.loginTaken'));
    assert.equal(described.loginTaken, true);
});

test('describeFailure: a network failure does not carry the go-and-sign-in action', () => {
    setLocale('en');

    const described = describeFailure(new AuthRequestError('The request could not be sent.'));

    assert.equal(described.message, t('common.network'));
    assert.equal(described.loginTaken, false);
});

test('describeFailure: 422 invalid_registration and any other code fall into the generic one', () => {
    setLocale('en');

    assert.equal(
        describeFailure(new AuthRequestError('Request failed.', 422, 'invalid_registration')).message,
        t('register.error.generic'),
    );
    assert.equal(
        describeFailure(new AuthRequestError('Request failed.', 500, null)).message,
        t('register.error.generic'),
    );
});

test('describeFailure: an OPAQUE configuration error is told apart from a wrong password', () => {
    setLocale('en');

    const described = describeFailure(new OpaqueConfigurationError('boom'));

    assert.equal(described.message, t('common.configuration'));
    assert.equal(described.loginTaken, false);
});

test('describeFailure: any other failure falls into the generic message, never into login_taken', () => {
    setLocale('en');

    const described = describeFailure(new Error('unexpected'));

    assert.equal(described.message, t('register.error.generic'));
    assert.equal(described.loginTaken, false);
});

test('describeFailure: the message comes out in the active language', () => {
    setLocale('es');

    assert.equal(
        describeFailure(new AuthRequestError('Request failed.', 409, 'login_taken')).message,
        'Ya existe una cuenta con ese correo electrónico.',
    );

    setLocale('en');
});
