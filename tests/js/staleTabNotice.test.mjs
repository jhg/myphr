/**
 * What an open tab does when the server stops recognising it
 * (`resources/js/guards/staleTabNotice.js`).
 *
 * The fake document only carries the four calls the module makes, in the style of
 * `chartLegend.test.mjs`: no DOM implementation is pulled in, because what has to be proved here is
 * that one notice appears, that it says it in the reader's language, and — above all — that
 * Livewire's own handling is prevented, which is what today dumps a raw error page over a health
 * record.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
    installStaleTabNotice,
    isStaleTabStatus,
    showStaleTabNotice,
    STALE_TAB_NOTICE_ID,
} from '../../resources/js/guards/staleTabNotice.js';
import { DEFAULT_LOCALE, setLocale } from '../../resources/js/i18n/index.js';

/** Minimal element: children, attributes, text and click listeners. */
class FakeElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.attributes = {};
        this.textContent = '';
        this.listeners = {};
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    addEventListener(name, handler) {
        this.listeners[name] = handler;
    }

    append(...children) {
        this.children.push(...children);
    }

    /** All descendants with a given tag, in order. */
    find(tagName) {
        return this.children.flatMap((child) => [
            ...(child.tagName === tagName ? [child] : []),
            ...child.find(tagName),
        ]);
    }
}

let doc;

beforeEach(() => {
    const byId = new Map();

    doc = {
        body: new FakeElement('body'),
        createElement: (tagName) => new FakeElement(tagName),
        getElementById: (id) => byId.get(id) ?? null,
        /** The module identifies the notice by id, so the fake has to remember what it inserted. */
        remember: (element) => byId.set(element.id, element),
    };
});

afterEach(() => {
    setLocale(DEFAULT_LOCALE);
});

test('isStaleTabStatus: only 404 and 419 mean the tab no longer matches the server', () => {
    assert.equal(isStaleTabStatus(404), true);
    assert.equal(isStaleTabStatus(419), true);
    assert.equal(isStaleTabStatus(500), false);
    assert.equal(isStaleTabStatus(null), false);
    assert.equal(isStaleTabStatus(undefined), false);
});

test('showStaleTabNotice: puts up one notice, with the reload button, in the active locale', () => {
    setLocale('es');

    const notice = showStaleTabNotice(doc, () => {});

    assert.equal(notice.id, STALE_TAB_NOTICE_ID);
    assert.equal(notice.attributes.role, 'alert');
    assert.equal(doc.body.children.length, 1);

    const [message] = notice.find('p');
    const [button] = notice.find('button');

    assert.match(message.textContent, /Recárgala/);
    assert.equal(button.textContent, 'Recargar la página');
});

test('showStaleTabNotice: the button reloads, and only when it is pressed', () => {
    let reloads = 0;

    const notice = showStaleTabNotice(doc, () => {
        reloads += 1;
    });

    assert.equal(reloads, 0, 'a stale tab must never reload on its own: half-typed readings would go with it');

    notice.find('button')[0].listeners.click();

    assert.equal(reloads, 1);
});

test('showStaleTabNotice: a second failed message does not stack a second notice', () => {
    const first = showStaleTabNotice(doc, () => {});

    doc.remember(first);

    assert.equal(showStaleTabNotice(doc, () => {}), null);
    assert.equal(doc.body.children.length, 1);
});

/**
 * Drives the interceptor the way Livewire does: the callback registers `onError`, and Livewire
 * later invokes it with the response and its own `preventDefault`.
 */
function interceptWith(status) {
    let onError = null;
    let defaultPrevented = false;

    installStaleTabNotice(
        { interceptMessage: (callback) => callback({ onError: (handler) => { onError = handler; } }) },
        doc,
    );

    onError({ response: { status }, preventDefault: () => { defaultPrevented = true; } });

    return defaultPrevented;
}

test('installStaleTabNotice: a 404 shows the notice and stops Livewire dumping its error page', () => {
    assert.equal(interceptWith(404), true);
    assert.equal(doc.body.children.length, 1);
});

test('installStaleTabNotice: a 419 stops the untranslated native confirm as well', () => {
    assert.equal(interceptWith(419), true);
    assert.equal(doc.body.children.length, 1);
});

test('installStaleTabNotice: a server error is left alone, so a real failure is not hidden', () => {
    assert.equal(interceptWith(500), false);
    assert.equal(doc.body.children.length, 0);
});

test('installStaleTabNotice: without the Livewire interceptor it installs nothing and says so', () => {
    assert.equal(installStaleTabNotice({}, doc), false);
});
