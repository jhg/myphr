/**
 * Comprobaciones de la lógica pura de `health/bodyWeightPage.js` (ADR 0004, ADR 0005, ADR 0006).
 *
 * No se monta Alpine ni Chart.js: `bodyWeightPage()` solo orquesta DOM y librerías externas, y esa
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

/** Campos comunes de prueba, con la forma que devuelve `buildCommonEventFields` (ADR 0006). */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

/** Catálogo de prueba, con la forma que devuelve `BodyWeight::catalog()` (ADR 0005). */
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

test('buildBodyWeightContent: forma exacta del ADR 0006', () => {
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

test('buildBodyWeightContent: el valor viaja como cadena, nunca como número (ADR 0004)', () => {
    const content = buildBodyWeightContent({
        value: parseNumericValue('72,45', 'El peso'),
        unit: 'kg',
        tz: '+00:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    /** La coma se normaliza a punto, pero el tipo sigue siendo cadena. */
    assert.equal(content.data.value, '72.45');
    assert.equal(typeof content.data.value, 'string');
});

test('buildBodyWeightContent: el código LOINC no depende de la unidad', () => {
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

test('buildBodyWeightContent: falla sin valor y sin unidad', () => {
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

test('unitLabel: enseña la etiqueta y no el código UCUM con corchetes', () => {
    assert.equal(unitLabel(CATALOG, '[lb_av]'), 'lb');
    assert.equal(unitLabel(CATALOG, 'kg'), 'kg');
    /** Un código desconocido se enseña tal cual: feo, pero no esconde el registro. */
    assert.equal(unitLabel(CATALOG, 'st'), 'st');
});

test('filterBodyWeightEvents: descarta lo que no es peso (el servidor no puede, ADR 0006)', () => {
    const events = [
        { id: '1', occurredAt: '2026-03-01T08:00:00.000000Z', content: { type: 'bodyWeight', data: {} } },
        { id: '2', occurredAt: '2026-03-01T09:00:00.000000Z', content: { type: 'glucose', data: {} } },
        { id: '3', occurredAt: '2026-03-01T10:00:00.000000Z', content: null },
    ];

    assert.deepEqual(filterBodyWeightEvents(events).map((event) => event.id), ['1']);
});

test('groupBodyWeightByUnit: una serie por unidad, ordenada por fecha y sin convertir', () => {
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

    /** Ninguna libra se cuela en la serie de kilogramos: no hay conversión en ninguna dirección. */
    assert.equal(seriesByUnit.kg.length, 2);
});

test('chartCaptionText: dice qué unidades incluye, y lo dice también cuando no hay ninguna', () => {
    assert.match(chartCaptionText(['kg', 'lb']), /kg/);
    assert.notEqual(chartCaptionText([]), '');
    assert.notEqual(chartCaptionText([]), chartCaptionText(['kg']));
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

/*
|--------------------------------------------------------------------------
| Estatura opcional dentro del mismo registro
|--------------------------------------------------------------------------
*/

test('buildBodyWeightContent: la estatura entra en el mismo registro, con su unidad y su LOINC', () => {
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

test('buildBodyWeightContent: la estatura en blanco no rompe el registro y no deja ninguna clave', () => {
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

        /** Ni `null` ni cadena vacía: la clave sencillamente no está (ADR 0006). */
        assert.equal('height' in content.data, false, String(height));
        assert.equal(content.data.value, '72.4');
    }
});

test('buildBodyWeightContent: una estatura escrita sin unidad sí es un error', () => {
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

test('buildBodyWeightContent: la estatura viaja como cadena, igual que el peso (ADR 0004)', () => {
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

test('heightUnitLabel: enseña «in» y guarda «[in_i]»', () => {
    assert.equal(heightUnitLabel(CATALOG, '[in_i]'), 'in');
    assert.equal(heightUnitLabel(CATALOG, 'cm'), 'cm');
    assert.equal(heightUnitLabel(CATALOG, 'league'), 'league');
});
