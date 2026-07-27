/**
 * Checks of `health/dailyBands.js` (ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * Pure logic, with no DOM and no Chart.js: the exported functions are called directly. Node's
 * built-in runner, like the rest of `tests/js`.
 *
 *     npm test
 *
 * What matters most here are the three rules of the band, because all three are ways of lying with
 * a chart if implemented badly: a day with no readings drawn as a zero, a day with a single
 * reading disguised as a range, and the day of an event computed with the time zone of whoever
 * looks instead of that of whoever recorded it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildDailyBands,
    enumerateDays,
    eventDayKey,
    MAX_CHART_DAYS,
    tzOffsetMinutes,
} from '../../resources/js/health/dailyBands.js';

/**
 * @param {object} params
 * @returns {{v: 1, type: string, tz: string, occurredAt: string, data: object}}
 */
function glucoseEvent({ occurredAt, value, unit = 'mg/dL', method = 'capillary', tz = '+00:00' }) {
    return { v: 1, type: 'glucose', tz, occurredAt, data: { value, unit, method, loinc: '41653-7' } };
}

// --- The day is the one of the event, not of the browser ------------------------------------------

test('eventDayKey uses the offset the event was recorded with', () => {
    /** 23:30 on the 4th in Madrid in summer is 21:30 UTC: the person's day is the 4th. */
    assert.equal(eventDayKey('2026-07-04T21:30:00.000000Z', '+02:00'), '2026-07-04');

    /** And 20:30 on the 4th in New York is already the 5th in UTC: the person's day is still the 4th. */
    assert.equal(eventDayKey('2026-07-05T00:30:00.000000Z', '-04:00'), '2026-07-04');
});

test('eventDayKey falls back to UTC when the envelope brings no usable offset', () => {
    assert.equal(eventDayKey('2026-07-05T00:30:00.000000Z'), '2026-07-05');
    assert.equal(eventDayKey('2026-07-05T00:30:00.000000Z', 'Z'), '2026-07-05');
    assert.equal(eventDayKey('2026-07-05T00:30:00.000000Z', 'Europe/Madrid'), '2026-07-05');
});

test('eventDayKey returns an empty string if the instant cannot be read, instead of inventing a day', () => {
    assert.equal(eventDayKey('no es una fecha', '+02:00'), '');
});

test('tzOffsetMinutes understands the sign and the minutes, and guesses nothing else', () => {
    assert.equal(tzOffsetMinutes('+02:00'), 120);
    assert.equal(tzOffsetMinutes('-05:30'), -330);
    assert.equal(tzOffsetMinutes(undefined), 0);
    assert.equal(tzOffsetMinutes('+2:00'), 0);
});

test('two events of the same instant fall on different days depending on each offset', () => {
    const { days, series } = buildDailyBands(
        [
            glucoseEvent({ occurredAt: '2026-07-05T00:30:00.000000Z', value: '100', tz: '-04:00' }),
            glucoseEvent({ occurredAt: '2026-07-05T00:30:00.000000Z', value: '200', tz: '+02:00' }),
        ],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.deepEqual(days, ['2026-07-04', '2026-07-05']);
    assert.deepEqual(series[0].points.map((point) => point?.median ?? null), [100, 200]);
});

// --- Gaps -----------------------------------------------------------------------------------------

test('a day with no readings is a gap, never a zero', () => {
    const { days, series } = buildDailyBands(
        [
            glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '110' }),
            glucoseEvent({ occurredAt: '2026-07-04T09:00:00.000000Z', value: '130' }),
        ],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    /** The axis covers the whole stretch: otherwise the two days with data would come out adjacent. */
    assert.deepEqual(days, ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']);
    assert.deepEqual(series[0].points, [
        { median: 110, min: 110, max: 110, count: 1 },
        null,
        null,
        { median: 130, min: 130, max: 130, count: 1 },
    ]);
});

test('a method that did not measure one day leaves a gap in its series, not a zero inherited from the other', () => {
    const { series } = buildDailyBands(
        [
            glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '110', method: 'capillary' }),
            glucoseEvent({ occurredAt: '2026-07-02T09:00:00.000000Z', value: '95', method: 'interstitial' }),
        ],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.deepEqual(series.map((entry) => entry.group), ['capillary', 'interstitial']);
    assert.deepEqual(series[0].points.map((point) => point?.median ?? null), [110, null]);
    assert.deepEqual(series[1].points.map((point) => point?.median ?? null), [null, 95]);
});

test('with no reading at all there is no axis and no series, and no day is invented', () => {
    const bands = buildDailyBands([], { type: 'glucose', groupBy: 'method', unit: 'mg/dL' });

    assert.deepEqual(bands, { days: [], series: [], excludedByUnit: 0, discarded: 0, omittedDays: 0 });
});

// --- A single datum ---------------------------------------------------------------------------------

test('a day with a single reading collapses the band into a point', () => {
    const { series } = buildDailyBands(
        [glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '117.5' })],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.deepEqual(series[0].points, [{ median: 117.5, min: 117.5, max: 117.5, count: 1 }]);
});

test('a day with several readings gives median and extremes of that day', () => {
    const { series } = buildDailyBands(
        [
            glucoseEvent({ occurredAt: '2026-07-01T08:00:00.000000Z', value: '80' }),
            glucoseEvent({ occurredAt: '2026-07-01T13:00:00.000000Z', value: '120' }),
            glucoseEvent({ occurredAt: '2026-07-01T21:00:00.000000Z', value: '200' }),
        ],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.deepEqual(series[0].points, [{ median: 120, min: 80, max: 200, count: 3 }]);
});

// --- Exclusions, always counted -----------------------------------------------------------------

test('the readings in another unit are counted apart and do not enter the band (ADR 0007)', () => {
    const { series, excludedByUnit } = buildDailyBands(
        [
            glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '110' }),
            glucoseEvent({ occurredAt: '2026-07-01T10:00:00.000000Z', value: '6.1', unit: 'mmol/L' }),
        ],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.equal(excludedByUnit, 1);
    assert.deepEqual(series[0].points, [{ median: 110, min: 110, max: 110, count: 1 }]);
});

test('whatever brings no number is discarded and counted, without taking the series down', () => {
    const qualitative = glucoseEvent({ occurredAt: '2026-07-01T10:00:00.000000Z', value: undefined });
    delete qualitative.data.value;
    qualitative.data.result = 'negative';

    const { series, discarded } = buildDailyBands(
        [glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '110' }), qualitative],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.equal(discarded, 1);
    assert.equal(series[0].points[0].count, 1);
});

test('events of another type are neither counted nor discarded: they are not of this chart', () => {
    const bands = buildDailyBands(
        [{ v: 1, type: 'meal', tz: '+00:00', occurredAt: '2026-07-01T09:00:00.000000Z', data: { mealType: 'lunch' } }],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.deepEqual(bands, { days: [], series: [], excludedByUnit: 0, discarded: 0, omittedDays: 0 });
});

// --- Several quantities of the same event (blood pressure) ---------------------------------------

test('blood pressure comes out with one series per quantity inside each method, in the requested order', () => {
    const events = [
        {
            v: 1,
            type: 'bloodPressure',
            tz: '+00:00',
            occurredAt: '2026-07-01T09:00:00.000000Z',
            data: { systolic: '120', diastolic: '80', pulse: '70', method: 'left_sitting', unit: 'mmHg' },
        },
        {
            v: 1,
            type: 'bloodPressure',
            tz: '+00:00',
            occurredAt: '2026-07-01T21:00:00.000000Z',
            data: { systolic: '140', diastolic: '90', pulse: '72', method: 'left_sitting', unit: 'mmHg' },
        },
    ];

    const { series } = buildDailyBands(events, {
        type: 'bloodPressure',
        valueKeys: ['systolic', 'diastolic'],
        groupBy: 'method',
        unit: 'mmHg',
    });

    assert.deepEqual(series.map((entry) => entry.valueKey), ['systolic', 'diastolic']);
    assert.deepEqual(series[0].points, [{ median: 130, min: 120, max: 140, count: 2 }]);
    assert.deepEqual(series[1].points, [{ median: 85, min: 80, max: 90, count: 2 }]);
});

test('a blood pressure event missing one quantity is discarded whole', () => {
    const { series, discarded } = buildDailyBands(
        [{
            v: 1,
            type: 'bloodPressure',
            tz: '+00:00',
            occurredAt: '2026-07-01T09:00:00.000000Z',
            data: { systolic: '120', method: 'left_sitting', unit: 'mmHg' },
        }],
        { type: 'bloodPressure', valueKeys: ['systolic', 'diastolic'], groupBy: 'method', unit: 'mmHg' },
    );

    assert.equal(discarded, 1);
    assert.deepEqual(series, []);
});

// --- Types with no grouping and the axis cap ------------------------------------------------------

test('a type that does not group falls into a single series with an empty group', () => {
    const { series } = buildDailyBands(
        [{
            v: 1,
            type: 'bodyWeight',
            tz: '+00:00',
            occurredAt: '2026-07-01T09:00:00.000000Z',
            data: { value: '70.4', unit: 'kg' },
        }],
        { type: 'bodyWeight', unit: 'kg' },
    );

    assert.equal(series.length, 1);
    assert.equal(series[0].group, '');
});

test('a stretch longer than the cap keeps the recent days and states how many it leaves out', () => {
    const events = [
        glucoseEvent({ occurredAt: '2020-01-01T09:00:00.000000Z', value: '100' }),
        glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '120' }),
    ];

    const { days, omittedDays } = buildDailyBands(events, { type: 'glucose', groupBy: 'method', unit: 'mg/dL' });

    assert.equal(days.length, MAX_CHART_DAYS);
    assert.equal(days[days.length - 1], '2026-07-01');
    assert.ok(omittedDays > 0);
});

test('enumerateDays covers both ends and crosses the month change', () => {
    assert.deepEqual(enumerateDays('2026-02-27', '2026-03-02'), [
        '2026-02-27',
        '2026-02-28',
        '2026-03-01',
        '2026-03-02',
    ]);
    assert.deepEqual(enumerateDays('2026-07-01', '2026-07-01'), ['2026-07-01']);
});
