/**
 * Comprobaciones de `health/glucoseContext.js`: la curva de glucemia con las marcas de comida e
 * insulina (ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * Lógica pura, sin DOM ni Chart.js. Corredor incorporado de Node, como el resto de `tests/js`:
 *
 *     npm test
 *
 * Lo que se comprueba aquí son las formas de mentir con esta gráfica: unir por encima de un hueco de
 * doce horas una línea que nadie midió, mezclar en una sola serie una capilar con una intersticial,
 * dibujar lecturas de otra unidad como si fueran comparables, colocar una cena de las 23:30 en la
 * madrugada de quien mira, y agrupar o recortar marcas sin decir cuántas.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildGlucoseContext,
    MARKER_CLUSTER_MS,
    MAX_READING_GAP_MS,
} from '../../resources/js/health/glucoseContext.js';

/**
 * @param {object} params
 * @returns {object}
 */
function glucose({ occurredAt, value, unit = 'mg/dL', method = 'capillary', tz = '+00:00' }) {
    return { v: 1, type: 'glucose', tz, occurredAt, data: { value, unit, method, loinc: '41653-7' } };
}

/**
 * @param {object} params
 * @returns {object}
 */
function meal({ occurredAt, mealType = 'lunch', tz = '+00:00' }) {
    return { v: 1, type: 'meal', tz, occurredAt, data: { mealType, foods: [] } };
}

/**
 * @param {object} params
 * @returns {object}
 */
function insulin({ occurredAt, dose = '6', unit = 'U', insulinType = 'rapid', tz = '+00:00' }) {
    return { v: 1, type: 'insulin', tz, occurredAt, data: { dose, unit, insulinType } };
}

// --- Sin datos y con un solo dato ---------------------------------------------------------------

test('sin eventos no hay ni serie ni marcas, y ningún contador miente', () => {
    const context = buildGlucoseContext([], { unit: 'mg/dL' });

    assert.deepEqual(context.series, []);
    assert.deepEqual(context.markers, []);
    assert.equal(context.excludedByUnit, 0);
    assert.equal(context.omittedReadings, 0);
    assert.equal(context.groupedMarkers, 0);
});

test('sin ninguna glucemia no se dibuja nada, aunque haya comidas e insulina', () => {
    const context = buildGlucoseContext([
        meal({ occurredAt: '2026-07-04T12:00:00.000000Z' }),
        insulin({ occurredAt: '2026-07-04T12:05:00.000000Z' }),
    ], { unit: 'mg/dL' });

    /** La gráfica es la relación entre las tres cosas: marcas sobre unos ejes vacíos no dicen nada. */
    assert.deepEqual(context.series, []);
    assert.deepEqual(context.markers, []);
});

test('una sola lectura da una serie con un punto, sin inventarle un recorrido', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '112' }),
    ], { unit: 'mg/dL' });

    assert.equal(context.series.length, 1);
    assert.deepEqual(context.series[0].points.map((point) => point.y), [112]);
});

// --- Una serie por método de medición (ADR 0008) ------------------------------------------------

test('la capilar y la intersticial son dos series, no una media entre las dos', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '100', method: 'capillary' }),
        glucose({ occurredAt: '2026-07-04T08:30:00.000000Z', value: '160', method: 'interstitial' }),
    ], { unit: 'mg/dL' });

    assert.deepEqual(context.series.map((series) => series.group), ['capillary', 'interstitial']);
    assert.deepEqual(context.series.map((series) => series.points.length), [1, 1]);
});

// --- Los huecos son huecos, nunca ceros ---------------------------------------------------------

test('un hueco largo parte la línea en vez de cruzarlo con un segmento inventado', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '100' }),
        glucose({ occurredAt: '2026-07-04T23:00:00.000000Z', value: '180' }),
    ], { unit: 'mg/dL' });

    const values = context.series[0].points.map((point) => point.y);

    /** El corte es un punto sin valor: `null` es hueco, y un cero sería una hipoglucemia falsa. */
    assert.deepEqual(values, [100, null, 180]);
});

test('las lecturas seguidas no se parten: el hueco corta solo cuando de verdad lo hay', () => {
    const start = Date.parse('2026-07-04T08:00:00.000Z');
    const context = buildGlucoseContext([
        glucose({ occurredAt: new Date(start).toISOString(), value: '100' }),
        glucose({ occurredAt: new Date(start + MAX_READING_GAP_MS - 1000).toISOString(), value: '120' }),
    ], { unit: 'mg/dL' });

    assert.deepEqual(context.series[0].points.map((point) => point.y), [100, 120]);
});

// --- No se convierte entre unidades (ADR 0007) --------------------------------------------------

test('lo que está en otra unidad se excluye y se cuenta, jamás se convierte', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '112' }),
        glucose({ occurredAt: '2026-07-04T09:00:00.000000Z', value: '6.2', unit: 'mmol/L' }),
    ], { unit: 'mg/dL' });

    assert.equal(context.excludedByUnit, 1);
    assert.deepEqual(context.series[0].points.map((point) => point.y), [112]);
});

// --- La hora es la de quien registró, no la de quien mira ---------------------------------------

test('el instante de una lectura es su hora de pared, con el desfase del propio evento', () => {
    const context = buildGlucoseContext([
        /** Las 23:30 del día 4 en Madrid, registradas como 21:30 UTC. */
        glucose({ occurredAt: '2026-07-04T21:30:00.000000Z', value: '140', tz: '+02:00' }),
    ], { unit: 'mg/dL' });

    const [point] = context.series[0].points;

    assert.equal(new Date(point.x).toISOString(), '2026-07-04T23:30:00.000Z');
});

test('una marca de comida se sitúa con la zona del evento, no con la del navegador', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T12:00:00.000000Z', value: '110', tz: '-05:00' }),
        meal({ occurredAt: '2026-07-04T18:00:00.000000Z', tz: '-05:00' }),
    ], { unit: 'mg/dL' });

    /** Las 18:00 UTC en Nueva York son la una del mediodía de esa persona. */
    assert.equal(new Date(context.markers[0].x).toISOString(), '2026-07-04T13:00:00.000Z');
});

// --- Marcas: qué llevan y qué se agrupa ---------------------------------------------------------

test('la marca de insulina lleva la dosis, que es el dato que tiene que enseñar', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T12:00:00.000000Z', value: '110' }),
        insulin({ occurredAt: '2026-07-04T12:30:00.000000Z', dose: '6', unit: 'U' }),
    ], { unit: 'mg/dL' });

    const [marker] = context.markers;

    assert.equal(marker.kind, 'insulin');
    assert.match(marker.short, /6/);
    assert.match(marker.items[0], /6/);
});

test('una inyección sin dosis legible se sigue dibujando: el pinchazo ocurrió', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T12:00:00.000000Z', value: '110' }),
        insulin({ occurredAt: '2026-07-04T12:30:00.000000Z', dose: '' }),
    ], { unit: 'mg/dL' });

    assert.equal(context.markers.length, 1);
    assert.equal(context.markers[0].short, '');
});

test('las marcas vecinas se agrupan en una, y se dice cuántas se agruparon', () => {
    const start = Date.parse('2026-07-04T12:00:00.000Z');
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T11:00:00.000000Z', value: '110' }),
        insulin({ occurredAt: new Date(start).toISOString(), dose: '4' }),
        insulin({ occurredAt: new Date(start + MARKER_CLUSTER_MS / 2).toISOString(), dose: '2' }),
    ], { unit: 'mg/dL' });

    assert.equal(context.markers.length, 1);
    assert.equal(context.markers[0].count, 2);
    /** Lo agrupado se declara: una marca escondida es un pinchazo que el ojo da por no ocurrido. */
    assert.equal(context.groupedMarkers, 1);
});

test('una comida y una inyección a la vez no se agrupan entre sí: son cosas distintas', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T11:00:00.000000Z', value: '110' }),
        meal({ occurredAt: '2026-07-04T12:00:00.000000Z' }),
        insulin({ occurredAt: '2026-07-04T12:01:00.000000Z' }),
    ], { unit: 'mg/dL' });

    assert.deepEqual(context.markers.map((marker) => marker.kind), ['meal', 'insulin']);
    assert.equal(context.groupedMarkers, 0);
});

// --- Nada se recorta en silencio ----------------------------------------------------------------

test('el recorte conserva las lecturas más recientes y dice cuántas quedaron fuera', () => {
    const start = Date.parse('2026-07-04T00:00:00.000Z');
    const events = Array.from({ length: 5 }, (unused, index) => glucose({
        occurredAt: new Date(start + index * 60_000).toISOString(),
        value: String(100 + index),
    }));

    const context = buildGlucoseContext(events, { unit: 'mg/dL', maxReadings: 3 });

    assert.deepEqual(context.series[0].points.map((point) => point.y), [102, 103, 104]);
    assert.equal(context.omittedReadings, 2);
});

test('una marca anterior a la primera lectura dibujada se cuenta, no se traga', () => {
    const start = Date.parse('2026-07-04T00:00:00.000Z');
    const events = [
        meal({ occurredAt: new Date(start).toISOString() }),
        ...Array.from({ length: 3 }, (unused, index) => glucose({
            occurredAt: new Date(start + (index + 1) * 60_000).toISOString(),
            value: String(100 + index),
        })),
    ];

    const context = buildGlucoseContext(events, { unit: 'mg/dL', maxReadings: 2 });

    assert.equal(context.omittedMarkers, 1);
    assert.deepEqual(context.markers, []);
});

test('un evento sin valor legible o con instante ilegible se descarta y se cuenta', () => {
    const context = buildGlucoseContext([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '112' }),
        glucose({ occurredAt: '2026-07-04T09:00:00.000000Z', value: 'sin valor' }),
        meal({ occurredAt: 'no es una fecha' }),
    ], { unit: 'mg/dL' });

    assert.equal(context.discarded, 2);
    assert.equal(context.series[0].points.length, 1);
});
