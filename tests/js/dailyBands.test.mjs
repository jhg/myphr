/**
 * Comprobaciones de `health/dailyBands.js` (ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * Lógica pura, sin DOM ni Chart.js: se llama directamente a las funciones exportadas. Corredor
 * incorporado de Node, como el resto de `tests/js`.
 *
 *     npm test
 *
 * Lo que más importa aquí son las tres reglas de la banda, porque las tres son formas de mentir con
 * una gráfica si se implementan mal: un día sin lecturas dibujado como cero, un día con una sola
 * lectura disfrazado de recorrido, y el día de un evento calculado con la zona horaria de quien
 * mira en vez de la de quien lo registró.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildDailyBands,
    enumerateDays,
    eventDayKey,
    MAX_CHART_DAYS,
    tzOffsetMinutes,
} from '../../resources/js/health/dailyBands.js';

/**
 * @param {object} params
 * @returns {{v: 1, type: string, tz: string, occurredAt: string, data: object}}
 */
function glucoseEvent({ occurredAt, value, unit = 'mg/dL', method = 'capillary', tz = '+00:00' }) {
    return { v: 1, type: 'glucose', tz, occurredAt, data: { value, unit, method, loinc: '41653-7' } };
}

// --- El día es el del evento, no el del navegador ------------------------------------------------

test('eventDayKey usa el desfase con el que se registró el evento', () => {
    /** Las 23:30 del día 4 en Madrid en verano son las 21:30 UTC: el día de la persona es el 4. */
    assert.equal(eventDayKey('2026-07-04T21:30:00.000000Z', '+02:00'), '2026-07-04');

    /** Y las 20:30 del día 4 en Nueva York son ya el día 5 en UTC: el día de la persona sigue siendo el 4. */
    assert.equal(eventDayKey('2026-07-05T00:30:00.000000Z', '-04:00'), '2026-07-04');
});

test('eventDayKey cae a UTC cuando el sobre no trae un desfase utilizable', () => {
    assert.equal(eventDayKey('2026-07-05T00:30:00.000000Z'), '2026-07-05');
    assert.equal(eventDayKey('2026-07-05T00:30:00.000000Z', 'Z'), '2026-07-05');
    assert.equal(eventDayKey('2026-07-05T00:30:00.000000Z', 'Europe/Madrid'), '2026-07-05');
});

test('eventDayKey devuelve cadena vacía si el instante no se entiende, en vez de inventar un día', () => {
    assert.equal(eventDayKey('no es una fecha', '+02:00'), '');
});

test('tzOffsetMinutes entiende el signo y los minutos, y no adivina nada más', () => {
    assert.equal(tzOffsetMinutes('+02:00'), 120);
    assert.equal(tzOffsetMinutes('-05:30'), -330);
    assert.equal(tzOffsetMinutes(undefined), 0);
    assert.equal(tzOffsetMinutes('+2:00'), 0);
});

test('dos eventos del mismo instante caen en días distintos según el desfase de cada uno', () => {
    const { days, series } = buildDailyBands(
        [
            glucoseEvent({ occurredAt: '2026-07-05T00:30:00.000000Z', value: '100', tz: '-04:00' }),
            glucoseEvent({ occurredAt: '2026-07-05T00:30:00.000000Z', value: '200', tz: '+02:00' }),
        ],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.deepEqual(days, ['2026-07-04', '2026-07-05']);
    assert.deepEqual(series[0].points.map((point) => point?.median ?? null), [100, 200]);
});

// --- Huecos ------------------------------------------------------------------------------------

test('un día sin lecturas es un hueco, nunca un cero', () => {
    const { days, series } = buildDailyBands(
        [
            glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '110' }),
            glucoseEvent({ occurredAt: '2026-07-04T09:00:00.000000Z', value: '130' }),
        ],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    /** El eje cubre el tramo entero: si no, los dos días con datos saldrían pegados. */
    assert.deepEqual(days, ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']);
    assert.deepEqual(series[0].points, [
        { median: 110, min: 110, max: 110, count: 1 },
        null,
        null,
        { median: 130, min: 130, max: 130, count: 1 },
    ]);
});

test('un método que no midió un día deja hueco en su serie, no un cero heredado del otro', () => {
    const { series } = buildDailyBands(
        [
            glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '110', method: 'capillary' }),
            glucoseEvent({ occurredAt: '2026-07-02T09:00:00.000000Z', value: '95', method: 'interstitial' }),
        ],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.deepEqual(series.map((entry) => entry.group), ['capillary', 'interstitial']);
    assert.deepEqual(series[0].points.map((point) => point?.median ?? null), [110, null]);
    assert.deepEqual(series[1].points.map((point) => point?.median ?? null), [null, 95]);
});

test('sin ninguna lectura no hay eje ni series, y no se inventa un día', () => {
    const bands = buildDailyBands([], { type: 'glucose', groupBy: 'method', unit: 'mg/dL' });

    assert.deepEqual(bands, { days: [], series: [], excludedByUnit: 0, discarded: 0, omittedDays: 0 });
});

// --- Un solo dato ------------------------------------------------------------------------------

test('un día con una sola lectura colapsa la banda a un punto', () => {
    const { series } = buildDailyBands(
        [glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '117.5' })],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.deepEqual(series[0].points, [{ median: 117.5, min: 117.5, max: 117.5, count: 1 }]);
});

test('un día con varias lecturas da mediana y extremos del propio día', () => {
    const { series } = buildDailyBands(
        [
            glucoseEvent({ occurredAt: '2026-07-01T08:00:00.000000Z', value: '80' }),
            glucoseEvent({ occurredAt: '2026-07-01T13:00:00.000000Z', value: '120' }),
            glucoseEvent({ occurredAt: '2026-07-01T21:00:00.000000Z', value: '200' }),
        ],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.deepEqual(series[0].points, [{ median: 120, min: 80, max: 200, count: 3 }]);
});

// --- Exclusiones, siempre contadas --------------------------------------------------------------

test('las lecturas en otra unidad se cuentan aparte y no entran en la banda (ADR 0007)', () => {
    const { series, excludedByUnit } = buildDailyBands(
        [
            glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '110' }),
            glucoseEvent({ occurredAt: '2026-07-01T10:00:00.000000Z', value: '6.1', unit: 'mmol/L' }),
        ],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.equal(excludedByUnit, 1);
    assert.deepEqual(series[0].points, [{ median: 110, min: 110, max: 110, count: 1 }]);
});

test('lo que no trae número se descarta y se cuenta, sin tumbar la serie', () => {
    const qualitative = glucoseEvent({ occurredAt: '2026-07-01T10:00:00.000000Z', value: undefined });
    delete qualitative.data.value;
    qualitative.data.result = 'negative';

    const { series, discarded } = buildDailyBands(
        [glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '110' }), qualitative],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.equal(discarded, 1);
    assert.equal(series[0].points[0].count, 1);
});

test('los eventos de otro tipo ni se cuentan ni se descartan: no son de esta gráfica', () => {
    const bands = buildDailyBands(
        [{ v: 1, type: 'meal', tz: '+00:00', occurredAt: '2026-07-01T09:00:00.000000Z', data: { mealType: 'lunch' } }],
        { type: 'glucose', groupBy: 'method', unit: 'mg/dL' },
    );

    assert.deepEqual(bands, { days: [], series: [], excludedByUnit: 0, discarded: 0, omittedDays: 0 });
});

// --- Varias magnitudes del mismo evento (tensión) -----------------------------------------------

test('la tensión sale con una serie por magnitud dentro de cada método, en el orden pedido', () => {
    const events = [
        {
            v: 1,
            type: 'bloodPressure',
            tz: '+00:00',
            occurredAt: '2026-07-01T09:00:00.000000Z',
            data: { systolic: '120', diastolic: '80', pulse: '70', method: 'left_sitting', unit: 'mmHg' },
        },
        {
            v: 1,
            type: 'bloodPressure',
            tz: '+00:00',
            occurredAt: '2026-07-01T21:00:00.000000Z',
            data: { systolic: '140', diastolic: '90', pulse: '72', method: 'left_sitting', unit: 'mmHg' },
        },
    ];

    const { series } = buildDailyBands(events, {
        type: 'bloodPressure',
        valueKeys: ['systolic', 'diastolic'],
        groupBy: 'method',
        unit: 'mmHg',
    });

    assert.deepEqual(series.map((entry) => entry.valueKey), ['systolic', 'diastolic']);
    assert.deepEqual(series[0].points, [{ median: 130, min: 120, max: 140, count: 2 }]);
    assert.deepEqual(series[1].points, [{ median: 85, min: 80, max: 90, count: 2 }]);
});

test('a un evento de tensión al que le falta una magnitud se le descarta entero', () => {
    const { series, discarded } = buildDailyBands(
        [{
            v: 1,
            type: 'bloodPressure',
            tz: '+00:00',
            occurredAt: '2026-07-01T09:00:00.000000Z',
            data: { systolic: '120', method: 'left_sitting', unit: 'mmHg' },
        }],
        { type: 'bloodPressure', valueKeys: ['systolic', 'diastolic'], groupBy: 'method', unit: 'mmHg' },
    );

    assert.equal(discarded, 1);
    assert.deepEqual(series, []);
});

// --- Tipos sin agrupación y tope del eje ---------------------------------------------------------

test('un tipo que no agrupa cae en una única serie con el grupo vacío', () => {
    const { series } = buildDailyBands(
        [{
            v: 1,
            type: 'bodyWeight',
            tz: '+00:00',
            occurredAt: '2026-07-01T09:00:00.000000Z',
            data: { value: '70.4', unit: 'kg' },
        }],
        { type: 'bodyWeight', unit: 'kg' },
    );

    assert.equal(series.length, 1);
    assert.equal(series[0].group, '');
});

test('un tramo más largo que el tope conserva los días recientes y dice cuántos deja fuera', () => {
    const events = [
        glucoseEvent({ occurredAt: '2020-01-01T09:00:00.000000Z', value: '100' }),
        glucoseEvent({ occurredAt: '2026-07-01T09:00:00.000000Z', value: '120' }),
    ];

    const { days, omittedDays } = buildDailyBands(events, { type: 'glucose', groupBy: 'method', unit: 'mg/dL' });

    assert.equal(days.length, MAX_CHART_DAYS);
    assert.equal(days[days.length - 1], '2026-07-01');
    assert.ok(omittedDays > 0);
});

test('enumerateDays cubre los dos extremos y cruza el cambio de mes', () => {
    assert.deepEqual(enumerateDays('2026-02-27', '2026-03-02'), [
        '2026-02-27',
        '2026-02-28',
        '2026-03-01',
        '2026-03-02',
    ]);
    assert.deepEqual(enumerateDays('2026-07-01', '2026-07-01'), ['2026-07-01']);
});
