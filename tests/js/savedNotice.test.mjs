/**
 * Checks of `health/savedNotice.js`, the "record saved" notice the four event screens
 * share.
 *
 * What matters here is the life cycle of the notice, not its look: that it appears, that it goes
 * away on its own, and above all that a new save restarts the count instead of inheriting the
 * timer of the previous one —otherwise the notice of the second save would switch off half-way and
 * a good record would be left unconfirmed—. The clock is faked with the fake timers of the Node
 * runner: really waiting four seconds would make the suite slow and brittle.
 *
 * Node's built-in runner, like the rest of `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SAVED_NOTICE_MS, savedNotice } from '../../resources/js/health/savedNotice.js';

test('savedNotice: starts hidden', () => {
    const component = savedNotice();

    assert.equal(component.saved, false);
    assert.equal(component.savedTimer, null);
});

test('savedNotice: confirmSaved shows the notice and removes it on its own when the time is up', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const component = savedNotice();

    component.confirmSaved();

    assert.equal(component.saved, true);

    /** An instant before the deadline it is still visible: the notice lasts what it says it lasts. */
    t.mock.timers.tick(SAVED_NOTICE_MS - 1);
    assert.equal(component.saved, true);

    t.mock.timers.tick(1);
    assert.equal(component.saved, false);
    assert.equal(component.savedTimer, null);
});

test('savedNotice: saving again restarts the count instead of inheriting the timer', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const component = savedNotice();

    component.confirmSaved();
    t.mock.timers.tick(SAVED_NOTICE_MS - 100);

    /** Second save almost at the end of the first notice. */
    component.confirmSaved();

    /**
     * If the timer of the first one were still alive, it would already have switched off the notice
     * of the second, leaving a good save unconfirmed.
     */
    t.mock.timers.tick(100);
    assert.equal(component.saved, true);

    t.mock.timers.tick(SAVED_NOTICE_MS - 100);
    assert.equal(component.saved, false);
});

test('savedNotice: clearSaved removes the notice right away and cancels the timer', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const component = savedNotice();

    component.confirmSaved();
    component.clearSaved();

    assert.equal(component.saved, false);
    assert.equal(component.savedTimer, null);

    /** And the cancelled timer cannot bring the notice back later. */
    t.mock.timers.tick(SAVED_NOTICE_MS);
    assert.equal(component.saved, false);
});
