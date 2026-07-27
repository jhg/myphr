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
    dominantUnit,
    majorityUnit,
    summarizeBloodPressurePeriod,
    summarizeGlucosePeriod,
    summarizeMeasurementPeriod,
    unitCount,
} from '../../resources/js/health/statistics.js';

/**
 * Estas funciones ya no acotan por ventana: el periodo lo aplica el servidor al pedir los eventos
 * (`[from, to)` de `HealthEventPage::fetchEvents()`), así que aquí llegan los del periodo ya
 * elegido. Lo que se prueba es el cálculo, no el recorte.
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

// --- Magnitudes simples: peso, temperatura e insulina --------------------------------------------

/**
 * @param {string} type
 * @param {object} data
 * @param {string} occurredAt
 * @returns {object}
 */
function measurementEvent(type, occurredAt, data) {
    return { v: 1, type, tz: '+00:00', occurredAt, data };
}

test('summarizeMeasurementPeriod: sin campo de agrupación, todo cae en un único grupo sin nombre', () => {
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

/** El sitio de medición cambia lo que significa el número: una axilar y una rectal no se promedian. */
test('summarizeMeasurementPeriod: la temperatura se separa por sitio de medición', () => {
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

test('summarizeMeasurementPeriod: la insulina resume la dosis, agrupada por tipo de insulina', () => {
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

/** ADR 0007: kilos y libras no se promedian juntos, igual que mg/dL y mmol/L. */
test('summarizeMeasurementPeriod: lo que está en otra unidad se cuenta aparte, no se mezcla', () => {
    const events = [
        measurementEvent('bodyWeight', 't1', { value: '72', unit: 'kg' }),
        measurementEvent('bodyWeight', 't2', { value: '160', unit: '[lb_av]' }),
    ];

    const { byGroup, excludedByUnit } = summarizeMeasurementPeriod(events, { type: 'bodyWeight', unit: 'kg' });

    assert.equal(excludedByUnit, 1);
    assert.equal(byGroup[''].count, 1);
});

test('summarizeMeasurementPeriod: un valor no numérico se descarta y se cuenta', () => {
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
 * Peso, temperatura e insulina no tienen unidad de presentación configurable (la glucemia sí,
 * ADR 0007), así que se resume con la del registro más reciente: quien acaba de cambiar de báscula ve
 * el resumen en la unidad que está usando ahora, no en la que usaba hace meses.
 */
test('dominantUnit: la unidad es la del registro más reciente con valor numérico', () => {
    const events = [
        measurementEvent('bodyWeight', '2026-07-01T08:00:00.000000Z', { value: '160', unit: '[lb_av]' }),
        measurementEvent('bodyWeight', '2026-07-20T08:00:00.000000Z', { value: '72', unit: 'kg' }),
    ];

    assert.equal(dominantUnit(events, 'bodyWeight'), 'kg');
});

test('dominantUnit: sin ningún registro utilizable no inventa unidad', () => {
    assert.equal(dominantUnit([], 'bodyWeight'), null);
    assert.equal(
        dominantUnit([measurementEvent('bodyWeight', 't1', { value: '', unit: 'kg' })], 'bodyWeight'),
        null,
    );
});

test('dominantUnit: mira el campo de valor que se le diga (la insulina guarda la dosis)', () => {
    const events = [measurementEvent('insulin', 't1', { dose: '6', unit: '[iU]', insulinType: 'rapid' })];

    assert.equal(dominantUnit(events, 'insulin', 'dose'), '[iU]');
    assert.equal(dominantUnit(events, 'insulin'), null);
});

// --- majorityUnit y unitCount --------------------------------------------------------------------

/**
 * `dominantUnit` elige por recencia y tiene razón en el panel del paciente, que sabe que acaba de
 * cambiar de báscula. En un recorte que lee otra persona no vale: dos lecturas nuevas en otra unidad
 * mandarían doscientas a una nota al pie y dejarían la tarjeta resumiendo dos registros con aspecto
 * de resumir el recorte entero.
 */
test('majorityUnit: gana la unidad de la mayoría, no la de la lectura más reciente', () => {
    const events = [
        { type: 'glucose', occurredAt: '2026-07-01T08:00:00.000000Z', data: { value: '110', unit: 'mg/dL' } },
        { type: 'glucose', occurredAt: '2026-07-02T08:00:00.000000Z', data: { value: '120', unit: 'mg/dL' } },
        { type: 'glucose', occurredAt: '2026-07-03T08:00:00.000000Z', data: { value: '7.4', unit: 'mmol/L' } },
    ];

    assert.equal(majorityUnit(events, 'glucose'), 'mg/dL');
    assert.equal(dominantUnit(events, 'glucose'), 'mmol/L');
});

test('majorityUnit: en empate manda la más reciente, para no depender del orden del array', () => {
    const events = [
        { type: 'glucose', occurredAt: '2026-07-01T08:00:00.000000Z', data: { value: '110', unit: 'mg/dL' } },
        { type: 'glucose', occurredAt: '2026-07-03T08:00:00.000000Z', data: { value: '7.4', unit: 'mmol/L' } },
    ];

    assert.equal(majorityUnit(events, 'glucose'), 'mmol/L');
    assert.equal(majorityUnit([], 'glucose'), null);
});

test('unitCount: cuenta unidades distintas, que es lo que decide si hay algo que advertir', () => {
    const events = [
        { type: 'glucose', occurredAt: '2026-07-01T08:00:00.000000Z', data: { value: '110', unit: 'mg/dL' } },
        { type: 'glucose', occurredAt: '2026-07-03T08:00:00.000000Z', data: { value: '7.4', unit: 'mmol/L' } },
        { type: 'insulin', occurredAt: '2026-07-03T09:00:00.000000Z', data: { dose: '8', unit: '[iU]' } },
    ];

    assert.equal(unitCount(events, 'glucose'), 2);
    assert.equal(unitCount(events, 'insulin', 'dose'), 1);
    assert.equal(unitCount(events, 'bodyWeight'), 0);
});
