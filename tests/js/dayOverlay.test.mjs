/**
 * Comprobaciones de `health/dayOverlay.js`: la superposición de días sobre un eje de 24 horas
 * (ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * Lógica pura, sin DOM ni Chart.js:
 *
 *     npm test
 *
 * Lo que se vigila aquí es lo que haría falsa esta gráfica: una hora sin lecturas con una mediana
 * inventada, una capilar y una intersticial promediadas en la misma línea gruesa, lecturas de otra
 * unidad coladas en la nube, la hora del día resuelta con la zona del navegador —que desplazaría el
 * patrón diario entero— y días recortados sin decirlo.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDayOverlay, hourOfDay } from '../../resources/js/health/dayOverlay.js';

/**
 * @param {object} params
 * @returns {object}
 */
function glucose({ occurredAt, value, unit = 'mg/dL', method = 'capillary', tz = '+00:00' }) {
    return { v: 1, type: 'glucose', tz, occurredAt, data: { value, unit, method, loinc: '41653-7' } };
}

/**
 * Mediana de una hora concreta de un grupo, o `null` si esa hora no tiene ninguna.
 *
 * @param {object} group
 * @param {number} hour
 * @returns {number|null}
 */
function medianAt(group, hour) {
    return group.median[hour].y;
}

// --- Sin datos y con un solo dato ---------------------------------------------------------------

test('sin lecturas no hay ningún grupo ni ningún día superpuesto', () => {
    const overlay = buildDayOverlay([], { unit: 'mg/dL' });

    assert.deepEqual(overlay.groups, []);
    assert.equal(overlay.dayCount, 0);
    assert.equal(overlay.omittedDays, 0);
});

test('una sola lectura da un día con un punto y una única hora con mediana', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:30:00.000000Z', value: '112' }),
    ], { unit: 'mg/dL' });

    const [group] = overlay.groups;

    assert.equal(overlay.dayCount, 1);
    assert.deepEqual(group.days.map((day) => day.day), ['2026-07-04']);
    assert.equal(group.days[0].points[0].x, 8.5);
    assert.equal(medianAt(group, 8), 112);
});

// --- Las horas sin lecturas son huecos, jamás ceros ----------------------------------------------

test('la mediana horaria tiene las 24 franjas y las vacías van a hueco, nunca a cero', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:30:00.000000Z', value: '112' }),
    ], { unit: 'mg/dL' });

    const [group] = overlay.groups;

    assert.equal(group.median.length, 24);
    /** Un cero en glucemia es una hipoglucemia mortal: no se dibuja donde no se midió. */
    assert.equal(medianAt(group, 3), null);
    assert.equal(group.median.filter((point) => point.y !== null).length, 1);
});

test('la mediana de una hora es la de todas las lecturas de esa hora en todos los días', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:10:00.000000Z', value: '100' }),
        glucose({ occurredAt: '2026-07-05T08:40:00.000000Z', value: '140' }),
        glucose({ occurredAt: '2026-07-06T08:50:00.000000Z', value: '180' }),
    ], { unit: 'mg/dL' });

    assert.equal(medianAt(overlay.groups[0], 8), 140);
    assert.equal(overlay.dayCount, 3);
});

test('el punto de la mediana se coloca en el centro de su franja, no en el comienzo', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:10:00.000000Z', value: '100' }),
    ], { unit: 'mg/dL' });

    assert.equal(overlay.groups[0].median[8].x, 8.5);
});

// --- Una serie por método de medición (ADR 0008) ------------------------------------------------

test('cada método tiene sus días y su propia mediana horaria', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:10:00.000000Z', value: '100', method: 'capillary' }),
        glucose({ occurredAt: '2026-07-04T08:20:00.000000Z', value: '200', method: 'interstitial' }),
    ], { unit: 'mg/dL' });

    assert.deepEqual(overlay.groups.map((group) => group.group), ['capillary', 'interstitial']);
    assert.equal(medianAt(overlay.groups[0], 8), 100);
    assert.equal(medianAt(overlay.groups[1], 8), 200);
});

// --- No se convierte entre unidades (ADR 0007) --------------------------------------------------

test('lo que está en otra unidad se excluye y se cuenta', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:10:00.000000Z', value: '112' }),
        glucose({ occurredAt: '2026-07-04T09:10:00.000000Z', value: '6.2', unit: 'mmol/L' }),
    ], { unit: 'mg/dL' });

    assert.equal(overlay.excludedByUnit, 1);
    assert.equal(medianAt(overlay.groups[0], 9), null);
});

// --- La hora del día es la de quien registró ----------------------------------------------------

test('la hora del día sale del desfase del propio evento, no del navegador', () => {
    const overlay = buildDayOverlay([
        /** Las 23:30 del día 4 en Madrid, registradas como 21:30 UTC. */
        glucose({ occurredAt: '2026-07-04T21:30:00.000000Z', value: '140', tz: '+02:00' }),
    ], { unit: 'mg/dL' });

    const [group] = overlay.groups;

    assert.deepEqual(group.days.map((day) => day.day), ['2026-07-04']);
    assert.equal(group.days[0].points[0].x, 23.5);
    assert.equal(medianAt(group, 23), 140);
});

test('hourOfDay no se sale nunca del rango de un día', () => {
    assert.equal(hourOfDay(Date.parse('2026-07-04T00:00:00.000Z')), 0);
    assert.equal(hourOfDay(Date.parse('2026-07-04T23:45:00.000Z')), 23.75);
    /** Un instante anterior a la época sigue dando una hora del día, no un número negativo. */
    assert.equal(hourOfDay(-3_600_000), 23);
});

// --- Nada se recorta en silencio ----------------------------------------------------------------

test('se conservan los días más recientes y se dice cuántos quedaron fuera', () => {
    const events = Array.from({ length: 5 }, (unused, index) => glucose({
        occurredAt: `2026-07-0${index + 1}T08:00:00.000000Z`,
        value: String(100 + index),
    }));

    const overlay = buildDayOverlay(events, { unit: 'mg/dL', maxDays: 3 });

    assert.deepEqual(overlay.groups[0].days.map((day) => day.day), ['2026-07-03', '2026-07-04', '2026-07-05']);
    assert.equal(overlay.dayCount, 3);
    assert.equal(overlay.omittedDays, 2);
    /** La mediana describe la nube que se ve, no una que incluya días que no se dibujan. */
    assert.equal(medianAt(overlay.groups[0], 8), 103);
});

test('un evento sin valor legible se descarta y se cuenta, no se cuela como cero', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-04T08:00:00.000000Z', value: '112' }),
        glucose({ occurredAt: '2026-07-04T09:00:00.000000Z', value: '' }),
    ], { unit: 'mg/dL' });

    assert.equal(overlay.discarded, 1);
    assert.equal(medianAt(overlay.groups[0], 9), null);
});

test('los días de un grupo llegan ordenados y sus puntos también, por hora del día', () => {
    const overlay = buildDayOverlay([
        glucose({ occurredAt: '2026-07-05T20:00:00.000000Z', value: '150' }),
        glucose({ occurredAt: '2026-07-04T07:00:00.000000Z', value: '90' }),
        glucose({ occurredAt: '2026-07-05T06:00:00.000000Z', value: '110' }),
    ], { unit: 'mg/dL' });

    const [group] = overlay.groups;

    assert.deepEqual(group.days.map((day) => day.day), ['2026-07-04', '2026-07-05']);
    assert.deepEqual(group.days[1].points.map((point) => point.x), [6, 20]);
});
