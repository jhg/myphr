/**
 * Comprobaciones de la lógica pura de `health/bloodPressurePage.js` (ADR 0004, ADR 0006, ADR 0008).
 *
 * No se monta Alpine ni Chart.js: `bloodPressurePage()` solo orquesta DOM y librerías externas, y
 * esa orquestación no se prueba aquí. Lo que se prueba es la lógica que no depende de ninguna de
 * las dos, exportada aparte para poder llamarla directamente. Mismo enfoque que
 * `tests/js/glucosePage.test.mjs`.
 *
 * Corredor incorporado de Node, como el resto de `tests/js` (ver `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildBloodPressureContent,
    filterBloodPressureEvents,
    groupBloodPressureByMethod,
    groupPulseByMethod,
    methodKey,
    methodLabel,
    splitMethodKey,
} from '../../resources/js/health/bloodPressurePage.js';
import { datetimeLocalToCanonical, formatTzOffset } from '../../resources/js/health/datetimeLocal.js';
import { parseNumericValue } from '../../resources/js/health/numericValue.js';

/** Campos comunes de prueba, con la forma que devuelve `buildCommonEventFields` (ADR 0006). */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

/** Catálogo de prueba, con la forma que devuelve `BloodPressure::catalog()` (ADR 0005, ADR 0008). */
const CATALOG = Object.freeze({
    arms: [
        { token: 'left', label: 'Izquierdo' },
        { token: 'right', label: 'Derecho' },
    ],
    postures: [
        { token: 'sitting', label: 'Sentado' },
        { token: 'lying', label: 'Tumbado' },
        { token: 'standing', label: 'De pie' },
    ],
    units: { pressure: 'mm[Hg]', pulse: '/min' },
    loinc: { systolic: '8480-6', diastolic: '8462-4', pulse: '8867-4' },
});

test('buildBloodPressureContent: forma exacta del ADR 0006, con pulso', () => {
    const content = buildBloodPressureContent({
        systolic: '120',
        diastolic: '80',
        pulse: '72',
        arm: 'left',
        posture: 'sitting',
        tz: '+02:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.deepEqual(content, {
        v: 1,
        type: 'bloodPressure',
        tz: '+02:00',
        origin: 'manual',
        recordedBy: 'self',
        data: {
            systolic: '120',
            diastolic: '80',
            unit: 'mm[Hg]',
            loinc: { systolic: '8480-6', diastolic: '8462-4', pulse: '8867-4' },
            arm: 'left',
            posture: 'sitting',
            pulse: '72',
            pulseUnit: '/min',
        },
    });
});

test('buildBloodPressureContent: los tres valores viajan como cadena, nunca como número (ADR 0004)', () => {
    const content = buildBloodPressureContent({
        systolic: '135',
        diastolic: '85',
        pulse: '68',
        arm: 'right',
        posture: 'standing',
        tz: '+02:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.equal(typeof content.data.systolic, 'string');
    assert.equal(typeof content.data.diastolic, 'string');
    assert.equal(typeof content.data.pulse, 'string');
});

test('buildBloodPressureContent: los tres valores que llegan al payload son siempre cadena con punto, tras pasar por parseNumericValue (criterio numérico del cliente)', () => {
    const content = buildBloodPressureContent({
        systolic: parseNumericValue('13,5', 'La sistólica'),
        diastolic: parseNumericValue('8,5', 'La diastólica'),
        pulse: parseNumericValue('6,8', 'El pulso'),
        arm: 'right',
        posture: 'standing',
        tz: '+02:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.systolic, '13.5');
    assert.equal(content.data.diastolic, '8.5');
    assert.equal(content.data.pulse, '6.8');
});

test('buildBloodPressureContent: pulso ausente, no entra pulse, pulseUnit ni loinc.pulse', () => {
    const withoutPulseField = buildBloodPressureContent({
        systolic: '120',
        diastolic: '80',
        arm: 'left',
        posture: 'sitting',
        tz: '+02:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.equal('pulse' in withoutPulseField.data, false);
    assert.equal('pulseUnit' in withoutPulseField.data, false);
    assert.equal('pulse' in withoutPulseField.data.loinc, false);
    assert.deepEqual(withoutPulseField.data.loinc, { systolic: '8480-6', diastolic: '8462-4' });

    const withEmptyPulse = buildBloodPressureContent({
        systolic: '120',
        diastolic: '80',
        pulse: '   ',
        arm: 'left',
        posture: 'sitting',
        tz: '+02:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.equal('pulse' in withEmptyPulse.data, false);
    assert.equal('pulseUnit' in withEmptyPulse.data, false);
});

test('buildBloodPressureContent: los campos comunes van en el nivel superior, nunca dentro de data', () => {
    const content = buildBloodPressureContent({
        systolic: '120',
        diastolic: '80',
        arm: 'left',
        posture: 'sitting',
        tz: '+02:00',
        catalog: CATALOG,
        common: { origin: 'manual', recordedBy: 'caregiver', device: 'Omron M3', note: 'Nota libre' },
    });

    assert.equal(content.origin, 'manual');
    assert.equal(content.recordedBy, 'caregiver');
    assert.equal(content.device, 'Omron M3');
    assert.equal(content.note, 'Nota libre');

    assert.equal('origin' in content.data, false);
    assert.equal('recordedBy' in content.data, false);
    assert.equal('device' in content.data, false);
    assert.equal('note' in content.data, false);
});

test('buildBloodPressureContent: sin sistólica, diastólica, brazo o postura, lanza en vez de guardar algo a medias', () => {
    const base = { tz: '+02:00', catalog: CATALOG, common: COMMON_FIELDS };

    assert.throws(() => buildBloodPressureContent({ ...base, systolic: '', diastolic: '80', arm: 'left', posture: 'sitting' }));
    assert.throws(() => buildBloodPressureContent({ ...base, systolic: '120', diastolic: '  ', arm: 'left', posture: 'sitting' }));
    assert.throws(() => buildBloodPressureContent({ ...base, systolic: '120', diastolic: '80', arm: '', posture: 'sitting' }));
    assert.throws(() => buildBloodPressureContent({ ...base, systolic: '120', diastolic: '80', arm: 'left', posture: '' }));
});

test('buildBloodPressureContent: los tres códigos LOINC son los del catálogo, no inventados', () => {
    const content = buildBloodPressureContent({
        systolic: '120',
        diastolic: '80',
        pulse: '72',
        arm: 'left',
        posture: 'sitting',
        tz: '+02:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.loinc.systolic, '8480-6');
    assert.equal(content.data.loinc.diastolic, '8462-4');
    assert.equal(content.data.loinc.pulse, '8867-4');
});

test('methodKey: junta brazo y postura en una sola clave estable', () => {
    assert.equal(methodKey('left', 'sitting'), 'left_sitting');
    assert.equal(methodKey('right', 'standing'), 'right_standing');
});

test('methodLabel: resuelve la etiqueta del catálogo para brazo y postura', () => {
    assert.equal(methodLabel(CATALOG, 'left', 'sitting'), 'Izquierdo, Sentado');
    assert.equal(methodLabel(CATALOG, 'right', 'standing'), 'Derecho, De pie');
});

test('filterBloodPressureEvents: descarta los eventos que no son de tipo bloodPressure', () => {
    const events = [
        { id: '1', occurredAt: 'a', content: { type: 'bloodPressure', data: {} } },
        { id: '2', occurredAt: 'b', content: { type: 'glucose', data: {} } },
        { id: '3', occurredAt: 'c', content: { type: 'meal', data: {} } },
        { id: '4', occurredAt: 'd', content: { type: 'bloodPressure', data: {} } },
    ];

    const filtered = filterBloodPressureEvents(events);

    assert.deepEqual(filtered.map((event) => event.id), ['1', '4']);
});

test('groupBloodPressureByMethod: separa sistólica y diastólica por método (brazo + postura), ordenadas', () => {
    const events = [
        bloodPressureEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', systolic: '122', diastolic: '80', arm: 'left', posture: 'sitting' }),
        bloodPressureEvent({ occurredAt: '2026-07-25T08:00:00.000000Z', systolic: '118', diastolic: '78', arm: 'left', posture: 'sitting' }),
        bloodPressureEvent({ occurredAt: '2026-07-25T09:30:00.000000Z', systolic: '140', diastolic: '90', arm: 'right', posture: 'standing' }),
    ];

    const seriesByMethod = groupBloodPressureByMethod(events);

    assert.deepEqual(Object.keys(seriesByMethod).sort(), ['left_sitting', 'right_standing']);

    assert.equal(seriesByMethod.left_sitting.systolic.length, 2);
    assert.equal(seriesByMethod.left_sitting.systolic[0].y, 118);
    assert.equal(seriesByMethod.left_sitting.systolic[1].y, 122);
    assert.ok(seriesByMethod.left_sitting.systolic[0].x < seriesByMethod.left_sitting.systolic[1].x);

    assert.equal(seriesByMethod.left_sitting.diastolic[0].y, 78);
    assert.equal(seriesByMethod.left_sitting.diastolic[1].y, 80);

    assert.equal(seriesByMethod.right_standing.systolic.length, 1);
    assert.equal(seriesByMethod.right_standing.systolic[0].y, 140);
});

test('groupBloodPressureByMethod: no mezcla brazos ni posturas distintas en una misma serie (ADR 0008)', () => {
    const events = [
        bloodPressureEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', systolic: '120', diastolic: '80', arm: 'left', posture: 'sitting' }),
        bloodPressureEvent({ occurredAt: '2026-07-25T09:05:00.000000Z', systolic: '135', diastolic: '88', arm: 'left', posture: 'standing' }),
        bloodPressureEvent({ occurredAt: '2026-07-25T09:10:00.000000Z', systolic: '125', diastolic: '82', arm: 'right', posture: 'sitting' }),
    ];

    const seriesByMethod = groupBloodPressureByMethod(events);

    assert.deepEqual(Object.keys(seriesByMethod).sort(), ['left_sitting', 'left_standing', 'right_sitting']);
    assert.equal(seriesByMethod.left_sitting.systolic.length, 1);
    assert.equal(seriesByMethod.left_standing.systolic.length, 1);
    assert.equal(seriesByMethod.right_sitting.systolic.length, 1);
});

test('groupPulseByMethod: agrupa el pulso por método y cuenta los registros sin pulso', () => {
    const events = [
        bloodPressureEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', systolic: '120', diastolic: '80', arm: 'left', posture: 'sitting', pulse: '70' }),
        bloodPressureEvent({ occurredAt: '2026-07-25T08:00:00.000000Z', systolic: '118', diastolic: '78', arm: 'left', posture: 'sitting', pulse: '65' }),
        bloodPressureEvent({ occurredAt: '2026-07-25T09:30:00.000000Z', systolic: '140', diastolic: '90', arm: 'right', posture: 'standing' }),
    ];

    const { seriesByMethod, missingPulseCount } = groupPulseByMethod(events);

    assert.equal(missingPulseCount, 1);
    assert.deepEqual(Object.keys(seriesByMethod), ['left_sitting']);
    assert.equal(seriesByMethod.left_sitting.length, 2);
    assert.equal(seriesByMethod.left_sitting[0].y, 65);
    assert.equal(seriesByMethod.left_sitting[1].y, 70);
});

test('groupPulseByMethod: tolera un evento sin pulso y no lo cuenta como cero', () => {
    const events = [
        bloodPressureEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', systolic: '120', diastolic: '80', arm: 'left', posture: 'sitting' }),
    ];

    const { seriesByMethod, missingPulseCount } = groupPulseByMethod(events);

    assert.deepEqual(seriesByMethod, {});
    assert.equal(missingPulseCount, 1);
});

test('formatTzOffset: signo positivo cuando la hora local va por delante de UTC', () => {
    assert.equal(formatTzOffset(120), '+02:00');
    assert.equal(formatTzOffset(-300), '-05:00');
    assert.equal(formatTzOffset(0), '+00:00');
});

test('datetimeLocalToCanonical: instante correcto con un desfase positivo (Madrid, +02:00)', () => {
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-07-25T14:30:00', {
        timezoneOffsetMinutes: -120,
    });

    assert.equal(occurredAt, '2026-07-25T12:30:00.000000Z');
    assert.equal(tz, '+02:00');
});

test('datetimeLocalToCanonical: acepta datetime-local sin segundos', () => {
    const { occurredAt } = datetimeLocalToCanonical('2026-07-25T11:08', { timezoneOffsetMinutes: 0 });

    assert.equal(occurredAt, '2026-07-25T11:08:00.000000Z');
});

/**
 * @param {{occurredAt: string, systolic: string, diastolic: string, arm: string, posture: string, pulse?: string}} params
 * @returns {{id: string, occurredAt: string, content: object}}
 */
function bloodPressureEvent({ occurredAt, systolic, diastolic, arm, posture, pulse }) {
    const data = {
        systolic,
        diastolic,
        unit: 'mm[Hg]',
        loinc: { systolic: '8480-6', diastolic: '8462-4' },
        arm,
        posture,
    };

    if (typeof pulse === 'string') {
        data.pulse = pulse;
        data.pulseUnit = '/min';
        data.loinc.pulse = '8867-4';
    }

    return {
        id: occurredAt,
        occurredAt,
        content: { v: 1, type: 'bloodPressure', tz: '+00:00', origin: 'manual', recordedBy: 'self', data },
    };
}

/*
 * Contrato de la clave de método (ADR 0008). `methodKey` y `splitMethodKey` tienen que ser inversas
 * exactas: la gráfica y los pies agrupan por esa clave y luego la deshacen para rotular. Si el
 * corte se hiciera por todos los separadores y no por el primero, un token compuesto daría tres
 * trozos y la etiqueta saldría mal, en silencio.
 */
test('splitMethodKey deshace methodKey', () => {
    assert.deepEqual(splitMethodKey(methodKey('left', 'sitting')), ['left', 'sitting']);
    assert.deepEqual(splitMethodKey(methodKey('right', 'standing')), ['right', 'standing']);
});

test('splitMethodKey corta por el primer separador, no por todos', () => {
    assert.deepEqual(splitMethodKey(methodKey('left', 'semi_recumbent')), ['left', 'semi_recumbent']);
    assert.equal(methodLabel(CATALOG, ...splitMethodKey(methodKey('left', 'sitting'))), 'Izquierdo, Sentado');
});

test('splitMethodKey tolera una clave sin separador en vez de reventar', () => {
    assert.deepEqual(splitMethodKey('left'), ['left', '']);
});

/*
 * Un sobre de otra pantalla no puede colarse en el historial de tensión ni en las gráficas: el
 * servidor no puede filtrar por tipo porque va cifrado (ADR 0006), así que el filtro del cliente es
 * lo único que hay.
 */
test('filterBloodPressureEvents deja fuera un evento sin contenido descifrado', () => {
    const filtered = filterBloodPressureEvents([
        { id: '1', occurredAt: '2026-07-25T10:00:00.000000Z', content: null },
        { id: '2', occurredAt: '2026-07-25T11:00:00.000000Z', content: { type: 'bloodPressure', data: {} } },
    ]);

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, '2');
});

/*
 * Estado sin datos: ninguna de las dos agrupaciones puede inventar una serie ni un cero. Un cero en
 * una gráfica de tensión se lee como una medida real.
 */
test('sin eventos, ninguna agrupación produce series ni ceros', () => {
    assert.deepEqual(groupBloodPressureByMethod([]), {});
    assert.deepEqual(groupPulseByMethod([]), { seriesByMethod: {}, missingPulseCount: 0 });
});

/*
 * El pulso es opcional (ADR 0006). Si no se teclea, no puede aparecer como cadena vacía ni como
 * cero en el contenido cifrado: ausencia tiene que significar ausencia.
 */
test('buildBloodPressureContent omite pulso, pulseUnit y loinc.pulse cuando no se indica el pulso', () => {
    const content = buildBloodPressureContent({
        systolic: '118',
        diastolic: '76',
        pulse: parseNumericValue('', 'El pulso'),
        arm: 'right',
        posture: 'standing',
        tz: '+01:00',
        catalog: CATALOG,
        common: COMMON_FIELDS,
    });

    assert.equal('pulse' in content.data, false);
    assert.equal('pulseUnit' in content.data, false);
    assert.equal('pulse' in content.data.loinc, false);
});
