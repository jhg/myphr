/**
 * Checks of the pure logic of `auth/profilePage.js` (ADR 0004, ADR 0007).
 *
 * Alpine is not mounted: `profilePage()` only orchestrates DOM and requests. What is tested is the
 * validation of the glucose target range, which is where a silent failure turns into a false
 * clinical instruction: a half range, a reversed one, or one with an invented end.
 *
 * Node's built-in runner, like the rest of `tests/js` (see `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildSettingsPatch,
    parseGlucoseTargetRange,
    summarizeBodyMeasurements,
} from '../../resources/js/auth/profilePage.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/**
 * These tests assert the text **in Spanish**, so they set the language instead of assuming it: the
 * client default language is English (as in `config/app.php`), and in Node there is no
 * `<html lang>` to work it out from. Without this line, the text assertions below would be
 * checking the fallback catalog without saying so.
 */
setLocale('es');

test('parseGlucoseTargetRange: both limits blank mean "not configured"', () => {
    assert.equal(parseGlucoseTargetRange({ lowRaw: '', highRaw: '', unit: 'mg/dL' }), null);
    assert.equal(parseGlucoseTargetRange({ lowRaw: '   ', highRaw: '  ', unit: 'mg/dL' }), null);
});

test('parseGlucoseTargetRange: returns numbers and keeps the unit it was written in', () => {
    assert.deepEqual(
        parseGlucoseTargetRange({ lowRaw: '70', highRaw: '180', unit: 'mg/dL' }),
        { low: 70, high: 180, unit: 'mg/dL' },
    );

    assert.deepEqual(
        parseGlucoseTargetRange({ lowRaw: '3,9', highRaw: '10', unit: 'mmol/L' }),
        { low: 3.9, high: 10, unit: 'mmol/L' },
    );
});

test('parseGlucoseTargetRange: rejects a half range', () => {
    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '70', highRaw: '', unit: 'mg/dL' }),
        /los dos límites/i,
    );

    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '', highRaw: '180', unit: 'mg/dL' }),
        /los dos límites/i,
    );
});

test('parseGlucoseTargetRange: demands that the lower one is smaller than the upper one', () => {
    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '180', highRaw: '70', unit: 'mg/dL' }),
        /menor que el superior/i,
    );

    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '100', highRaw: '100', unit: 'mg/dL' }),
        /menor que el superior/i,
    );
});

test('parseGlucoseTargetRange: rejects zero as a limit', () => {
    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '0', highRaw: '180', unit: 'mg/dL' }),
        /mayores que cero/i,
    );
});

test('parseGlucoseTargetRange: inherits the numeric validation of numericValue.js', () => {
    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '70.123', highRaw: '180', unit: 'mg/dL' }),
        /2 decimales/,
    );

    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '-70', highRaw: '180', unit: 'mg/dL' }),
        /negativo/,
    );

    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: 'setenta', highRaw: '180', unit: 'mg/dL' }),
        /número/,
    );
});

test('parseGlucoseTargetRange: rejects a unit that is not UCUM', () => {
    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '70', highRaw: '180', unit: 'mg/l' }),
        /unidad válida/i,
    );
});

test('buildSettingsPatch: with no range, the key is deleted with null', () => {
    assert.deepEqual(
        buildSettingsPatch({ glucoseUnit: 'mg/dL', lowRaw: '', highRaw: '', rangeUnit: 'mg/dL' }),
        { glucoseUnit: 'mg/dL', glucoseTargetRange: null },
    );
});

test('buildSettingsPatch: with a range, it is included as is', () => {
    assert.deepEqual(
        buildSettingsPatch({ glucoseUnit: 'mmol/L', lowRaw: '3.9', highRaw: '10', rangeUnit: 'mmol/L' }),
        { glucoseUnit: 'mmol/L', glucoseTargetRange: { low: 3.9, high: 10, unit: 'mmol/L' } },
    );
});

test('buildSettingsPatch: rejects a preferred unit that is not UCUM', () => {
    assert.throws(
        () => buildSettingsPatch({ glucoseUnit: 'mgdl', lowRaw: '', highRaw: '', rangeUnit: 'mg/dL' }),
        /unidad válida/i,
    );
});

/*
|--------------------------------------------------------------------------
| Read-only block: latest body measurements
|--------------------------------------------------------------------------
|
| The profile records nothing: it shows the last weight, the last height and the BMI, computed here
| from the decrypted envelopes. What is tested is that the last weight and the last height can come
| from different records —height is optional in each one— and that with no height at all no BMI
| appears.
|
*/

/**
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

test('summarizeBodyMeasurements: the last weight and the last height may come from different records', () => {
    const summary = summarizeBodyMeasurements([
        weightEvent('2026-01-10T08:00:00.000000Z', '68', { value: '175', unit: 'cm' }),
        weightEvent('2026-05-10T08:00:00.000000Z', '70'),
        weightEvent('2026-03-10T08:00:00.000000Z', '69'),
    ]);

    assert.equal(summary.weight.value, '70');
    assert.equal(summary.weight.occurredAt, '2026-05-10T08:00:00.000000Z');
    assert.equal(summary.height.value, '175');
    assert.equal(summary.height.occurredAt, '2026-01-10T08:00:00.000000Z');
    assert.equal(summary.bmi, 22.9);
});

test('summarizeBodyMeasurements: with no height recorded there is no BMI', () => {
    const summary = summarizeBodyMeasurements([weightEvent('2026-05-10T08:00:00.000000Z', '70')]);

    assert.equal(summary.weight.value, '70');
    assert.equal(summary.height, null);
    /** No zero and no invented figure: the screen shows no BMI. */
    assert.equal(summary.bmi, null);
});

test('summarizeBodyMeasurements: with no record at all it invents nothing', () => {
    assert.deepEqual(summarizeBodyMeasurements([]), { weight: null, height: null, bmi: null });
});

test('summarizeBodyMeasurements: the BMI comes out with pounds and inches the same as with kilos and centimetres', () => {
    const imperial = summarizeBodyMeasurements([{
        occurredAt: '2026-05-10T08:00:00.000000Z',
        content: {
            v: 1,
            type: 'bodyWeight',
            data: {
                value: '154.32',
                unit: '[lb_av]',
                loinc: '3141-9',
                height: { value: '68.9', unit: '[in_i]', loinc: '8302-2' },
            },
        },
    }]);

    assert.equal(imperial.bmi, 22.9);
});
