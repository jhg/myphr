/**
 * Checks of the pure logic of `health/temperaturePage.js` (ADR 0004, ADR 0005, ADR 0006,
 * ADR 0008).
 *
 * Neither Alpine nor Chart.js is mounted: `temperaturePage()` only orchestrates DOM and external
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

import { parseNumericValue } from '../../resources/js/health/numericValue.js';
import {
    buildTemperatureContent,
    chartCaptionText,
    filterTemperatureEvents,
    groupTemperatureBySiteAndUnit,
    resolveLoincCode,
    seriesKey,
    seriesLabel,
    siteLabel,
    splitSeriesKey,
} from '../../resources/js/health/temperaturePage.js';
import { datetimeLocalToCanonical, formatTzOffset } from '../../resources/js/health/datetimeLocal.js';
import { unitLabel } from '../../resources/js/health/unitLabel.js';

/** Test common fields, with the shape `buildCommonEventFields` returns (ADR 0006). */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

/** Test catalog, with the shape `Temperature::catalog()` returns (ADR 0005, ADR 0008). */
const CATALOG = Object.freeze({
    units: [
        { code: 'Cel', label: '°C' },
        { code: '[degF]', label: '°F' },
    ],
    sites: [
        { token: 'axillary', label: 'Axilar' },
        { token: 'oral', label: 'Oral' },
        { token: 'tympanic', label: 'Timpánica (oído)' },
    ],
    loinc: [
        { site: 'axillary', code: '8328-7' },
        { site: 'oral', code: '8331-1' },
        { site: 'tympanic', code: '8333-7' },
    ],
});

test('buildTemperatureContent: exact ADR 0006 shape, with the measurement site', () => {
    const content = buildTemperatureContent({
        value: '36.8',
        unit: 'Cel',
        site: 'axillary',
        tz: '+02:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.deepEqual(content, {
        v: 1,
        type: 'temperature',
        tz: '+02:00',
        origin: 'manual',
        recordedBy: 'self',
        data: {
            value: '36.8',
            unit: 'Cel',
            loinc: '8328-7',
            site: 'axillary',
        },
    });
});

test('buildTemperatureContent: the LOINC code is decided by the site, not by the unit', () => {
    const oral = buildTemperatureContent({
        value: '98.2',
        unit: '[degF]',
        site: 'oral',
        tz: '+00:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.equal(oral.data.loinc, '8331-1');
    assert.equal(oral.data.unit, '[degF]');
});

test('buildTemperatureContent: the value travels as a string, never as a number (ADR 0004)', () => {
    const content = buildTemperatureContent({
        value: parseNumericValue('36,85', 'La temperatura'),
        unit: 'Cel',
        site: 'oral',
        tz: '+00:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.value, '36.85');
    assert.equal(typeof content.data.value, 'string');
});

test('buildTemperatureContent: it fails with no value, no unit and no site', () => {
    const base = { value: '36.8', unit: 'Cel', site: 'oral', tz: '+00:00', catalog: CATALOG, common: COMMON_FIELDS };

    assert.throws(() => buildTemperatureContent({ ...base, value: '  ' }));
    assert.throws(() => buildTemperatureContent({ ...base, unit: '' }));
    assert.throws(() => buildTemperatureContent({ ...base, site: '' }));
});

test('resolveLoincCode: it fails for a site with no code instead of falling back to the generic 8310-5', () => {
    assert.equal(resolveLoincCode(CATALOG.loinc, 'tympanic'), '8333-7');
    assert.throws(() => resolveLoincCode(CATALOG.loinc, 'rectal'));
});

test('unitLabel and siteLabel: they show the label and not the interchange code', () => {
    assert.equal(unitLabel(CATALOG, '[degF]'), '°F');
    assert.equal(siteLabel(CATALOG, 'axillary'), 'Axilar');
    /** An unknown token is shown as is: ugly, but it does not hide the record. */
    assert.equal(siteLabel(CATALOG, 'groin'), 'groin');
});

test('seriesKey and splitSeriesKey: round trip with UCUM codes carrying brackets', () => {
    const key = seriesKey('oral', '[degF]');

    assert.deepEqual(splitSeriesKey(key), ['oral', '[degF]']);
    assert.deepEqual(splitSeriesKey('sin-separador'), ['sin-separador', '']);
});

test('seriesLabel: the label names site and unit, because two scales are not comparable', () => {
    const label = seriesLabel(CATALOG, seriesKey('oral', '[degF]'));

    assert.match(label, /Oral/);
    assert.match(label, /°F/);
});

test('filterTemperatureEvents: discards whatever is not temperature (the server cannot, ADR 0006)', () => {
    const events = [
        { id: '1', occurredAt: '2026-03-01T08:00:00.000000Z', content: { type: 'temperature', data: {} } },
        { id: '2', occurredAt: '2026-03-01T09:00:00.000000Z', content: { type: 'bodyWeight', data: {} } },
        { id: '3', occurredAt: '2026-03-01T10:00:00.000000Z', content: null },
    ];

    assert.deepEqual(filterTemperatureEvents(events).map((event) => event.id), ['1']);
});

test('groupTemperatureBySiteAndUnit: one series per site AND per unit, sorted by date', () => {
    const events = [
        {
            id: '1',
            occurredAt: '2026-03-02T08:00:00.000000Z',
            content: { type: 'temperature', data: { value: '36.8', unit: 'Cel', site: 'axillary' } },
        },
        {
            id: '2',
            occurredAt: '2026-03-01T08:00:00.000000Z',
            content: { type: 'temperature', data: { value: '37.4', unit: 'Cel', site: 'axillary' } },
        },
        {
            id: '3',
            occurredAt: '2026-03-01T09:00:00.000000Z',
            content: { type: 'temperature', data: { value: '37.0', unit: 'Cel', site: 'oral' } },
        },
        {
            id: '4',
            occurredAt: '2026-03-01T10:00:00.000000Z',
            content: { type: 'temperature', data: { value: '98.6', unit: '[degF]', site: 'oral' } },
        },
    ];

    const seriesByKey = groupTemperatureBySiteAndUnit(events);

    assert.deepEqual(Object.keys(seriesByKey).sort(), ['axillary|Cel', 'oral|Cel', 'oral|[degF]']);

    /** ADR 0008: the axillary is not mixed with the oral, not even sharing a unit. */
    assert.deepEqual(seriesByKey['axillary|Cel'].map((point) => point.y), [37.4, 36.8]);

    /** And degrees Fahrenheit do not enter the Celsius series of the same site. */
    assert.deepEqual(seriesByKey['oral|Cel'].map((point) => point.y), [37]);
    assert.deepEqual(seriesByKey['oral|[degF]'].map((point) => point.y), [98.6]);
});

test('chartCaptionText: it says which series it includes, and it says so when there is none too', () => {
    assert.match(chartCaptionText(['Oral · °C']), /Oral/);
    assert.notEqual(chartCaptionText([]), '');
    assert.notEqual(chartCaptionText([]), chartCaptionText(['Oral · °C']));
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

test('groupTemperatureBySiteAndUnit: the axis instant keeps the cadence of the readings', () => {
    /**
     * A bad night measured every four hours, and two loose readings the following week. With even
     * columns the fever looked as if it had lasted as long as the convalescence.
     */
    const events = [
        '2026-03-01T00:00:00.000000Z',
        '2026-03-01T04:00:00.000000Z',
        '2026-03-01T08:00:00.000000Z',
        '2026-03-08T08:00:00.000000Z',
    ].map((occurredAt) => ({
        id: occurredAt,
        occurredAt,
        content: { type: 'temperature', tz: '+00:00', data: { value: '38.5', unit: 'Cel', site: 'oral' } },
    }));

    const seriesByKey = groupTemperatureBySiteAndUnit(events);
    const points = seriesByKey[Object.keys(seriesByKey)[0]];
    const gaps = points.slice(1).map((point, index) => point.x - points[index].x);

    assert.deepEqual(gaps.slice(0, 2), [4 * 3_600_000, 4 * 3_600_000]);
    /** The seven-day gap is forty-two times the four-hour one, and so it is drawn. */
    assert.equal(gaps[2] / gaps[0], 42);
});

test('groupTemperatureBySiteAndUnit: the instant is the wall clock of the event, not the browser one', () => {
    const events = [{
        id: '1',
        /** 03:00 in Madrid, which is 01:00 UTC: a night-time fever has to stay at night. */
        occurredAt: '2026-03-01T01:00:00.000000Z',
        content: { type: 'temperature', tz: '+02:00', data: { value: '38.5', unit: 'Cel', site: 'oral' } },
    }];

    const seriesByKey = groupTemperatureBySiteAndUnit(events);
    const [key] = Object.keys(seriesByKey);

    assert.equal(new Date(seriesByKey[key][0].x).getUTCHours(), 3);
});
