/**
 * Comprobaciones de las funciones puras de `registerPage.js` (alta pública).
 *
 * Solo lo que no necesita DOM: `submit()` y `run()` dependen de `document`, `window` y del
 * WebAssembly de `@serenity-kit/opaque`, igual que el resto de `tests/js/auth.test.mjs`. Lo que sí
 * se puede probar sin montar nada es la comparación de contraseñas y la traducción del fallo del
 * servidor, incluido el caso propio del 409 `login_taken`.
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

test('passwordsMatch: acepta dos contraseñas iguales', () => {
    assert.equal(passwordsMatch('correct horse battery staple', 'correct horse battery staple'), true);
});

test('passwordsMatch: rechaza cualquier diferencia, incluida solo la capitalización', () => {
    assert.equal(passwordsMatch('Secreto123', 'secreto123'), false);
    assert.equal(passwordsMatch('Secreto123', 'Secreto124'), false);
    assert.equal(passwordsMatch('Secreto123', ''), false);
});

// --- describeFailure --------------------------------------------------------------------------

test('describeFailure: el 409 login_taken es su propio caso, con la acción marcada', () => {
    setLocale('en');

    const described = describeFailure(new AuthRequestError('Request failed.', 409, 'login_taken'));

    assert.equal(described.message, t('register.error.loginTaken'));
    assert.equal(described.loginTaken, true);
});

test('describeFailure: un fallo de red no lleva la acción de ir a iniciar sesión', () => {
    setLocale('en');

    const described = describeFailure(new AuthRequestError('The request could not be sent.'));

    assert.equal(described.message, t('common.network'));
    assert.equal(described.loginTaken, false);
});

test('describeFailure: 422 invalid_registration y cualquier otro código caen en el genérico', () => {
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

test('describeFailure: un error de configuración OPAQUE se distingue de una contraseña incorrecta', () => {
    setLocale('en');

    const described = describeFailure(new OpaqueConfigurationError('boom'));

    assert.equal(described.message, t('common.configuration'));
    assert.equal(described.loginTaken, false);
});

test('describeFailure: cualquier otro fallo cae en el mensaje genérico, nunca en login_taken', () => {
    setLocale('en');

    const described = describeFailure(new Error('unexpected'));

    assert.equal(described.message, t('register.error.generic'));
    assert.equal(described.loginTaken, false);
});

test('describeFailure: el mensaje sale en el idioma activo', () => {
    setLocale('es');

    assert.equal(
        describeFailure(new AuthRequestError('Request failed.', 409, 'login_taken')).message,
        'Ya existe una cuenta con ese correo electrónico.',
    );

    setLocale('en');
});
