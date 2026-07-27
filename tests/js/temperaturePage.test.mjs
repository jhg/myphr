/**
 * Comprobaciones de la lógica pura de `health/temperaturePage.js` (ADR 0004, ADR 0005, ADR 0006,
 * ADR 0008).
 *
 * No se monta Alpine ni Chart.js: `temperaturePage()` solo orquesta DOM y librerías externas, y esa
 * orquestación no se prueba aquí. Lo que se prueba es la lógica que no depende de ninguna de las
 * dos, exportada aparte para poder llamarla directamente. Mismo enfoque que
 * `tests/js/bloodPressurePage.test.mjs`.
 *
 * Corredor incorporado de Node, como el resto de `tests/js`.
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

/** Campos comunes de prueba, con la forma que devuelve `buildCommonEventFields` (ADR 0006). */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

/** Catálogo de prueba, con la forma que devuelve `Temperature::catalog()` (ADR 0005, ADR 0008). */
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

test('buildTemperatureContent: forma exacta del ADR 0006, con el sitio de medida', () => {
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

test('buildTemperatureContent: el código LOINC lo decide el sitio, no la unidad', () => {
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

test('buildTemperatureContent: el valor viaja como cadena, nunca como número (ADR 0004)', () => {
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

test('buildTemperatureContent: falla sin valor, sin unidad y sin sitio', () => {
    const base = { value: '36.8', unit: 'Cel', site: 'oral', tz: '+00:00', catalog: CATALOG, common: COMMON_FIELDS };

    assert.throws(() => buildTemperatureContent({ ...base, value: '  ' }));
    assert.throws(() => buildTemperatureContent({ ...base, unit: '' }));
    assert.throws(() => buildTemperatureContent({ ...base, site: '' }));
});

test('resolveLoincCode: falla ante un sitio sin código en vez de caer al genérico 8310-5', () => {
    assert.equal(resolveLoincCode(CATALOG.loinc, 'tympanic'), '8333-7');
    assert.throws(() => resolveLoincCode(CATALOG.loinc, 'rectal'));
});

test('unitLabel y siteLabel: enseñan la etiqueta y no el código de intercambio', () => {
    assert.equal(unitLabel(CATALOG, '[degF]'), '°F');
    assert.equal(siteLabel(CATALOG, 'axillary'), 'Axilar');
    /** Un token desconocido se enseña tal cual: feo, pero no esconde el registro. */
    assert.equal(siteLabel(CATALOG, 'groin'), 'groin');
});

test('seriesKey y splitSeriesKey: ida y vuelta con códigos UCUM que llevan corchetes', () => {
    const key = seriesKey('oral', '[degF]');

    assert.deepEqual(splitSeriesKey(key), ['oral', '[degF]']);
    assert.deepEqual(splitSeriesKey('sin-separador'), ['sin-separador', '']);
});

test('seriesLabel: el rótulo nombra sitio y unidad, porque dos escalas no son comparables', () => {
    const label = seriesLabel(CATALOG, seriesKey('oral', '[degF]'));

    assert.match(label, /Oral/);
    assert.match(label, /°F/);
});

test('filterTemperatureEvents: descarta lo que no es temperatura (el servidor no puede, ADR 0006)', () => {
    const events = [
        { id: '1', occurredAt: '2026-03-01T08:00:00.000000Z', content: { type: 'temperature', data: {} } },
        { id: '2', occurredAt: '2026-03-01T09:00:00.000000Z', content: { type: 'bodyWeight', data: {} } },
        { id: '3', occurredAt: '2026-03-01T10:00:00.000000Z', content: null },
    ];

    assert.deepEqual(filterTemperatureEvents(events).map((event) => event.id), ['1']);
});

test('groupTemperatureBySiteAndUnit: una serie por sitio Y por unidad, ordenada por fecha', () => {
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

    /** ADR 0008: la axilar no se mezcla con la oral, ni siquiera compartiendo unidad. */
    assert.deepEqual(seriesByKey['axillary|Cel'].map((point) => point.y), [37.4, 36.8]);

    /** Y los grados Fahrenheit no entran en la serie de Celsius del mismo sitio. */
    assert.deepEqual(seriesByKey['oral|Cel'].map((point) => point.y), [37]);
    assert.deepEqual(seriesByKey['oral|[degF]'].map((point) => point.y), [98.6]);
});

test('chartCaptionText: dice qué series incluye, y lo dice también cuando no hay ninguna', () => {
    assert.match(chartCaptionText(['Oral · °C']), /Oral/);
    assert.notEqual(chartCaptionText([]), '');
    assert.notEqual(chartCaptionText([]), chartCaptionText(['Oral · °C']));
});

test('datetimeLocalToCanonical: hora local a instante canónico del ADR 0004', () => {
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-03-01T08:30:00', {
        timezoneOffsetMinutes: -120,
    });

    assert.equal(occurredAt, '2026-03-01T06:30:00.000000Z');
    assert.equal(tz, '+02:00');
});

test('formatTzOffset: convenio de signo del campo `tz` (ADR 0006)', () => {
    assert.equal(formatTzOffset(120), '+02:00');
    assert.equal(formatTzOffset(-330), '-05:30');
    assert.equal(formatTzOffset(0), '+00:00');
});
