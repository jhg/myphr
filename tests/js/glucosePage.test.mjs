/**
 * Comprobaciones de la lógica pura de `health/glucosePage.js` (ADR 0004, ADR 0006, ADR 0008).
 *
 * No se monta Alpine ni Chart.js: `glucosePage()` solo orquesta DOM y librerías externas, y esa
 * orquestación no se prueba aquí. Lo que se prueba es la lógica que no depende de ninguna de las
 * dos, exportada aparte para poder llamarla directamente.
 *
 * Corredor incorporado de Node, como el resto de `tests/js` (ver `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildGlucoseContent,
    chartCaptionText,
    datetimeLocalToCanonical,
    filterGlucoseEvents,
    formatTzOffset,
    groupGlucoseByMethod,
    mealContextLabel,
    resolveLoincCode,
} from '../../resources/js/health/glucosePage.js';
import { parseNumericValue } from '../../resources/js/health/numericValue.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/**
 * Estos tests afirman el texto **en castellano**, así que fijan el idioma en vez de darlo por
 * supuesto: el idioma por defecto del cliente es el inglés (igual que `config/app.php`), y en Node
 * no hay `<html lang>` del que deducirlo. Sin esta línea, las afirmaciones de texto de abajo
 * estarían comprobando el catálogo de respaldo sin decirlo.
 */
setLocale('es');

/** Campos comunes de prueba, con la forma que devuelve `buildCommonEventFields` (ADR 0006). */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

/** Tabla LOINC de prueba, con la forma que devuelve `Glucose::catalog()` (ADR 0005, ADR 0008). */
const LOINC_TABLE = Object.freeze([
    { method: 'capillary', unit: 'mg/dL', code: '41653-7' },
    { method: 'capillary', unit: 'mmol/L', code: '14743-9' },
    { method: 'interstitial', unit: 'mg/dL', code: '99504-3' },
    { method: 'interstitial', unit: 'mmol/L', code: '105272-9' },
]);

test('buildGlucoseContent: forma exacta del ADR 0006 para cada combinación de método y unidad', () => {
    const cases = [
        { method: 'capillary', unit: 'mg/dL', loinc: '41653-7' },
        { method: 'capillary', unit: 'mmol/L', loinc: '14743-9' },
        { method: 'interstitial', unit: 'mg/dL', loinc: '99504-3' },
        { method: 'interstitial', unit: 'mmol/L', loinc: '105272-9' },
    ];

    for (const { method, unit, loinc } of cases) {
        const content = buildGlucoseContent({
            value: '142',
            unit,
            method,
            mealContext: 'fasting',
            tz: '+02:00',
            loincTable: LOINC_TABLE,
            common: COMMON_FIELDS,
        });

        assert.deepEqual(content, {
            v: 1,
            type: 'glucose',
            tz: '+02:00',
            origin: 'manual',
            recordedBy: 'self',
            data: { value: '142', unit, loinc, method, mealContext: 'fasting' },
        });

        assert.equal(typeof content.data.value, 'string', 'value debe ser cadena, nunca número (ADR 0004)');
    }
});

test('buildGlucoseContent: el valor que llega al payload es siempre cadena con punto, tras pasar por parseNumericValue (criterio numérico del cliente)', () => {
    const value = parseNumericValue('7,85', 'El valor');

    const content = buildGlucoseContent({
        value,
        unit: 'mmol/L',
        method: 'capillary',
        mealContext: '',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.value, '7.85');
    assert.equal(typeof content.data.value, 'string');
});

test('buildGlucoseContent: mealContext vacío o ausente no entra en data (ADR 0006, opcional)', () => {
    const withEmptyString = buildGlucoseContent({
        value: '142',
        unit: 'mg/dL',
        method: 'capillary',
        mealContext: '',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
        common: COMMON_FIELDS,
    });

    assert.equal('mealContext' in withEmptyString.data, false);

    const withoutField = buildGlucoseContent({
        value: '142',
        unit: 'mg/dL',
        method: 'capillary',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
        common: COMMON_FIELDS,
    });

    assert.equal('mealContext' in withoutField.data, false);
});

test('buildGlucoseContent: mealContext con valor sí entra en data', () => {
    const content = buildGlucoseContent({
        value: '142',
        unit: 'mg/dL',
        method: 'capillary',
        mealContext: 'after_meal',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.mealContext, 'after_meal');
});

test('buildGlucoseContent: los campos comunes van en el nivel superior, nunca dentro de data', () => {
    const content = buildGlucoseContent({
        value: '142',
        unit: 'mg/dL',
        method: 'capillary',
        mealContext: 'fasting',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
        common: { origin: 'device', recordedBy: 'caregiver', device: 'Freestyle Libre 3', note: 'Nota libre' },
    });

    assert.equal(content.origin, 'device');
    assert.equal(content.recordedBy, 'caregiver');
    assert.equal(content.device, 'Freestyle Libre 3');
    assert.equal(content.note, 'Nota libre');

    assert.equal('origin' in content.data, false);
    assert.equal('recordedBy' in content.data, false);
    assert.equal('device' in content.data, false);
    assert.equal('note' in content.data, false);
});

test('mealContextLabel: tolera un evento sin mealContext y no inventa nada', () => {
    const catalog = { mealContexts: [{ token: 'fasting', label: 'En ayunas' }] };

    assert.equal(mealContextLabel(catalog, {}), null);
    assert.equal(mealContextLabel(catalog, { mealContext: '' }), null);
    assert.equal(mealContextLabel(catalog, { mealContext: 'fasting' }), 'En ayunas');
});

test('buildGlucoseContent: sin valor, lanza en vez de guardar algo a medias', () => {
    assert.throws(() => buildGlucoseContent({
        value: '   ',
        unit: 'mg/dL',
        method: 'capillary',
        mealContext: 'fasting',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
    }));
});

test('resolveLoincCode: combinación de método y unidad sin código, lanza y no inventa uno', () => {
    assert.throws(() => resolveLoincCode(LOINC_TABLE, 'capillary', 'g'));
});

test('buildGlucoseContent: propaga el fallo de resolveLoincCode, nunca guarda sin código', () => {
    assert.throws(() => buildGlucoseContent({
        value: '142',
        unit: 'g',
        method: 'capillary',
        mealContext: 'fasting',
        tz: '+02:00',
        loincTable: LOINC_TABLE,
    }));
});

test('formatTzOffset: signo y ceros a la izquierda', () => {
    assert.equal(formatTzOffset(120), '+02:00');
    assert.equal(formatTzOffset(-300), '-05:00');
    assert.equal(formatTzOffset(0), '+00:00');
    assert.equal(formatTzOffset(-30), '-00:30');
});

test('datetimeLocalToCanonical: instante correcto con un desfase distinto de cero (Madrid, +02:00)', () => {
    /** `getTimezoneOffset()` para +02:00 es -120 (UTC menos local, ver JSDoc de la función). */
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-07-25T11:08:07', {
        timezoneOffsetMinutes: -120,
    });

    assert.equal(occurredAt, '2026-07-25T09:08:07.000000Z');
    assert.equal(tz, '+02:00');
});

test('datetimeLocalToCanonical: instante correcto con un desfase negativo (Nueva York, -05:00)', () => {
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-07-25T07:00:00', {
        timezoneOffsetMinutes: 300,
    });

    assert.equal(occurredAt, '2026-07-25T12:00:00.000000Z');
    assert.equal(tz, '-05:00');
});

test('datetimeLocalToCanonical: acepta datetime-local sin segundos', () => {
    const { occurredAt } = datetimeLocalToCanonical('2026-07-25T11:08', { timezoneOffsetMinutes: 0 });

    assert.equal(occurredAt, '2026-07-25T11:08:00.000000Z');
});

test('filterGlucoseEvents: descarta los eventos que no son de tipo glucose', () => {
    const events = [
        { id: '1', occurredAt: 'a', content: { type: 'glucose', data: {} } },
        { id: '2', occurredAt: 'b', content: { type: 'insulin', data: {} } },
        { id: '3', occurredAt: 'c', content: { type: 'meal', data: {} } },
        { id: '4', occurredAt: 'd', content: { type: 'glucose', data: {} } },
    ];

    const filtered = filterGlucoseEvents(events);

    assert.deepEqual(filtered.map((event) => event.id), ['1', '4']);
});

test('groupGlucoseByMethod: separa por método y deja fuera los de otra unidad, contándolos', () => {
    const events = [
        glucoseEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', value: '100', unit: 'mg/dL', method: 'capillary' }),
        glucoseEvent({ occurredAt: '2026-07-25T08:00:00.000000Z', value: '95', unit: 'mg/dL', method: 'capillary' }),
        glucoseEvent({ occurredAt: '2026-07-25T09:30:00.000000Z', value: '110', unit: 'mg/dL', method: 'interstitial' }),
        glucoseEvent({ occurredAt: '2026-07-25T10:00:00.000000Z', value: '6.1', unit: 'mmol/L', method: 'capillary' }),
    ];

    const { seriesByMethod, excludedByUnit } = groupGlucoseByMethod(events, 'mg/dL');

    assert.equal(excludedByUnit, 1);
    assert.deepEqual(Object.keys(seriesByMethod).sort(), ['capillary', 'interstitial']);

    /** La serie capilar solo trae los dos eventos en mg/dL, ordenados por fecha. */
    assert.equal(seriesByMethod.capillary.length, 2);
    assert.equal(seriesByMethod.capillary[0].y, 95);
    assert.equal(seriesByMethod.capillary[1].y, 100);
    assert.ok(seriesByMethod.capillary[0].x < seriesByMethod.capillary[1].x);

    assert.equal(seriesByMethod.interstitial.length, 1);
    assert.equal(seriesByMethod.interstitial[0].y, 110);
});

test('groupGlucoseByMethod: sin eventos en la unidad de presentación, no hay series', () => {
    const events = [
        glucoseEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', value: '6.1', unit: 'mmol/L', method: 'capillary' }),
    ];

    const { seriesByMethod, excludedByUnit } = groupGlucoseByMethod(events, 'mg/dL');

    assert.deepEqual(seriesByMethod, {});
    assert.equal(excludedByUnit, 1);
});

/**
 * @param {{occurredAt: string, value: string, unit: string, method: string}} params
 * @returns {{id: string, occurredAt: string, content: object}}
 */
function glucoseEvent({ occurredAt, value, unit, method }) {
    return {
        id: occurredAt,
        occurredAt,
        content: {
            v: 1,
            type: 'glucose',
            tz: '+00:00',
            data: { value, unit, loinc: '41653-7', method, mealContext: 'fasting' },
        },
    };
}

test('chartCaptionText: sin ningún registro dice lo mismo que la lista, no «en esta unidad»', () => {
    const caption = chartCaptionText({
        methodLabels: [],
        presentationUnit: 'mg/dL',
        excludedByUnit: 0,
        hasEvents: false,
    });

    assert.equal(caption, 'Todavía no hay registros de glucemia.');
});

test('chartCaptionText: nombra los métodos incluidos (ADR 0008, nada se mezcla en silencio)', () => {
    const caption = chartCaptionText({
        methodLabels: ['Capilar (punción digital)', 'Intersticial (sensor continuo)'],
        presentationUnit: 'mg/dL',
        excludedByUnit: 0,
        hasEvents: true,
    });

    assert.equal(caption, 'Incluye: Capilar (punción digital), Intersticial (sensor continuo).');
});

test('chartCaptionText: cuenta los registros dejados fuera por estar en otra unidad', () => {
    const caption = chartCaptionText({
        methodLabels: ['Capilar (punción digital)'],
        presentationUnit: 'mg/dL',
        excludedByUnit: 2,
        hasEvents: true,
    });

    assert.match(caption, /^Incluye: Capilar \(punción digital\)\./);
    assert.match(caption, /2 registros en otra unidad distinta de mg\/dL no se muestran/);
});

test('chartCaptionText: hay registros pero ninguno en la unidad mostrada, la gráfica vacía se explica', () => {
    const caption = chartCaptionText({
        methodLabels: [],
        presentationUnit: 'mmol/L',
        excludedByUnit: 3,
        hasEvents: true,
    });

    assert.match(caption, /Ningún registro está en mmol\/L/);
    assert.match(caption, /3 registros en otra unidad distinta de mmol\/L/);
});
