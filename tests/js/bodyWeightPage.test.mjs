/**
 * Checks of the pure logic of `health/bodyWeightPage.js` (ADR 0004, ADR 0005, ADR 0006).
 *
 * Neither Alpine nor Chart.js is mounted: `bodyWeightPage()` only orchestrates DOM and external
 * libraries, and that orchestration is not tested here. What is tested is the logic that depends
 * on neither of the two, exported apart so it can be called directly. Same approach as
 * `tests/js/bloodPressurePage.test.mjs`.
 *
 * Node's built-in runner, like the rest of `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildBodyWeightContent,
    heightUnitLabel,
    chartCaptionText,
    filterBodyWeightEvents,
    groupBodyWeightByUnit,
} from '../../resources/js/health/bodyWeightPage.js';
import { datetimeLocalToCanonical, formatTzOffset } from '../../resources/js/health/datetimeLocal.js';
import { unitLabel } from '../../resources/js/health/unitLabel.js';
import { parseNumericValue } from '../../resources/js/health/numericValue.js';

/** Test common fields, with the shape `buildCommonEventFields` returns (ADR 0006). */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

/** Test catalog, with the shape `BodyWeight::catalog()` returns (ADR 0005). */
const CATALOG = Object.freeze({
    units: [
        { code: 'kg', label: 'kg' },
        { code: '[lb_av]', label: 'lb' },
    ],
    loinc: '3141-9',
    heightUnits: [
        { code: 'cm', label: 'cm' },
        { code: '[in_i]', label: 'in' },
    ],
    heightLoinc: '8302-2',
});

test('buildBodyWeightContent: exact ADR 0006 shape', () => {
    const content = buildBodyWeightContent({
        value: '72.4',
        unit: 'kg',
        tz: '+02:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.deepEqual(content, {
        v: 1,
        type: 'bodyWeight',
        tz: '+02:00',
        origin: 'manual',
        recordedBy: 'self',
        data: {
            value: '72.4',
            unit: 'kg',
            loinc: '3141-9',
        },
    });
});

test('buildBodyWeightContent: the value travels as a string, never as a number (ADR 0004)', () => {
    const content = buildBodyWeightContent({
        value: parseNumericValue('72,45', 'El peso'),
        unit: 'kg',
        tz: '+00:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    /** The comma is normalized to a dot, but the type is still a string. */
    assert.equal(content.data.value, '72.45');
    assert.equal(typeof content.data.value, 'string');
});

test('buildBodyWeightContent: the LOINC code does not depend on the unit', () => {
    const inPounds = buildBodyWeightContent({
        value: '160',
        unit: '[lb_av]',
        tz: '+00:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.equal(inPounds.data.loinc, '3141-9');
    assert.equal(inPounds.data.unit, '[lb_av]');
});

test('buildBodyWeightContent: it fails with no value and no unit', () => {
    assert.throws(() => buildBodyWeightContent({
        value: '   ',
        unit: 'kg',
        tz: '+00:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    }));

    assert.throws(() => buildBodyWeightContent({
        value: '70',
        unit: '',
        tz: '+00:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    }));
});

test('unitLabel: it shows the label and not the UCUM code with brackets', () => {
    assert.equal(unitLabel(CATALOG, '[lb_av]'), 'lb');
    assert.equal(unitLabel(CATALOG, 'kg'), 'kg');
    /** An unknown code is shown as is: ugly, but it does not hide the record. */
    assert.equal(unitLabel(CATALOG, 'st'), 'st');
});

test('filterBodyWeightEvents: discards whatever is not weight (the server cannot, ADR 0006)', () => {
    const events = [
        { id: '1', occurredAt: '2026-03-01T08:00:00.000000Z', content: { type: 'bodyWeight', data: {} } },
        { id: '2', occurredAt: '2026-03-01T09:00:00.000000Z', content: { type: 'glucose', data: {} } },
        { id: '3', occurredAt: '2026-03-01T10:00:00.000000Z', content: null },
    ];

    assert.deepEqual(filterBodyWeightEvents(events).map((event) => event.id), ['1']);
});

test('groupBodyWeightByUnit: one series per unit, sorted by date and without converting', () => {
    const events = [
        {
            id: '1',
            occurredAt: '2026-03-02T08:00:00.000000Z',
            content: { type: 'bodyWeight', data: { value: '72.4', unit: 'kg' } },
        },
        {
            id: '2',
            occurredAt: '2026-03-01T08:00:00.000000Z',
            content: { type: 'bodyWeight', data: { value: '73.1', unit: 'kg' } },
        },
        {
            id: '3',
            occurredAt: '2026-03-03T08:00:00.000000Z',
            content: { type: 'bodyWeight', data: { value: '160', unit: '[lb_av]' } },
        },
    ];

    const seriesByUnit = groupBodyWeightByUnit(events);

    assert.deepEqual(Object.keys(seriesByUnit).sort(), ['[lb_av]', 'kg']);
    assert.deepEqual(seriesByUnit.kg.map((point) => point.y), [73.1, 72.4]);
    assert.deepEqual(seriesByUnit['[lb_av]'].map((point) => point.y), [160]);

    /** No pound slips into the kilogram series: there is no conversion in either direction. */
    assert.equal(seriesByUnit.kg.length, 2);
});

test('chartCaptionText: it says which units it includes, and it says so when there is none too', () => {
    assert.match(chartCaptionText(['kg', 'lb']), /kg/);
    assert.notEqual(chartCaptionText([]), '');
    assert.notEqual(chartCaptionText([]), chartCaptionText(['kg']));
});

test('datetimeLocalToCanonical: local time to the ADR 0004 canonical instant', () => {
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-03-01T08:30:00', {
        timezoneOffsetMinutes: -120,
    });

    assert.equal(occurredAt, '2026-03-01T06:30:00.000000Z');
    assert.equal(tz, '+02:00');
});

test('formatTzOffset: sign convention of the `tz` field (ADR 0006)', () => {
    assert.equal(formatTzOffset(120), '+02:00');
    assert.equal(formatTzOffset(-330), '-05:30');
    assert.equal(formatTzOffset(0), '+00:00');
});

/*
|--------------------------------------------------------------------------
| Optional height inside the same record
|--------------------------------------------------------------------------
*/

test('buildBodyWeightContent: the height enters the same record, with its unit and its LOINC', () => {
    const content = buildBodyWeightContent({
        value: '72.4',
        unit: 'kg',
        height: '175',
        heightUnit: 'cm',
        tz: '+02:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.deepEqual(content.data, {
        value: '72.4',
        unit: 'kg',
        loinc: '3141-9',
        height: { value: '175', unit: 'cm', loinc: '8302-2' },
    });
});

test('buildBodyWeightContent: a blank height does not break the record and leaves no key behind', () => {
    for (const height of ['', '   ', undefined]) {
        const content = buildBodyWeightContent({
            value: '72.4',
            unit: 'kg',
            height,
            heightUnit: 'cm',
            tz: '+02:00',
            catalog: CATALOG,
            common: COMMON_FIELDS,
        });

        /** No `null` and no empty string: the key simply is not there (ADR 0006). */
        assert.equal('height' in content.data, false, String(height));
        assert.equal(content.data.value, '72.4');
    }
});

test('buildBodyWeightContent: a height written with no unit is an error', () => {
    assert.throws(() => buildBodyWeightContent({
        value: '72.4',
        unit: 'kg',
        height: '175',
        heightUnit: '',
        tz: '+02:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    }));
});

test('buildBodyWeightContent: the height travels as a string, like the weight (ADR 0004)', () => {
    const content = buildBodyWeightContent({
        value: '72',
        unit: 'kg',
        height: parseNumericValue('175,5', 'La estatura'),
        heightUnit: '[in_i]',
        tz: '+00:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.height.value, '175.5');
    assert.equal(typeof content.data.height.value, 'string');
    assert.equal(content.data.height.unit, '[in_i]');
});

test('heightUnitLabel: it shows "in" and stores "[in_i]"', () => {
    assert.equal(heightUnitLabel(CATALOG, '[in_i]'), 'in');
    assert.equal(heightUnitLabel(CATALOG, 'cm'), 'cm');
    assert.equal(heightUnitLabel(CATALOG, 'league'), 'league');
});

test('groupBodyWeightByUnit: the axis instant keeps the real distance between weighings', () => {
    /**
     * Three weighings in one week and then nothing for two months. On a category axis the four
     * points came out evenly spaced and the slope between the last two —the only thing anybody
     * reads in a weight chart— was invented.
     */
    const events = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-05-03'].map((day) => ({
        id: day,
        occurredAt: `${day}T08:00:00.000000Z`,
        content: { type: 'bodyWeight', tz: '+00:00', data: { value: '72', unit: 'kg' } },
    }));

    const points = groupBodyWeightByUnit(events).kg;
    const gaps = points.slice(1).map((point, index) => point.x - points[index].x);

    assert.deepEqual(gaps.slice(0, 2), [86_400_000, 86_400_000]);
    /** The last gap is sixty-one days, and on the axis it is sixty-one times wider. */
    assert.equal(gaps[2] / gaps[0], 61);
});

test('groupBodyWeightByUnit: the instant is the wall clock of the event, not the browser one', () => {
    const events = [{
        id: '1',
        /** 08:00 in Madrid, which is 06:00 UTC: on the axis it has to sit at 08:00. */
        occurredAt: '2026-03-01T06:00:00.000000Z',
        content: { type: 'bodyWeight', tz: '+02:00', data: { value: '72', unit: 'kg' } },
    }];

    assert.equal(new Date(groupBodyWeightByUnit(events).kg[0].x).getUTCHours(), 8);
});
