/**
 * Comprobaciones de `pwa/installPrompt.js`.
 *
 * Lo que se prueba es la decisión, que es donde un fallo se ve como un botón que no debería estar:
 * cuándo hay algo que ofrecer, cuándo la aplicación ya está instalada y cómo se reconoce un iPad
 * que dice ser un Mac. El diálogo de instalación en sí no se puede probar sin navegador, y no hace
 * falta: la parte nuestra es elegir la rama.
 *
 * Corredor incorporado de Node, como el resto de `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installMode, isInstalled, isIos } from '../../resources/js/pwa/installPrompt.js';

/** Ventana de mentira: solo lo que leen las dos funciones de detección. */
function fakeWindow({ userAgent = '', maxTouchPoints = 0, standalone = undefined, displayMode = 'browser' } = {}) {
    return {
        navigator: { userAgent, maxTouchPoints, standalone },
        matchMedia: (query) => ({ matches: query === `(display-mode: ${displayMode})` }),
    };
}

// --- installMode --------------------------------------------------------------------------------

test('installMode: con evento del navegador, el botón instala de verdad', () => {
    assert.equal(installMode({ installed: false, ios: false, hasPrompt: true }), 'prompt');
});

test('installMode: en iOS sin evento, el botón solo puede explicar el gesto', () => {
    assert.equal(installMode({ installed: false, ios: true, hasPrompt: false }), 'ios');
});

test('installMode: sin evento y fuera de iOS no hay nada que ofrecer', () => {
    assert.equal(installMode({ installed: false, ios: false, hasPrompt: false }), 'hidden');
});

/** En iOS instalada se sigue detectando iOS, así que «ya instalada» tiene que ganar. */
test('installMode: si ya está instalada, no se ofrece nada aunque sea iOS', () => {
    assert.equal(installMode({ installed: true, ios: true, hasPrompt: false }), 'hidden');
    assert.equal(installMode({ installed: true, ios: false, hasPrompt: true }), 'hidden');
});

// --- isInstalled --------------------------------------------------------------------------------

test('isInstalled: reconoce el modo standalone del estándar', () => {
    assert.equal(isInstalled(fakeWindow({ displayMode: 'standalone' })), true);
    assert.equal(isInstalled(fakeWindow()), false);
});

/** WebKit no responde `display-mode`: en iOS la única señal es esta propiedad no estándar. */
test('isInstalled: reconoce el navigator.standalone de iOS', () => {
    assert.equal(isInstalled(fakeWindow({ userAgent: 'iPhone', standalone: true })), true);
    assert.equal(isInstalled(fakeWindow({ userAgent: 'iPhone', standalone: false })), false);
});

// --- isIos --------------------------------------------------------------------------------------

test('isIos: iPhone, iPad y iPod', () => {
    for (const agent of ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'Mozilla/5.0 (iPad; CPU OS 15_0)', '(iPod touch)']) {
        assert.equal(isIos(fakeWindow({ userAgent: agent })), true, agent);
    }
});

/**
 * El iPad con iPadOS se presenta como un Mac de escritorio. Sin el desempate táctil se quedaría sin
 * botón justo el dispositivo donde más falta hace, porque ahí no hay `beforeinstallprompt`.
 */
test('isIos: un iPad que dice ser un Mac se reconoce por la pantalla táctil', () => {
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

    assert.equal(isIos(fakeWindow({ userAgent: ipad, maxTouchPoints: 5 })), true);
    assert.equal(isIos(fakeWindow({ userAgent: ipad, maxTouchPoints: 0 })), false);
});

test('isIos: un escritorio cualquiera no es iOS', () => {
    assert.equal(isIos(fakeWindow({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0' })), false);
    assert.equal(isIos(fakeWindow({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' })), false);
});
