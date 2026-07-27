/**
 * Checks of `pwa/installPrompt.js`.
 *
 * What is tested is the decision, which is where a failure shows up as a button that should not be
 * there: when there is something to offer, when the application is already installed and how an
 * iPad claiming to be a Mac is recognized. The install dialog itself cannot be tested without a
 * browser, and it does not need to be: our part is picking the branch.
 *
 * Node's built-in runner, like the rest of `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installMode, isInstalled, isIos } from '../../resources/js/pwa/installPrompt.js';

/** Fake window: only what the two detection functions read. */
function fakeWindow({ userAgent = '', maxTouchPoints = 0, standalone = undefined, displayMode = 'browser' } = {}) {
    return {
        navigator: { userAgent, maxTouchPoints, standalone },
        matchMedia: (query) => ({ matches: query === `(display-mode: ${displayMode})` }),
    };
}

// --- installMode --------------------------------------------------------------------------------

test('installMode: with a browser event, the button really installs', () => {
    assert.equal(installMode({ installed: false, ios: false, hasPrompt: true }), 'prompt');
});

test('installMode: on iOS with no event, the button can only explain the gesture', () => {
    assert.equal(installMode({ installed: false, ios: true, hasPrompt: false }), 'ios');
});

test('installMode: with no event and outside iOS there is nothing to offer', () => {
    assert.equal(installMode({ installed: false, ios: false, hasPrompt: false }), 'hidden');
});

/** On iOS an installed app is still detected as iOS, so "already installed" has to win. */
test('installMode: if it is already installed, nothing is offered even on iOS', () => {
    assert.equal(installMode({ installed: true, ios: true, hasPrompt: false }), 'hidden');
    assert.equal(installMode({ installed: true, ios: false, hasPrompt: true }), 'hidden');
});

// --- isInstalled --------------------------------------------------------------------------------

test('isInstalled: recognizes the standard standalone mode', () => {
    assert.equal(isInstalled(fakeWindow({ displayMode: 'standalone' })), true);
    assert.equal(isInstalled(fakeWindow()), false);
});

/** WebKit does not answer `display-mode`: on iOS the only signal is this non-standard property. */
test('isInstalled: recognizes the navigator.standalone of iOS', () => {
    assert.equal(isInstalled(fakeWindow({ userAgent: 'iPhone', standalone: true })), true);
    assert.equal(isInstalled(fakeWindow({ userAgent: 'iPhone', standalone: false })), false);
});

// --- isIos --------------------------------------------------------------------------------------

test('isIos: iPhone, iPad and iPod', () => {
    for (const agent of ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'Mozilla/5.0 (iPad; CPU OS 15_0)', '(iPod touch)']) {
        assert.equal(isIos(fakeWindow({ userAgent: agent })), true, agent);
    }
});

/**
 * The iPad on iPadOS presents itself as a desktop Mac. Without the touch tie-breaker, the very
 * device that needs the button most would be left without one: there is no `beforeinstallprompt`.
 */
test('isIos: an iPad claiming to be a Mac is recognized by the touch screen', () => {
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

    assert.equal(isIos(fakeWindow({ userAgent: ipad, maxTouchPoints: 5 })), true);
    assert.equal(isIos(fakeWindow({ userAgent: ipad, maxTouchPoints: 0 })), false);
});

test('isIos: any desktop is not iOS', () => {
    assert.equal(isIos(fakeWindow({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0' })), false);
    assert.equal(isIos(fakeWindow({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' })), false);
});
