/**
 * Comprobaciones de `health/statistics.js` (ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * Lógica pura, sin DOM ni Chart.js: se llama directamente a las funciones exportadas.
 * Corredor incorporado de Node, como el resto de `tests/js` (ver `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    filterByWindow,
    isWithinWindow,
    summarizeBloodPressurePeriod,
    summarizeGlucosePeriod,
    windowEvents,
    WINDOW_DAYS,
} from '../../resources/js/health/statistics.js';

const REFERENCE = '2026-07-25T12:00:00.000000Z';
const REFERENCE_MS = Date.parse(REFERENCE);

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

// --- Ventanas de tiempo -----------------------------------------------------------------------

test('isWithinWindow: límites inclusivos por ambos extremos', () => {
    const weekMs = WINDOW_DAYS.week * 24 * 60 * 60 * 1000;

    // Exactamente en el instante de referencia: dentro.
    assert.equal(isWithinWindow(REFERENCE, REFERENCE_MS, WINDOW_DAYS.week), true);

    // Exactamente 7 días antes: dentro (límite inferior inclusivo).
    const lowerBoundIso = new Date(REFERENCE_MS - weekMs).toISOString();
    assert.equal(isWithinWindow(lowerBoundIso, REFERENCE_MS, WINDOW_DAYS.week), true);

    // Un milisegundo antes del límite inferior: fuera.
    const justBeforeIso = new Date(REFERENCE_MS - weekMs - 1).toISOString();
    assert.equal(isWithinWindow(justBeforeIso, REFERENCE_MS, WINDOW_DAYS.week), false);

    // Un milisegundo después del instante de referencia: fuera (no cuenta el "futuro").
    const justAfterIso = new Date(REFERENCE_MS + 1).toISOString();
    assert.equal(isWithinWindow(justAfterIso, REFERENCE_MS, WINDOW_DAYS.week), false);
});

test('filterByWindow / windowEvents: separa semana y mes con los mismos límites', () => {
    const events = [
        { occurredAt: '2026-07-25T11:00:00.000000Z' }, // hoy: en semana y mes
        { occurredAt: '2026-07-20T12:00:00.000000Z' }, // hace 5 días: en semana y mes
        { occurredAt: '2026-07-10T12:00:00.000000Z' }, // hace 15 días: solo en mes
        { occurredAt: '2026-05-01T12:00:00.000000Z' }, // hace más de un mes: en ninguna
    ];

    const { week, month } = windowEvents(events, REFERENCE);

    assert.equal(week.length, 2);
    assert.equal(month.length, 3);
    assert.deepEqual(filterByWindow(events, REFERENCE, WINDOW_DAYS.week), week);
});

// --- Glucemia ----------------------------------------------------------------------------------

test('summarizeGlucosePeriod: lista vacía da un resumen vacío bien formado', () => {
    const summary = summarizeGlucosePeriod([], { unit: 'mg/dL' });

    assert.deepEqual(summary, { byMethod: {}, excludedByUnit: 0, discarded: 0 });
});

test('summarizeGlucosePeriod: media y mediana con número impar de muestras', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '100' }),
        glucoseEvent({ occurredAt: 't2', value: '110' }),
        glucoseEvent({ occurredAt: 't3', value: '90' }),
    ];

    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.equal(byMethod.capillary.count, 3);
    assert.equal(byMethod.capillary.mean, 100);
    assert.equal(byMethod.capillary.median, 100); // muestra central de [90, 100, 110]
    assert.equal(byMethod.capillary.min, 90);
    assert.equal(byMethod.capillary.max, 110);
});

test('summarizeGlucosePeriod: mediana con número par de muestras es el promedio de las dos centrales', () => {
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

test('summarizeGlucosePeriod: separa de verdad por método de medición (ADR 0008)', () => {
    const events = [
        glucoseEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', value: '100', method: 'capillary' }),
        glucoseEvent({ occurredAt: '2026-07-25T09:30:00.000000Z', value: '120', method: 'interstitial' }),
        glucoseEvent({ occurredAt: '2026-07-25T10:00:00.000000Z', value: '104', method: 'capillary' }),
    ];

    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.deepEqual(Object.keys(byMethod).sort(), ['capillary', 'interstitial']);
    assert.equal(byMethod.capillary.count, 2);
    assert.equal(byMethod.interstitial.count, 1);

    // La última lectura de cada método es la de ese método, no la global.
    assert.equal(byMethod.capillary.last.value, 104);
    assert.equal(byMethod.capillary.last.occurredAt, '2026-07-25T10:00:00.000000Z');
    assert.equal(byMethod.interstitial.last.value, 120);
});

test('summarizeGlucosePeriod: excluye los eventos en otra unidad y los cuenta, sin mezclarlos', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '100', unit: 'mg/dL' }),
        glucoseEvent({ occurredAt: 't2', value: '5.5', unit: 'mmol/L' }),
        glucoseEvent({ occurredAt: 't3', value: '110', unit: 'mg/dL' }),
    ];

    const { byMethod, excludedByUnit } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.equal(excludedByUnit, 1);
    assert.equal(byMethod.capillary.count, 2);
});

test('summarizeGlucosePeriod: sin rango objetivo configurado, no hay inRangePercent en ningún grupo', () => {
    const events = [glucoseEvent({ occurredAt: 't1', value: '100' })];

    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.equal('inRangePercent' in byMethod.capillary, false);
});

test('summarizeGlucosePeriod: con rango objetivo, calcula el porcentaje en rango correctamente', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '70' }), // fuera (bajo)
        glucoseEvent({ occurredAt: 't2', value: '100' }), // dentro
        glucoseEvent({ occurredAt: 't3', value: '110' }), // dentro
        glucoseEvent({ occurredAt: 't4', value: '200' }), // fuera (alto)
    ];

    const { byMethod } = summarizeGlucosePeriod(events, {
        unit: 'mg/dL',
        targetRange: { low: '80', high: '130' },
    });

    assert.equal(byMethod.capillary.inRangePercent, 50);
});

test('summarizeGlucosePeriod: descarta los resultados cualitativos (ADR 0008) sin tumbar el resumen', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '100' }),
        glucoseEvent({ occurredAt: 't2', result: 'positive', method: 'urine' }),
    ];

    const { byMethod, discarded } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.equal(discarded, 1);
    assert.equal('urine' in byMethod, false);
    assert.equal(byMethod.capillary.count, 1);
});

test('summarizeGlucosePeriod: un valor no numérico se descarta y se cuenta, sin tumbar el resumen', () => {
    const events = [
        glucoseEvent({ occurredAt: 't1', value: '100' }),
        glucoseEvent({ occurredAt: 't2', value: 'no-es-un-número' }),
        glucoseEvent({ occurredAt: 't3', value: '' }),
    ];

    const { byMethod, discarded } = summarizeGlucosePeriod(events, { unit: 'mg/dL' });

    assert.equal(discarded, 2);
    assert.equal(byMethod.capillary.count, 1);
});

// --- Tensión arterial ----------------------------------------------------------------------------

test('summarizeBloodPressurePeriod: lista vacía da un resumen vacío bien formado', () => {
    const summary = summarizeBloodPressurePeriod([]);

    assert.deepEqual(summary, { byMethod: {}, discarded: 0 });
});

test('summarizeBloodPressurePeriod: media, mediana, rango y última lectura por magnitud', () => {
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

test('summarizeBloodPressurePeriod: un evento es una sola unidad con las tres magnitudes (ADR 0006)', () => {
    // Tres eventos de una sola magnitud cada uno no deben tratarse como si fuesen un evento de
    // tensión: no traen las otras dos magnitudes, así que se descartan enteros.
    const events = [
        { v: 1, type: 'bloodPressure', tz: '+00:00', occurredAt: 't1', data: { systolic: '120', method: 'left_sitting' } },
    ];

    const { byMethod, discarded } = summarizeBloodPressurePeriod(events);

    assert.equal(discarded, 1);
    assert.deepEqual(byMethod, {});
});

test('summarizeBloodPressurePeriod: separa por método (brazo y postura, ADR 0008)', () => {
    const events = [
        bpEvent({ occurredAt: 't1', systolic: '120', diastolic: '80', pulse: '70', method: 'left_sitting' }),
        bpEvent({ occurredAt: 't2', systolic: '110', diastolic: '70', pulse: '65', method: 'right_standing' }),
    ];

    const { byMethod } = summarizeBloodPressurePeriod(events);

    assert.deepEqual(Object.keys(byMethod).sort(), ['left_sitting', 'right_standing']);
    assert.equal(byMethod.left_sitting.count, 1);
    assert.equal(byMethod.right_standing.count, 1);
});
