/**
 * Checks of `health/bodyMassIndex.js` (ADR 0004, ADR 0005, ADR 0006).
 *
 * What is tested here is not arithmetic for its own sake: it is the figure the weight screen and
 * the profile show next to a clinical datum. The three cases that matter are BMI with both pairs
 * of units, the absence of a height —which has to give "there is no BMI" and never a zero— and
 * the choice of the last known height when the record does not bring one.
 *
 * Node's built-in runner, like the rest of `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    bodyMassIndex,
    heightInMeters,
    heightKnownAt,
    measurementUnitLabel,
    weightInKilograms,
} from '../../resources/js/health/bodyMassIndex.js';

/**
 * A decrypted weight event, with the shape of ADR 0006. The value travels as a string.
 *
 * @param {string} occurredAt
 * @param {string} value
 * @param {{value: string, unit: string}|null} [height]
 * @returns {{occurredAt: string, content: object}}
 */
function weightEvent(occurredAt, value, height = null) {
    const data = { value, unit: 'kg', loinc: '3141-9' };

    if (height !== null) {
        data.height = { ...height, loinc: '8302-2' };
    }

    return { occurredAt, content: { v: 1, type: 'bodyWeight', data } };
}

test('bodyMassIndex: kilograms and centimetres', () => {
    /** 70 / 1.75² = 22.857… → 22.9 with one decimal. */
    assert.equal(
        bodyMassIndex({ weight: { value: '70', unit: 'kg' }, height: { value: '175', unit: 'cm' } }),
        22.9,
    );
});

test('bodyMassIndex: pounds and inches give the same figure as their metric equivalent', () => {
    /**
     * 154.324 lb and 68.898 in are 70 kg and 175 cm. Both pairs of units landing on the same figure
     * is what proves the conversion uses the exact factors and not a homemade rounding.
     */
    const metric = bodyMassIndex({ weight: { value: '70', unit: 'kg' }, height: { value: '175', unit: 'cm' } });
    const imperial = bodyMassIndex({
        weight: { value: '154.32', unit: '[lb_av]' },
        height: { value: '68.9', unit: '[in_i]' },
    });

    assert.equal(imperial, metric);
});

test('bodyMassIndex: with no height recorded there is no BMI, and it is not zero', () => {
    for (const height of [null, undefined]) {
        const bmi = bodyMassIndex({ weight: { value: '70', unit: 'kg' }, height });

        assert.equal(bmi, null);
        assert.notEqual(bmi, 0);
    }
});

test('bodyMassIndex: with no weight there is no BMI either', () => {
    assert.equal(bodyMassIndex({ weight: null, height: { value: '175', unit: 'cm' } }), null);
});

test('bodyMassIndex: an unusable value gives null instead of NaN or Infinity', () => {
    const cases = [
        { weight: { value: '0', unit: 'kg' }, height: { value: '175', unit: 'cm' } },
        { weight: { value: '70', unit: 'kg' }, height: { value: '0', unit: 'cm' } },
        { weight: { value: 'setenta', unit: 'kg' }, height: { value: '175', unit: 'cm' } },
        { weight: { value: '70', unit: 'st' }, height: { value: '175', unit: 'cm' } },
        { weight: { value: '70', unit: 'kg' }, height: { value: '175', unit: 'in' } },
    ];

    for (const params of cases) {
        assert.equal(bodyMassIndex(params), null, JSON.stringify(params));
    }
});

test('the conversions use the exact factors', () => {
    assert.equal(weightInKilograms('1', '[lb_av]'), 0.45359237);
    assert.equal(heightInMeters('1', '[in_i]'), 0.0254);
    assert.equal(heightInMeters('180', 'cm'), 1.8);
    assert.equal(weightInKilograms('70', 'kg'), 70);
});

test('heightKnownAt: takes the last height that is not later than the record', () => {
    const events = [
        weightEvent('2026-01-10T08:00:00.000000Z', '70', { value: '170', unit: 'cm' }),
        weightEvent('2026-03-10T08:00:00.000000Z', '71'),
        weightEvent('2026-05-10T08:00:00.000000Z', '72', { value: '174', unit: 'cm' }),
    ];

    const known = heightKnownAt(events, '2026-04-01T08:00:00.000000Z');

    /** The one of January, not the one of May: a growing person did not measure in April what they measure in May. */
    assert.equal(known.value, '170');
    assert.equal(known.occurredAt, '2026-01-10T08:00:00.000000Z');
});

test('heightKnownAt: the same instant counts, which is the case of weight and height in one record', () => {
    const events = [weightEvent('2026-01-10T08:00:00.000000Z', '70', { value: '170', unit: 'cm' })];

    assert.equal(heightKnownAt(events, '2026-01-10T08:00:00.000000Z').value, '170');
});

test('heightKnownAt: with no earlier height it returns null', () => {
    const events = [weightEvent('2026-05-10T08:00:00.000000Z', '72', { value: '174', unit: 'cm' })];

    assert.equal(heightKnownAt(events, '2026-01-01T08:00:00.000000Z'), null);
    assert.equal(heightKnownAt([weightEvent('2026-01-01T08:00:00.000000Z', '70')], '2026-06-01T08:00:00.000000Z'), null);
});

test('the BMI of a record with no height comes from the last known one', () => {
    const events = [
        weightEvent('2026-01-10T08:00:00.000000Z', '68', { value: '175', unit: 'cm' }),
        weightEvent('2026-02-10T08:00:00.000000Z', '70'),
    ];

    const weighing = events[1];
    const height = heightKnownAt(events, weighing.occurredAt);

    assert.equal(
        bodyMassIndex({ weight: { value: weighing.content.data.value, unit: 'kg' }, height }),
        22.9,
    );
});

/** It is what the profile asks for: `null` as the bound, that is the most recent height of all. */
test('heightKnownAt with a null bound: the most recent of all', () => {
    const events = [
        weightEvent('2026-01-10T08:00:00.000000Z', '70', { value: '170', unit: 'cm' }),
        weightEvent('2026-05-10T08:00:00.000000Z', '72', { value: '174', unit: 'cm' }),
        weightEvent('2026-06-10T08:00:00.000000Z', '72'),
    ];

    assert.equal(heightKnownAt(events, null).value, '174');
    assert.equal(heightKnownAt([weightEvent('2026-06-10T08:00:00.000000Z', '72')], null), null);
});

test('measurementUnitLabel: the UCUM code is stored, the label is shown', () => {
    assert.equal(measurementUnitLabel('[lb_av]'), 'lb');
    assert.equal(measurementUnitLabel('[in_i]'), 'in');
    assert.equal(measurementUnitLabel('cm'), 'cm');
    /** An unknown code is returned as is: ugly, but it never hides the datum. */
    assert.equal(measurementUnitLabel('furlong'), 'furlong');
});
