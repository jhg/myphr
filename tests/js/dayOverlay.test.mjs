/**
 * Checks of `health/dayOverlay.js`: the overlay of days on a 24-hour axis (ADR 0004, ADR 0006,
 * ADR 0007, ADR 0008).
 *
 * Pure logic, with no DOM and no Chart.js:
 *
 *     npm test
 *
 * What is watched here is what would make this chart false: an hour with no readings and an
 * invented median, a capillary and an interstitial averaged into the same thick line, readings of
 * another unit slipped into the cloud, the hour of the day resolved with the browser zone —which
 * would shift the whole daily pattern— and days clipped without saying so.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDayOverlay, hourOfDay } from '../../resources/js/health/dayOverlay.js';

/**
 * @param {object} params
 * @returns {object}
 */
function glucose({ occurredAt, value, unit = 'mg/dL', method = 'capillary', tz = '+00:00' }) {
    return { v: 1, type: 'glucose', tz, occurredAt, data: { value, unit, method, loinc: '41653-7' } };
}

/**
 * Median of one particular hour of a group, or `null` if that hour has none.
 *
 * @param {object} group
 * @param {number} hour
 * @returns {number|null}
 */
function medianAt(group, hour) {
    return group.median[hour].y;
}

// --- No data and a single datum ------------------------------------------------------------------

test('with no readings there is no group and no overlaid day', () => {
    const overlay = buildDayOverlay([], { unit: 'mg/dL' });

    assert.deepEqual(overlay.groups, []);
    assert.equal(overlay.dayCount, 0);
    assert.equal(overlay.omittedDays, 0);
});

test('a single reading gives one day with one point and one single hour with a median', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:30:00.000000Z', value: '112' }),
    ], { unit: 'mg/dL' });

    const [group] = overlay.groups;

    assert.equal(overlay.dayCount, 1);
    assert.deepEqual(group.days.map((day) => day.day), ['2026-07-04']);
    assert.equal(group.days[0].points[0].x, 8.5);
    assert.equal(medianAt(group, 8), 112);
});

// --- Hours with no readings are gaps, never zeros ------------------------------------------------

test('the hourly median has the 24 slots and the empty ones go to a gap, never to a zero', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:30:00.000000Z', value: '112' }),
    ], { unit: 'mg/dL' });

    const [group] = overlay.groups;

    assert.equal(group.median.length, 24);
    /** A zero in glucose is a lethal hypoglycaemia: it is not drawn where nothing was measured. */
    assert.equal(medianAt(group, 3), null);
    assert.equal(group.median.filter((point) => point.y !== null).length, 1);
});

test('the median of an hour is that of every reading of that hour on every day', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:10:00.000000Z', value: '100' }),
        glucose({ occurredAt: '2026-07-05T08:40:00.000000Z', value: '140' }),
        glucose({ occurredAt: '2026-07-06T08:50:00.000000Z', value: '180' }),
    ], { unit: 'mg/dL' });

    assert.equal(medianAt(overlay.groups[0], 8), 140);
    assert.equal(overlay.dayCount, 3);
});

test('the median point is placed at the centre of its slot, not at the start', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:10:00.000000Z', value: '100' }),
    ], { unit: 'mg/dL' });

    assert.equal(overlay.groups[0].median[8].x, 8.5);
});

// --- One series per measurement method (ADR 0008) ------------------------------------------------

test('each method has its own days and its own hourly median', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:10:00.000000Z', value: '100', method: 'capillary' }),
        glucose({ occurredAt: '2026-07-04T08:20:00.000000Z', value: '200', method: 'interstitial' }),
    ], { unit: 'mg/dL' });

    assert.deepEqual(overlay.groups.map((group) => group.group), ['capillary', 'interstitial']);
    assert.equal(medianAt(overlay.groups[0], 8), 100);
    assert.equal(medianAt(overlay.groups[1], 8), 200);
});

// --- Nothing is converted between units (ADR 0007) -----------------------------------------------

test('whatever is in another unit is excluded and counted', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:10:00.000000Z', value: '112' }),
        glucose({ occurredAt: '2026-07-04T09:10:00.000000Z', value: '6.2', unit: 'mmol/L' }),
    ], { unit: 'mg/dL' });

    assert.equal(overlay.excludedByUnit, 1);
    assert.equal(medianAt(overlay.groups[0], 9), null);
});

// --- The hour of the day is the one of whoever recorded ------------------------------------------

test('the hour of the day comes from the offset of the event itself, not from the browser', () => {
    const overlay = buildDayOverlay([
        /** 23:30 on the 4th in Madrid, recorded as 21:30 UTC. */
        glucose({ occurredAt: '2026-07-04T21:30:00.000000Z', value: '140', tz: '+02:00' }),
    ], { unit: 'mg/dL' });

    const [group] = overlay.groups;

    assert.deepEqual(group.days.map((day) => day.day), ['2026-07-04']);
    assert.equal(group.days[0].points[0].x, 23.5);
    assert.equal(medianAt(group, 23), 140);
});

test('hourOfDay never goes outside the range of a day', () => {
    assert.equal(hourOfDay(Date.parse('2026-07-04T00:00:00.000Z')), 0);
    assert.equal(hourOfDay(Date.parse('2026-07-04T23:45:00.000Z')), 23.75);
    /** An instant before the epoch still gives an hour of the day, not a negative number. */
    assert.equal(hourOfDay(-3_600_000), 23);
});

// --- Nothing is clipped in silence ----------------------------------------------------------------

test('the most recent days are kept and how many were left out is stated', () => {
    const events = Array.from({ length: 5 }, (unused, index) => glucose({
        occurredAt: `2026-07-0${index + 1}T08:00:00.000000Z`,
        value: String(100 + index),
    }));

    const overlay = buildDayOverlay(events, { unit: 'mg/dL', maxDays: 3 });

    assert.deepEqual(overlay.groups[0].days.map((day) => day.day), ['2026-07-03', '2026-07-04', '2026-07-05']);
    assert.equal(overlay.dayCount, 3);
    assert.equal(overlay.omittedDays, 2);
    /** The median describes the cloud that is seen, not one including days that are not drawn. */
    assert.equal(medianAt(overlay.groups[0], 8), 103);
});

test('an event with no readable value is discarded and counted, it does not slip in as a zero', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '112' }),
        glucose({ occurredAt: '2026-07-04T09:00:00.000000Z', value: '' }),
    ], { unit: 'mg/dL' });

    assert.equal(overlay.discarded, 1);
    assert.equal(medianAt(overlay.groups[0], 9), null);
});

test('the days of a group arrive sorted and so do their points, by hour of the day', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-05T20:00:00.000000Z', value: '150' }),
        glucose({ occurredAt: '2026-07-04T07:00:00.000000Z', value: '90' }),
        glucose({ occurredAt: '2026-07-05T06:00:00.000000Z', value: '110' }),
    ], { unit: 'mg/dL' });

    const [group] = overlay.groups;

    assert.deepEqual(group.days.map((day) => day.day), ['2026-07-04', '2026-07-05']);
    assert.deepEqual(group.days[1].points.map((point) => point.x), [6, 20]);
});
