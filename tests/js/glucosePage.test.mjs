/**
 * Checks of the pure logic of `health/glucosePage.js` (ADR 0004, ADR 0006, ADR 0008).
 *
 * Neither Alpine nor Chart.js is mounted: `glucosePage()` only orchestrates DOM and external
 * libraries, and that orchestration is not tested here. What is tested is the logic that depends
 * on neither of the two, exported apart so it can be called directly.
 *
 * Node's built-in runner, like the rest of `tests/js` (see `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildGlucoseContent,
    chartCaptionText,
    filterGlucoseEvents,
    groupGlucoseByMethod,
    mealContextLabel,
    resolveLoincCode,
} from '../../resources/js/health/glucosePage.js';
import { datetimeLocalToCanonical, formatTzOffset } from '../../resources/js/health/datetimeLocal.js';
import { parseNumericValue } from '../../resources/js/health/numericValue.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/**
 * These tests assert the text **in Spanish**, so they set the language instead of assuming it: the
 * client default language is English (as in `config/app.php`), and in Node there is no
 * `<html lang>` to work it out from. Without this line, the text assertions below would be
 * checking the fallback catalog without saying so.
 */
setLocale('es');

/** Test common fields, with the shape `buildCommonEventFields` returns (ADR 0006). */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

/** Test LOINC table, with the shape `Glucose::catalog()` returns (ADR 0005, ADR 0008). */
const LOINC_TABLE = Object.freeze([
    { method: 'capillary', unit: 'mg/dL', code: '41653-7' },
    { method: 'capillary', unit: 'mmol/L', code: '14743-9' },
    { method: 'interstitial', unit: 'mg/dL', code: '99504-3' },
    { method: 'interstitial', unit: 'mmol/L', code: '105272-9' },
]);

test('buildGlucoseContent: exact ADR 0006 shape for each combination of method and unit', () => {
    const cases = [
        { method: 'capillary', unit: 'mg/dL', loinc: '41653-7' },
        { method: 'capillary', unit: 'mmol/L', loinc: '14743-9' },
        { method: 'interstitial', unit: 'mg/dL', loinc: '99504-3' },
        { method: 'interstitial', unit: 'mmol/L', loinc: '105272-9' },
    ];

    for (const { method, unit, loinc } of cases) {
        const content = buildGlucoseContent({
            value: '142',
            unit,
            method,
            mealContext: 'fasting',
            tz: '+02:00',
            loincTable: LOINC_TABLE,
            common: COMMON_FIELDS,
        });

        assert.deepEqual(content, {
            v: 1,
            type: 'glucose',
            tz: '+02:00',
            origin: 'manual',
            recordedBy: 'self',
            data: { value: '142', unit, loinc, method, mealContext: 'fasting' },
        });

        assert.equal(typeof content.data.value, 'string', 'value debe ser cadena, nunca número (ADR 0004)');
    }
});

test('buildGlucoseContent: the value reaching the payload is always a string with a dot, after going through parseNumericValue (client numeric criterion)', () => {
    const value = parseNumericValue('7,85', 'El valor');

    const content = buildGlucoseContent({
        value,
        unit: 'mmol/L',
        method: 'capillary',
        mealContext: '',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.value, '7.85');
    assert.equal(typeof content.data.value, 'string');
});

test('buildGlucoseContent: an empty or absent mealContext does not enter data (ADR 0006, optional)', () => {
    const withEmptyString = buildGlucoseContent({
        value: '142',
        unit: 'mg/dL',
        method: 'capillary',
        mealContext: '',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
        common: COMMON_FIELDS,
    });

    assert.equal('mealContext' in withEmptyString.data, false);

    const withoutField = buildGlucoseContent({
        value: '142',
        unit: 'mg/dL',
        method: 'capillary',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
        common: COMMON_FIELDS,
    });

    assert.equal('mealContext' in withoutField.data, false);
});

test('buildGlucoseContent: a mealContext with a value does enter data', () => {
    const content = buildGlucoseContent({
        value: '142',
        unit: 'mg/dL',
        method: 'capillary',
        mealContext: 'after_meal',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.mealContext, 'after_meal');
});

test('buildGlucoseContent: the common fields go at the top level, never inside data', () => {
    const content = buildGlucoseContent({
        value: '142',
        unit: 'mg/dL',
        method: 'capillary',
        mealContext: 'fasting',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
        common: { origin: 'device', recordedBy: 'caregiver', device: 'Freestyle Libre 3', note: 'Nota libre' },
    });

    assert.equal(content.origin, 'device');
    assert.equal(content.recordedBy, 'caregiver');
    assert.equal(content.device, 'Freestyle Libre 3');
    assert.equal(content.note, 'Nota libre');

    assert.equal('origin' in content.data, false);
    assert.equal('recordedBy' in content.data, false);
    assert.equal('device' in content.data, false);
    assert.equal('note' in content.data, false);
});

test('mealContextLabel: tolerates an event with no mealContext and invents nothing', () => {
    const catalog = { mealContexts: [{ token: 'fasting', label: 'En ayunas' }] };

    assert.equal(mealContextLabel(catalog, {}), null);
    assert.equal(mealContextLabel(catalog, { mealContext: '' }), null);
    assert.equal(mealContextLabel(catalog, { mealContext: 'fasting' }), 'En ayunas');
});

test('buildGlucoseContent: with no value, it throws instead of storing something half done', () => {
    assert.throws(() => buildGlucoseContent({
        value: '   ',
        unit: 'mg/dL',
        method: 'capillary',
        mealContext: 'fasting',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
    }));
});

test('resolveLoincCode: a method and unit combination with no code throws and invents none', () => {
    assert.throws(() => resolveLoincCode(LOINC_TABLE, 'capillary', 'g'));
});

test('buildGlucoseContent: it propagates the failure of resolveLoincCode, it never stores without a code', () => {
    assert.throws(() => buildGlucoseContent({
        value: '142',
        unit: 'g',
        method: 'capillary',
        mealContext: 'fasting',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
    }));
});

test('formatTzOffset: sign and leading zeros', () => {
    assert.equal(formatTzOffset(120), '+02:00');
    assert.equal(formatTzOffset(-300), '-05:00');
    assert.equal(formatTzOffset(0), '+00:00');
    assert.equal(formatTzOffset(-30), '-00:30');
});

test('datetimeLocalToCanonical: correct instant with a non-zero offset (Madrid, +02:00)', () => {
    /** `getTimezoneOffset()` for +02:00 is -120 (UTC minus local, see the function JSDoc). */
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-07-25T11:08:07', {
        timezoneOffsetMinutes: -120,
    });

    assert.equal(occurredAt, '2026-07-25T09:08:07.000000Z');
    assert.equal(tz, '+02:00');
});

test('datetimeLocalToCanonical: correct instant with a negative offset (New York, -05:00)', () => {
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-07-25T07:00:00', {
        timezoneOffsetMinutes: 300,
    });

    assert.equal(occurredAt, '2026-07-25T12:00:00.000000Z');
    assert.equal(tz, '-05:00');
});

test('datetimeLocalToCanonical: accepts a datetime-local with no seconds', () => {
    const { occurredAt } = datetimeLocalToCanonical('2026-07-25T11:08', { timezoneOffsetMinutes: 0 });

    assert.equal(occurredAt, '2026-07-25T11:08:00.000000Z');
});

test('filterGlucoseEvents: discards the events that are not of type glucose', () => {
    const events = [
        { id: '1', occurredAt: 'a', content: { type: 'glucose', data: {} } },
        { id: '2', occurredAt: 'b', content: { type: 'insulin', data: {} } },
        { id: '3', occurredAt: 'c', content: { type: 'meal', data: {} } },
        { id: '4', occurredAt: 'd', content: { type: 'glucose', data: {} } },
    ];

    const filtered = filterGlucoseEvents(events);

    assert.deepEqual(filtered.map((event) => event.id), ['1', '4']);
});

test('groupGlucoseByMethod: separates by method and leaves out the ones of another unit, counting them', () => {
    const events = [
        glucoseEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', value: '100', unit: 'mg/dL', method: 'capillary' }),
        glucoseEvent({ occurredAt: '2026-07-25T08:00:00.000000Z', value: '95', unit: 'mg/dL', method: 'capillary' }),
        glucoseEvent({ occurredAt: '2026-07-25T09:30:00.000000Z', value: '110', unit: 'mg/dL', method: 'interstitial' }),
        glucoseEvent({ occurredAt: '2026-07-25T10:00:00.000000Z', value: '6.1', unit: 'mmol/L', method: 'capillary' }),
    ];

    const { seriesByMethod, excludedByUnit } = groupGlucoseByMethod(events, 'mg/dL');

    assert.equal(excludedByUnit, 1);
    assert.deepEqual(Object.keys(seriesByMethod).sort(), ['capillary', 'interstitial']);

    /** The capillary series only brings the two events in mg/dL, sorted by date. */
    assert.equal(seriesByMethod.capillary.length, 2);
    assert.equal(seriesByMethod.capillary[0].y, 95);
    assert.equal(seriesByMethod.capillary[1].y, 100);
    assert.ok(seriesByMethod.capillary[0].x < seriesByMethod.capillary[1].x);

    assert.equal(seriesByMethod.interstitial.length, 1);
    assert.equal(seriesByMethod.interstitial[0].y, 110);
});

test('groupGlucoseByMethod: with no events in the display unit, there are no series', () => {
    const events = [
        glucoseEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', value: '6.1', unit: 'mmol/L', method: 'capillary' }),
    ];

    const { seriesByMethod, excludedByUnit } = groupGlucoseByMethod(events, 'mg/dL');

    assert.deepEqual(seriesByMethod, {});
    assert.equal(excludedByUnit, 1);
});

/**
 * @param {{occurredAt: string, value: string, unit: string, method: string}} params
 * @returns {{id: string, occurredAt: string, content: object}}
 */
function glucoseEvent({ occurredAt, value, unit, method }) {
    return {
        id: occurredAt,
        occurredAt,
        content: {
            v: 1,
            type: 'glucose',
            tz: '+00:00',
            data: { value, unit, loinc: '41653-7', method, mealContext: 'fasting' },
        },
    };
}

test('chartCaptionText: with no record at all it says the same as the list, not "in this unit"', () => {
    const caption = chartCaptionText({
        methodLabels: [],
        presentationUnit: 'mg/dL',
        excludedByUnit: 0,
        hasEvents: false,
    });

    assert.equal(caption, 'Todavía no hay registros de glucemia.');
});

test('chartCaptionText: it names the included methods (ADR 0008, nothing is mixed in silence)', () => {
    const caption = chartCaptionText({
        methodLabels: ['Capilar (punción digital)', 'Intersticial (sensor continuo)'],
        presentationUnit: 'mg/dL',
        excludedByUnit: 0,
        hasEvents: true,
    });

    assert.equal(caption, 'Incluye: Capilar (punción digital), Intersticial (sensor continuo).');
});

test('chartCaptionText: it counts the records left out for being in another unit', () => {
    const caption = chartCaptionText({
        methodLabels: ['Capilar (punción digital)'],
        presentationUnit: 'mg/dL',
        excludedByUnit: 2,
        hasEvents: true,
    });

    assert.match(caption, /^Incluye: Capilar \(punción digital\)\./);
    assert.match(caption, /2 registros en otra unidad distinta de mg\/dL no se muestran/);
});

test('chartCaptionText: there are records but none in the shown unit, the empty chart explains itself', () => {
    const caption = chartCaptionText({
        methodLabels: [],
        presentationUnit: 'mmol/L',
        excludedByUnit: 3,
        hasEvents: true,
    });

    assert.match(caption, /Ningún registro está en mmol\/L/);
    assert.match(caption, /3 registros en otra unidad distinta de mmol\/L/);
});

test('groupGlucoseByMethod: the axis instant keeps the real distance between readings', () => {
    /**
     * The exact case that motivated the linear axis: 00:00, 12:00 and 12:30. On a category axis the
     * three came out at even thirds; here the first gap has to be twenty-four times the second.
     */
    const events = [
        glucoseEvent({ occurredAt: '2026-07-25T00:00:00.000000Z', value: '90', unit: 'mg/dL', method: 'capillary' }),
        glucoseEvent({ occurredAt: '2026-07-25T12:00:00.000000Z', value: '140', unit: 'mg/dL', method: 'capillary' }),
        glucoseEvent({ occurredAt: '2026-07-25T12:30:00.000000Z', value: '155', unit: 'mg/dL', method: 'capillary' }),
    ];

    const [first, second, third] = groupGlucoseByMethod(events, 'mg/dL').seriesByMethod.capillary;

    assert.equal(second.x - first.x, 12 * 3_600_000);
    assert.equal(third.x - second.x, 30 * 60_000);
    assert.equal((second.x - first.x) / (third.x - second.x), 24);
});

test('groupGlucoseByMethod: the instant is the wall clock of the event, not the browser one', () => {
    const event = {
        id: '1',
        /** 21:00 in Madrid, which is 19:00 UTC: on the axis it has to sit at 21:00. */
        occurredAt: '2026-07-25T19:00:00.000000Z',
        content: {
            v: 1,
            type: 'glucose',
            tz: '+02:00',
            data: { value: '120', unit: 'mg/dL', loinc: '41653-7', method: 'capillary', mealContext: 'fasting' },
        },
    };

    const [point] = groupGlucoseByMethod([event], 'mg/dL').seriesByMethod.capillary;

    assert.equal(new Date(point.x).getUTCHours(), 21);
});
