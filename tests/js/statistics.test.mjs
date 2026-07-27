/**
 * Checks of `health/statistics.js` (ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * Pure logic, with no DOM and no Chart.js: the exported functions are called directly.
 * Node's built-in runner, like the rest of `tests/js` (see `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    dominantUnit,
    majorityUnit,
    summarizeBloodPressurePeriod,
    summarizeGlucosePeriod,
    summarizeMeasurementPeriod,
    unitCount,
} from '../../resources/js/health/statistics.js';

/**
 * These functions no longer clip by window: the period is applied by the server when asking for
 * the events (`[from, to)` of `HealthEventPage::fetchEvents()`), so the ones of the chosen period
 * arrive here. What is tested is the computation, not the clipping.
 */

/**
 * @param {object} params
 * @returns {{v: 1, type: 'glucose', tz: string, occurredAt: string, data: object}}
 */
function glucoseEvent({ occurredAt, value, unit = 'mg/dL', method = 'capillary', result }) {
    const data = { unit, method, loinc: '41653-7' };

    if (result !== undefined) {
        data.result = result;
    } else {
        data.value = value;
    }

    return { v: 1, type: 'glucose', tz: '+00:00', occurredAt, data };
}

/**
 * @param {object} params
 * @returns {{v: 1, type: 'bloodPressure', tz: string, occurredAt: string, data: object}}
 */
function bpEvent({ occurredAt, systolic, diastolic, pulse, method = 'left_sitting' }) {
    return {
        v: 1,
        type: 'bloodPressure',
        tz: '+00:00',
        occurredAt,
        data: { systolic, diastolic, pulse, method },
    };
}

// --- Glucose -----------------------------------------------------------------------------------

test('summarizeGlucosePeriod: an empty list gives a well-formed empty summary', () => {
    const summary = summarizeGlucosePeriod([], { unit: 'mg/dL' });

    assert.deepEqual(summary, { byMethod: {}, excludedByUnit: 0, discarded: 0 });
});

test('summarizeGlucosePeriod: mean and median with an odd number of samples', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '100' }),
        glucoseEvent({ occurredAt: 't2', value: '110' }),
        glucoseEvent({ occurredAt: 't3', value: '90' }),
    ];

    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.equal(byMethod.capillary.count, 3);
    assert.equal(byMethod.capillary.mean, 100);
    assert.equal(byMethod.capillary.median, 100); // central sample of [90, 100, 110]
    assert.equal(byMethod.capillary.min, 90);
    assert.equal(byMethod.capillary.max, 110);
});

test('summarizeGlucosePeriod: the median with an even number of samples is the average of the two central ones', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '80' }),
        glucoseEvent({ occurredAt: 't2', value: '90' }),
        glucoseEvent({ occurredAt: 't3', value: '100' }),
        glucoseEvent({ occurredAt: 't4', value: '110' }),
    ];

    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    // [80, 90, 100, 110] -> (90 + 100) / 2 = 95
    assert.equal(byMethod.capillary.median, 95);
    assert.equal(byMethod.capillary.mean, 95);
});

test('summarizeGlucosePeriod: it really separates by measurement method (ADR 0008)', () => {
    const events = [
        glucoseEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', value: '100', method: 'capillary' }),
        glucoseEvent({ occurredAt: '2026-07-25T09:30:00.000000Z', value: '120', method: 'interstitial' }),
        glucoseEvent({ occurredAt: '2026-07-25T10:00:00.000000Z', value: '104', method: 'capillary' }),
    ];

    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.deepEqual(Object.keys(byMethod).sort(), ['capillary', 'interstitial']);
    assert.equal(byMethod.capillary.count, 2);
    assert.equal(byMethod.interstitial.count, 1);

    // The last reading of each method is the one of that method, not the global one.
    assert.equal(byMethod.capillary.last.value, 104);
    assert.equal(byMethod.capillary.last.occurredAt, '2026-07-25T10:00:00.000000Z');
    assert.equal(byMethod.interstitial.last.value, 120);
});

test('summarizeGlucosePeriod: excludes the events in another unit and counts them, without mixing them in', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '100', unit: 'mg/dL' }),
        glucoseEvent({ occurredAt: 't2', value: '5.5', unit: 'mmol/L' }),
        glucoseEvent({ occurredAt: 't3', value: '110', unit: 'mg/dL' }),
    ];

    const { byMethod, excludedByUnit } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.equal(excludedByUnit, 1);
    assert.equal(byMethod.capillary.count, 2);
});

test('summarizeGlucosePeriod: with no target range configured, there is no inRangePercent in any group', () => {
    const events = [glucoseEvent({ occurredAt: 't1', value: '100' })];

    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.equal('inRangePercent' in byMethod.capillary, false);
});

test('summarizeGlucosePeriod: with a target range, it computes the in-range percentage correctly', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '70' }), // outside (low)
        glucoseEvent({ occurredAt: 't2', value: '100' }), // inside
        glucoseEvent({ occurredAt: 't3', value: '110' }), // inside
        glucoseEvent({ occurredAt: 't4', value: '200' }), // outside (high)
    ];

    const { byMethod } = summarizeGlucosePeriod(events, {
        unit: 'mg/dL',
        targetRange: { low: '80', high: '130' },
    });

    assert.equal(byMethod.capillary.inRangePercent, 50);
});

test('summarizeGlucosePeriod: with no target range there are no below or above bands either', () => {
    const events = [glucoseEvent({ occurredAt: 't1', value: '100' })];

    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.equal('belowRangePercent' in byMethod.capillary, false);
    assert.equal('aboveRangePercent' in byMethod.capillary, false);
});

/**
 * "68% in range" does not say whether the remaining 32% are hypoglycaemias or hyperglycaemias,
 * which are opposite clinical situations. The three bands split every reading and that is why they
 * are computed together, not by difference.
 */
test('summarizeGlucosePeriod: it splits the readings into the three bands of the target range', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '60' }), // below
        glucoseEvent({ occurredAt: 't2', value: '79' }), // below
        glucoseEvent({ occurredAt: 't3', value: '100' }), // inside
        glucoseEvent({ occurredAt: 't4', value: '200' }), // above
    ];

    const { byMethod } = summarizeGlucosePeriod(events, {
        unit: 'mg/dL',
        targetRange: { low: '80', high: '130' },
    });

    assert.equal(byMethod.capillary.belowRangePercent, 50);
    assert.equal(byMethod.capillary.inRangePercent, 25);
    assert.equal(byMethod.capillary.aboveRangePercent, 25);
});

/** Both limits are part of the range: a reading exactly on the limit is not outside. */
test('summarizeGlucosePeriod: the range limits count as inside, not as outside', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '80' }),
        glucoseEvent({ occurredAt: 't2', value: '130' }),
    ];

    const { byMethod } = summarizeGlucosePeriod(events, {
        unit: 'mg/dL',
        targetRange: { low: '80', high: '130' },
    });

    assert.equal(byMethod.capillary.inRangePercent, 100);
    assert.equal(byMethod.capillary.belowRangePercent, 0);
    assert.equal(byMethod.capillary.aboveRangePercent, 0);
});

/**
 * A range in another unit does not reach here: `resolveGlucoseTargetRange` discards it first (ADR
 * 0007, nothing is converted). What this test fixes is the consequence, which is what the view
 * needs to know there is no bar to paint: none of the three keys exists.
 */
test('summarizeGlucosePeriod: with no applicable range there is no band to paint', () => {
    const events = [glucoseEvent({ occurredAt: 't1', value: '100' })];

    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL', targetRange: undefined });

    assert.deepEqual(
        ['inRangePercent', 'belowRangePercent', 'aboveRangePercent'].filter((key) => key in byMethod.capillary),
        [],
    );
});

test('summarizeGlucosePeriod: it discards the qualitative results (ADR 0008) without taking the summary down', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '100' }),
        glucoseEvent({ occurredAt: 't2', result: 'positive', method: 'urine' }),
    ];

    const { byMethod, discarded } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.equal(discarded, 1);
    assert.equal('urine' in byMethod, false);
    assert.equal(byMethod.capillary.count, 1);
});

test('summarizeGlucosePeriod: a non-numeric value is discarded and counted, without taking the summary down', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '100' }),
        glucoseEvent({ occurredAt: 't2', value: 'no-es-un-número' }),
        glucoseEvent({ occurredAt: 't3', value: '' }),
    ];

    const { byMethod, discarded } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.equal(discarded, 2);
    assert.equal(byMethod.capillary.count, 1);
});

// --- Blood pressure ------------------------------------------------------------------------------

test('summarizeBloodPressurePeriod: an empty list gives a well-formed empty summary', () => {
    const summary = summarizeBloodPressurePeriod([]);

    assert.deepEqual(summary, { byMethod: {}, discarded: 0 });
});

test('summarizeBloodPressurePeriod: mean, median, range and last reading per quantity', () => {
    const events = [
        bpEvent({ occurredAt: '2026-07-25T08:00:00.000000Z', systolic: '120', diastolic: '80', pulse: '70' }),
        bpEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', systolic: '130', diastolic: '85', pulse: '75' }),
        bpEvent({ occurredAt: '2026-07-25T10:00:00.000000Z', systolic: '140', diastolic: '90', pulse: '80' }),
    ];

    const { byMethod } = summarizeBloodPressurePeriod(events);
    const group = byMethod.left_sitting;

    assert.equal(group.count, 3);
    assert.equal(group.systolic.mean, 130);
    assert.equal(group.systolic.median, 130);
    assert.equal(group.systolic.min, 120);
    assert.equal(group.systolic.max, 140);
    assert.equal(group.diastolic.mean, 85);
    assert.equal(group.pulse.mean, 75);
    assert.deepEqual(group.lastReading, {
        systolic: 140,
        diastolic: 90,
        pulse: 80,
        occurredAt: '2026-07-25T10:00:00.000000Z',
    });
});

test('summarizeBloodPressurePeriod: an event is one single unit with the three quantities (ADR 0006)', () => {
    // Three events of a single quantity each must not be treated as if they were one blood
    // pressure event: they do not bring the other two quantities, so they are discarded whole.
    const events = [
        { v: 1, type: 'bloodPressure', tz: '+00:00', occurredAt: 't1', data: { systolic: '120', method: 'left_sitting' } },
    ];

    const { byMethod, discarded } = summarizeBloodPressurePeriod(events);

    assert.equal(discarded, 1);
    assert.deepEqual(byMethod, {});
});

test('summarizeBloodPressurePeriod: it separates by method (arm and posture, ADR 0008)', () => {
    const events = [
        bpEvent({ occurredAt: 't1', systolic: '120', diastolic: '80', pulse: '70', method: 'left_sitting' }),
        bpEvent({ occurredAt: 't2', systolic: '110', diastolic: '70', pulse: '65', method: 'right_standing' }),
    ];

    const { byMethod } = summarizeBloodPressurePeriod(events);

    assert.deepEqual(Object.keys(byMethod).sort(), ['left_sitting', 'right_standing']);
    assert.equal(byMethod.left_sitting.count, 1);
    assert.equal(byMethod.right_standing.count, 1);
});

// --- Simple quantities: weight, temperature and insulin ------------------------------------------

/**
 * @param {string} type
 * @param {object} data
 * @param {string} occurredAt
 * @returns {object}
 */
function measurementEvent(type, occurredAt, data) {
    return { v: 1, type, tz: '+00:00', occurredAt, data };
}

test('summarizeMeasurementPeriod: with no grouping field, everything falls into a single unnamed group', () => {
    const events = [
        measurementEvent('bodyWeight', 't1', { value: '72.4', unit: 'kg' }),
        measurementEvent('bodyWeight', 't2', { value: '71.6', unit: 'kg' }),
    ];

    const { byGroup } = summarizeMeasurementPeriod(events, { type: 'bodyWeight', unit: 'kg' });

    assert.deepEqual(Object.keys(byGroup), ['']);
    assert.equal(byGroup[''].count, 2);
    assert.equal(byGroup[''].mean, 72);
    assert.equal(byGroup[''].min, 71.6);
    assert.equal(byGroup[''].max, 72.4);
});

/** The measurement site changes what the number means: an axillary and a rectal are not averaged. */
test('summarizeMeasurementPeriod: temperature is separated by measurement site', () => {
    const events = [
        measurementEvent('temperature', '2026-07-25T08:00:00.000000Z', { value: '36.5', unit: 'Cel', site: 'axillary' }),
        measurementEvent('temperature', '2026-07-25T09:00:00.000000Z', { value: '37.1', unit: 'Cel', site: 'oral' }),
        measurementEvent('temperature', '2026-07-25T10:00:00.000000Z', { value: '36.9', unit: 'Cel', site: 'axillary' }),
    ];

    const { byGroup } = summarizeMeasurementPeriod(events, { type: 'temperature', groupBy: 'site', unit: 'Cel' });

    assert.deepEqual(Object.keys(byGroup).sort(), ['axillary', 'oral']);
    assert.equal(byGroup.axillary.count, 2);
    assert.equal(byGroup.axillary.last.value, 36.9);
    assert.equal(byGroup.oral.count, 1);
});

test('summarizeMeasurementPeriod: insulin summarizes the dose, grouped by insulin type', () => {
    const events = [
        measurementEvent('insulin', 't1', { dose: '6', unit: '[iU]', insulinType: 'rapid' }),
        measurementEvent('insulin', 't2', { dose: '8', unit: '[iU]', insulinType: 'rapid' }),
        measurementEvent('insulin', 't3', { dose: '20', unit: '[iU]', insulinType: 'long' }),
    ];

    const { byGroup } = summarizeMeasurementPeriod(events, {
        type: 'insulin',
        valueKey: 'dose',
        groupBy: 'insulinType',
        unit: '[iU]',
    });

    assert.equal(byGroup.rapid.mean, 7);
    assert.equal(byGroup.long.count, 1);
});

/** ADR 0007: kilos and pounds are not averaged together, just like mg/dL and mmol/L. */
test('summarizeMeasurementPeriod: whatever is in another unit is counted apart, not mixed in', () => {
    const events = [
        measurementEvent('bodyWeight', 't1', { value: '72', unit: 'kg' }),
        measurementEvent('bodyWeight', 't2', { value: '160', unit: '[lb_av]' }),
    ];

    const { byGroup, excludedByUnit } = summarizeMeasurementPeriod(events, { type: 'bodyWeight', unit: 'kg' });

    assert.equal(excludedByUnit, 1);
    assert.equal(byGroup[''].count, 1);
});

test('summarizeMeasurementPeriod: a non-numeric value is discarded and counted', () => {
    const events = [
        measurementEvent('bodyWeight', 't1', { value: '72', unit: 'kg' }),
        measurementEvent('bodyWeight', 't2', { value: 'no-es-un-número', unit: 'kg' }),
    ];

    const { byGroup, discarded } = summarizeMeasurementPeriod(events, { type: 'bodyWeight', unit: 'kg' });

    assert.equal(discarded, 1);
    assert.equal(byGroup[''].count, 1);
});

// --- dominantUnit ---------------------------------------------------------------------------------

/**
 * Weight, temperature and insulin have no configurable display unit (glucose does, ADR 0007), so
 * they are summarized with the one of the most recent record: whoever has just changed scales sees
 * the summary in the unit they are using now, not in the one they used months ago.
 */
test('dominantUnit: the unit is the one of the most recent record with a numeric value', () => {
    const events = [
        measurementEvent('bodyWeight', '2026-07-01T08:00:00.000000Z', { value: '160', unit: '[lb_av]' }),
        measurementEvent('bodyWeight', '2026-07-20T08:00:00.000000Z', { value: '72', unit: 'kg' }),
    ];

    assert.equal(dominantUnit(events, 'bodyWeight'), 'kg');
});

test('dominantUnit: with no usable record it invents no unit', () => {
    assert.equal(dominantUnit([], 'bodyWeight'), null);
    assert.equal(
        dominantUnit([measurementEvent('bodyWeight', 't1', { value: '', unit: 'kg' })], 'bodyWeight'),
        null,
    );
});

test('dominantUnit: it looks at the value field it is told to (insulin stores the dose)', () => {
    const events = [measurementEvent('insulin', 't1', { dose: '6', unit: '[iU]', insulinType: 'rapid' })];

    assert.equal(dominantUnit(events, 'insulin', 'dose'), '[iU]');
    assert.equal(dominantUnit(events, 'insulin'), null);
});

// --- majorityUnit and unitCount --------------------------------------------------------------------

/**
 * `dominantUnit` picks by recency and is right in the patient panel, which knows they have just
 * changed scales. In a clipping somebody else reads it is no good: two new readings in another
 * unit would send two hundred to a footnote and leave the card summarizing two records while
 * looking like it summarizes the whole clipping.
 */
test('majorityUnit: the unit of the majority wins, not the one of the most recent reading', () => {
    const events = [
        { type: 'glucose', occurredAt: '2026-07-01T08:00:00.000000Z', data: { value: '110', unit: 'mg/dL' } },
        { type: 'glucose', occurredAt: '2026-07-02T08:00:00.000000Z', data: { value: '120', unit: 'mg/dL' } },
        { type: 'glucose', occurredAt: '2026-07-03T08:00:00.000000Z', data: { value: '7.4', unit: 'mmol/L' } },
    ];

    assert.equal(majorityUnit(events, 'glucose'), 'mg/dL');
    assert.equal(dominantUnit(events, 'glucose'), 'mmol/L');
});

test('majorityUnit: on a tie the most recent one rules, so as not to depend on the array order', () => {
    const events = [
        { type: 'glucose', occurredAt: '2026-07-01T08:00:00.000000Z', data: { value: '110', unit: 'mg/dL' } },
        { type: 'glucose', occurredAt: '2026-07-03T08:00:00.000000Z', data: { value: '7.4', unit: 'mmol/L' } },
    ];

    assert.equal(majorityUnit(events, 'glucose'), 'mmol/L');
    assert.equal(majorityUnit([], 'glucose'), null);
});

test('unitCount: it counts different units, which is what decides whether there is anything to warn about', () => {
    const events = [
        { type: 'glucose', occurredAt: '2026-07-01T08:00:00.000000Z', data: { value: '110', unit: 'mg/dL' } },
        { type: 'glucose', occurredAt: '2026-07-03T08:00:00.000000Z', data: { value: '7.4', unit: 'mmol/L' } },
        { type: 'insulin', occurredAt: '2026-07-03T09:00:00.000000Z', data: { dose: '8', unit: '[iU]' } },
    ];

    assert.equal(unitCount(events, 'glucose'), 2);
    assert.equal(unitCount(events, 'insulin', 'dose'), 1);
    assert.equal(unitCount(events, 'bodyWeight'), 0);
});
