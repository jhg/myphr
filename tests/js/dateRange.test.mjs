/**
 * Checks of `health/dateRange.js`: the history shortcuts and the custom range.
 *
 * Alpine is not mounted: `dateRangeControl()` only mixes state into the component of each screen,
 * and what matters here is the pure logic that decides which two dates are asked of the server.
 * The time offset is always passed explicitly (`timezoneOffsetMinutes`) so the result does not
 * depend on the zone of whoever runs the tests.
 *
 * Node's built-in runner, like the rest of `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    customRange,
    DateRangeError,
    dateRangeControl,
    DEFAULT_RANGE_PRESET,
    localDayStartToCanonical,
    presetRange,
    RANGE_PRESETS,
    resolveRange,
} from '../../resources/js/health/dateRange.js';
import { WINDOW_DAYS } from '../../resources/js/health/statistics.js';
import { setLocale } from '../../resources/js/i18n/index.js';

setLocale('es');

/** UTC, so local midnights and UTC ones coincide and the computation reads at a glance. */
const UTC = { timezoneOffsetMinutes: 0 };

/** Madrid in March: UTC+1, which `getTimezoneOffset()` expresses as -60. */
const MADRID_WINTER = { timezoneOffsetMinutes: -60 };

const REFERENCE = new Date('2026-03-20T10:30:00.000Z');

// --- Relative shortcuts -------------------------------------------------------------------------

/**
 * The default used to be `all` so that introducing the filter hid no records. Now it clips to the
 * last 24 hours: without clipping, opening the history downloads and decrypts everything in the
 * browser of whoever is looking, and that only gets worse over the years. The objection of then
 * still holds and is paid for in the interface —period notice and "see every record" button, see
 * `tests/Feature/HealthEventRangeTest.php`—, not by lowering the ambition of the default.
 */
test('the default shortcut clips to the last 24 hours, so as not to decrypt years by default', () => {
    assert.equal(DEFAULT_RANGE_PRESET, 'day');

    assert.deepEqual(presetRange(DEFAULT_RANGE_PRESET, REFERENCE), {
        from: '2026-03-19T10:30:00.000000Z',
        to: null,
    });

    /** `all` still exists, and is still the range with no ends. */
    assert.deepEqual(presetRange('all', REFERENCE), { from: null, to: null });
});

test('"last week" counts the same days as the home dashboard', () => {
    assert.equal(WINDOW_DAYS.week, 7);

    assert.deepEqual(presetRange('week', REFERENCE), {
        from: '2026-03-13T10:30:00.000000Z',
        to: null,
    });
});

test('"last month" counts the same days as the home dashboard', () => {
    assert.equal(WINDOW_DAYS.month, 30);

    assert.deepEqual(presetRange('month', REFERENCE), {
        from: '2026-02-18T10:30:00.000000Z',
        to: null,
    });
});

/**
 * The upper end of the relative shortcuts is left open on purpose: a record dated a few minutes
 * ahead of the clock would disappear from the history right after saving it.
 */
test('the relative shortcuts set no ceiling, so a record ahead of the clock is not hidden', () => {
    for (const preset of ['day', 'week', 'month']) {
        assert.equal(presetRange(preset, REFERENCE).to, null);
    }
});

test('an unknown shortcut fails instead of returning an invented range', () => {
    assert.throws(() => presetRange('trimestre', REFERENCE), DateRangeError);
});

test('the shortcut tokens are the ones the dropdown offers', () => {
    assert.deepEqual([...RANGE_PRESETS], ['all', 'day', 'week', 'month', 'custom']);
});

/** The default period of every screen: 24 hours back, like the other shortcuts. */
test('"last day" is the last 24 hours, not the calendar day', () => {
    assert.equal(WINDOW_DAYS.day, 1);

    assert.deepEqual(presetRange('day', REFERENCE), {
        from: '2026-03-19T10:30:00.000000Z',
        to: null,
    });
});

// --- Custom range -------------------------------------------------------------------------------

test('the custom range covers both full days, with the end excluded', () => {
    /**
     * From the 3rd to the 10th included: the upper end is midnight on the 11th, not a
     * `23:59:59.999999`. That way the half-open `[from, to)` range of the server does not leave out
     * a record from the last fraction of a second of the 10th.
     */
    assert.deepEqual(customRange('2026-03-03', '2026-03-10', UTC), {
        from: '2026-03-03T00:00:00.000000Z',
        to: '2026-03-11T00:00:00.000000Z',
    });
});

test('a single-day range is still a 24-hour stretch', () => {
    assert.deepEqual(customRange('2026-03-03', '2026-03-03', UTC), {
        from: '2026-03-03T00:00:00.000000Z',
        to: '2026-03-04T00:00:00.000000Z',
    });
});

/**
 * The person picks a day on their calendar, not an instant in UTC: clipping by UTC midnight would
 * move the cut by an hour and would slip in —or hide— the records on the edge.
 */
test('the ends are local midnights, converted to the UTC instant that matches them', () => {
    assert.deepEqual(customRange('2026-03-03', '2026-03-03', MADRID_WINTER), {
        from: '2026-03-02T23:00:00.000000Z',
        to: '2026-03-03T23:00:00.000000Z',
    });
});

test('the end of a month and of a year really move to the next day', () => {
    assert.equal(customRange('2026-01-31', '2026-01-31', UTC).to, '2026-02-01T00:00:00.000000Z');
    assert.equal(customRange('2026-12-31', '2026-12-31', UTC).to, '2027-01-01T00:00:00.000000Z');
    assert.equal(customRange('2028-02-28', '2028-02-28', UTC).to, '2028-02-29T00:00:00.000000Z');
});

test('a reversed range is rejected instead of returning an empty list with no explanation', () => {
    assert.throws(() => customRange('2026-03-10', '2026-03-03', UTC), DateRangeError);
});

test('with a single date the other one is not guessed', () => {
    assert.throws(() => customRange('2026-03-10', '', UTC), DateRangeError);
    assert.throws(() => customRange('', '2026-03-10', UTC), DateRangeError);
    assert.throws(() => customRange(undefined, undefined, UTC), DateRangeError);
});

test('an impossible day is rejected instead of being normalized to the next month', () => {
    assert.throws(() => localDayStartToCanonical('2026-13-01', UTC), DateRangeError);
    assert.throws(() => localDayStartToCanonical('2026-02-32', UTC), DateRangeError);
    assert.throws(() => localDayStartToCanonical('03/03/2026', UTC), DateRangeError);
});

test('the ADR 0004 canonical form comes out with its six fraction digits and its Z', () => {
    assert.match(localDayStartToCanonical('2026-03-03', UTC), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
});

// --- Resolution of the control -------------------------------------------------------------------

test('resolveRange reads both dates only with the custom shortcut', () => {
    const withDays = { fromDay: '2026-03-03', toDay: '2026-03-10', referenceInstant: REFERENCE, ...UTC };

    assert.deepEqual(resolveRange({ preset: 'custom', ...withDays }), {
        from: '2026-03-03T00:00:00.000000Z',
        to: '2026-03-11T00:00:00.000000Z',
    });

    /** With a relative shortcut, what is typed in the two fields is ignored: the shortcut rules. */
    assert.deepEqual(resolveRange({ preset: 'all', ...withDays }), { from: null, to: null });
    assert.equal(resolveRange({ preset: 'week', ...withDays }).from, '2026-03-13T10:30:00.000000Z');
});

// --- State of the control -------------------------------------------------------------------------

test('the control starts clipped to the default period and with no error', () => {
    const control = dateRangeControl();

    assert.equal(control.rangePreset, DEFAULT_RANGE_PRESET);
    assert.equal(control.rangeFromDay, '');
    assert.equal(control.rangeToDay, '');
    assert.equal(control.rangeError, '');

    /** Really clipped: there is a lower end, and the upper one is still open. */
    const range = control.historyRange();

    assert.notEqual(range.from, null);
    assert.equal(range.to, null);
});

/**
 * The share screen starts at "last month" because there the range is what is going to be shared,
 * not a reading convenience: they are two different decisions about the same control, and the
 * parameter is what avoids writing a second one.
 */
test('the screen can choose which shortcut the control starts with', () => {
    assert.equal(dateRangeControl({ preset: 'month' }).rangePreset, 'month');
    assert.equal(dateRangeControl({ preset: 'all' }).rangePreset, 'all');
    assert.equal(dateRangeControl().rangePreset, DEFAULT_RANGE_PRESET);
});

/**
 * The way out of the clip applied by default. Since the history no longer starts at `all`,
 * removing the filter has to cost one gesture: the button of the period notice calls here, and
 * this leaves the range open, clears the custom dates and reloads with no further intervention.
 */
test('"see every record" removes the clip in one gesture and reloads the history', () => {
    let reloads = 0;

    const page = {
        ...dateRangeControl(),
        loadHistory() {
            reloads += 1;
        },
    };

    page.rangePreset = 'custom';
    page.rangeFromDay = '2026-03-03';
    page.rangeToDay = '2026-03-10';

    page.showAllRecords();

    assert.equal(page.rangePreset, 'all');
    assert.deepEqual(page.historyRange(), { from: null, to: null });
    assert.equal(page.rangeFromDay, '', 'dos fechas escritas parecerían seguir aplicándose');
    assert.equal(page.rangeToDay, '');
    assert.equal(reloads, 1);
});

test('a badly typed range leaves the whole history and explains why', () => {
    const control = dateRangeControl();

    control.rangePreset = 'custom';
    control.rangeFromDay = '2026-03-10';

    /** With no end date: everything is shown with a warning, not a blank screen. */
    assert.deepEqual(control.historyRange(), { from: null, to: null });
    assert.notEqual(control.rangeError, '');

    control.rangeToDay = '2026-03-12';
    const range = control.historyRange();

    assert.equal(control.rangeError, '', 'el aviso tiene que irse en cuanto el rango vale');
    assert.notEqual(range.from, null);
    assert.notEqual(range.to, null);
});

test('applying the range reloads the history of the screen that mixes it in', () => {
    let reloads = 0;

    const page = {
        ...dateRangeControl(),
        loadHistory() {
            reloads += 1;
        },
    };

    page.applyRange();

    assert.equal(reloads, 1);
});
