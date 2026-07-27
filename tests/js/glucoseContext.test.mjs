/**
 * Checks of `health/glucoseContext.js`: the glucose curve with the meal and insulin markers (ADR
 * 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * Pure logic, with no DOM and no Chart.js. Node's built-in runner, like the rest of `tests/js`:
 *
 *     npm test
 *
 * What is checked here are the ways of lying with this chart: joining over a twelve-hour gap a
 * line nobody measured, mixing a capillary and an interstitial into one series, drawing readings
 * of another unit as if they were comparable, placing a 23:30 dinner in the small hours of whoever
 * looks, and grouping or clipping markers without saying how many.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildGlucoseContext,
    MARKER_CLUSTER_MS,
    MAX_READING_GAP_MS,
} from '../../resources/js/health/glucoseContext.js';

/**
 * @param {object} params
 * @returns {object}
 */
function glucose({ occurredAt, value, unit = 'mg/dL', method = 'capillary', tz = '+00:00' }) {
    return { v: 1, type: 'glucose', tz, occurredAt, data: { value, unit, method, loinc: '41653-7' } };
}

/**
 * @param {object} params
 * @returns {object}
 */
function meal({ occurredAt, mealType = 'lunch', tz = '+00:00' }) {
    return { v: 1, type: 'meal', tz, occurredAt, data: { mealType, foods: [] } };
}

/**
 * @param {object} params
 * @returns {object}
 */
function insulin({ occurredAt, dose = '6', unit = 'U', insulinType = 'rapid', tz = '+00:00' }) {
    return { v: 1, type: 'insulin', tz, occurredAt, data: { dose, unit, insulinType } };
}

// --- No data and a single datum -------------------------------------------------------------------

test('with no events there is no series and no markers, and no counter lies', () => {
    const context = buildGlucoseContext([], { unit: 'mg/dL' });

    assert.deepEqual(context.series, []);
    assert.deepEqual(context.markers, []);
    assert.equal(context.excludedByUnit, 0);
    assert.equal(context.omittedReadings, 0);
    assert.equal(context.groupedMarkers, 0);
});

test('with no glucose at all nothing is drawn, even if there are meals and insulin', () => {
    const context = buildGlucoseContext([
        meal({ occurredAt: '2026-07-04T12:00:00.000000Z' }),
        insulin({ occurredAt: '2026-07-04T12:05:00.000000Z' }),
    ], { unit: 'mg/dL' });

    /** The chart is the relation between the three things: markers over empty axes say nothing. */
    assert.deepEqual(context.series, []);
    assert.deepEqual(context.markers, []);
});

test('a single reading gives a series with one point, without inventing a path for it', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '112' }),
    ], { unit: 'mg/dL' });

    assert.equal(context.series.length, 1);
    assert.deepEqual(context.series[0].points.map((point) => point.y), [112]);
});

// --- One series per measurement method (ADR 0008) -------------------------------------------------

test('the capillary and the interstitial are two series, not an average between them', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '100', method: 'capillary' }),
        glucose({ occurredAt: '2026-07-04T08:30:00.000000Z', value: '160', method: 'interstitial' }),
    ], { unit: 'mg/dL' });

    assert.deepEqual(context.series.map((series) => series.group), ['capillary', 'interstitial']);
    assert.deepEqual(context.series.map((series) => series.points.length), [1, 1]);
});

// --- Gaps are gaps, never zeros -------------------------------------------------------------------

test('a long gap breaks the line instead of crossing it with an invented segment', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '100' }),
        glucose({ occurredAt: '2026-07-04T23:00:00.000000Z', value: '180' }),
    ], { unit: 'mg/dL' });

    const values = context.series[0].points.map((point) => point.y);

    /** The cut is a point with no value: `null` is a gap, and a zero would be a false hypoglycaemia. */
    assert.deepEqual(values, [100, null, 180]);
});

test('readings close together are not split: the gap only cuts when there really is one', () => {
    const start = Date.parse('2026-07-04T08:00:00.000Z');
    const context = buildGlucoseContext([
        glucose({ occurredAt: new Date(start).toISOString(), value: '100' }),
        glucose({ occurredAt: new Date(start + MAX_READING_GAP_MS - 1000).toISOString(), value: '120' }),
    ], { unit: 'mg/dL' });

    assert.deepEqual(context.series[0].points.map((point) => point.y), [100, 120]);
});

// --- Nothing is converted between units (ADR 0007) ------------------------------------------------

test('whatever is in another unit is excluded and counted, never converted', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '112' }),
        glucose({ occurredAt: '2026-07-04T09:00:00.000000Z', value: '6.2', unit: 'mmol/L' }),
    ], { unit: 'mg/dL' });

    assert.equal(context.excludedByUnit, 1);
    assert.deepEqual(context.series[0].points.map((point) => point.y), [112]);
});

// --- The time is the one of whoever recorded, not of whoever looks --------------------------------

test('the instant of a reading is its wall clock time, with the offset of the event itself', () => {
    const context = buildGlucoseContext([
        /** 23:30 on the 4th in Madrid, recorded as 21:30 UTC. */
        glucose({ occurredAt: '2026-07-04T21:30:00.000000Z', value: '140', tz: '+02:00' }),
    ], { unit: 'mg/dL' });

    const [point] = context.series[0].points;

    assert.equal(new Date(point.x).toISOString(), '2026-07-04T23:30:00.000Z');
});

test('a meal marker is placed with the zone of the event, not with that of the browser', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T12:00:00.000000Z', value: '110', tz: '-05:00' }),
        meal({ occurredAt: '2026-07-04T18:00:00.000000Z', tz: '-05:00' }),
    ], { unit: 'mg/dL' });

    /** 18:00 UTC in New York is one in the afternoon for that person. */
    assert.equal(new Date(context.markers[0].x).toISOString(), '2026-07-04T13:00:00.000Z');
});

// --- Markers: what they carry and what is grouped -------------------------------------------------

test('the insulin marker carries the dose, which is the datum it has to show', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T12:00:00.000000Z', value: '110' }),
        insulin({ occurredAt: '2026-07-04T12:30:00.000000Z', dose: '6', unit: 'U' }),
    ], { unit: 'mg/dL' });

    const [marker] = context.markers;

    assert.equal(marker.kind, 'insulin');
    assert.match(marker.short, /6/);
    assert.match(marker.items[0], /6/);
});

test('an injection with no readable dose is still drawn: the injection happened', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T12:00:00.000000Z', value: '110' }),
        insulin({ occurredAt: '2026-07-04T12:30:00.000000Z', dose: '' }),
    ], { unit: 'mg/dL' });

    assert.equal(context.markers.length, 1);
    assert.equal(context.markers[0].short, '');
});

test('neighbouring markers are grouped into one, and how many were grouped is stated', () => {
    const start = Date.parse('2026-07-04T12:00:00.000Z');
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T11:00:00.000000Z', value: '110' }),
        insulin({ occurredAt: new Date(start).toISOString(), dose: '4' }),
        insulin({ occurredAt: new Date(start + MARKER_CLUSTER_MS / 2).toISOString(), dose: '2' }),
    ], { unit: 'mg/dL' });

    assert.equal(context.markers.length, 1);
    assert.equal(context.markers[0].count, 2);
    /** What is grouped is declared: a hidden marker is an injection the eye takes as not having happened. */
    assert.equal(context.groupedMarkers, 1);
});

test('a meal and an injection at the same time are not grouped together: they are different things', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T11:00:00.000000Z', value: '110' }),
        meal({ occurredAt: '2026-07-04T12:00:00.000000Z' }),
        insulin({ occurredAt: '2026-07-04T12:01:00.000000Z' }),
    ], { unit: 'mg/dL' });

    assert.deepEqual(context.markers.map((marker) => marker.kind), ['meal', 'insulin']);
    assert.equal(context.groupedMarkers, 0);
});

// --- Nothing is clipped in silence ----------------------------------------------------------------

test('the clip keeps the most recent readings and states how many were left out', () => {
    const start = Date.parse('2026-07-04T00:00:00.000Z');
    const events = Array.from({ length: 5 }, (unused, index) => glucose({
        occurredAt: new Date(start + index * 60_000).toISOString(),
        value: String(100 + index),
    }));

    const context = buildGlucoseContext(events, { unit: 'mg/dL', maxReadings: 3 });

    assert.deepEqual(context.series[0].points.map((point) => point.y), [102, 103, 104]);
    assert.equal(context.omittedReadings, 2);
});

test('a marker earlier than the first drawn reading is counted, not swallowed', () => {
    const start = Date.parse('2026-07-04T00:00:00.000Z');
    const events = [
        meal({ occurredAt: new Date(start).toISOString() }),
        ...Array.from({ length: 3 }, (unused, index) => glucose({
            occurredAt: new Date(start + (index + 1) * 60_000).toISOString(),
            value: String(100 + index),
        })),
    ];

    const context = buildGlucoseContext(events, { unit: 'mg/dL', maxReadings: 2 });

    assert.equal(context.omittedMarkers, 1);
    assert.deepEqual(context.markers, []);
});

test('an event with no readable value or with an unreadable instant is discarded and counted', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '112' }),
        glucose({ occurredAt: '2026-07-04T09:00:00.000000Z', value: 'sin valor' }),
        meal({ occurredAt: 'no es una fecha' }),
    ], { unit: 'mg/dL' });

    assert.equal(context.discarded, 2);
    assert.equal(context.series[0].points.length, 1);
});
