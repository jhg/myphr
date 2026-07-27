/**
 * Lectura clínica de un recorte (`resources/js/reader/clinicalReport.js`, ADR 0011).
 *
 * Lo que estos tests fijan no es el aspecto de la tabla, sino lo que un profesional necesita para no
 * leer mal un dato: valor **con** unidad, método de medición, término LOINC sin traducir, y ninguna
 * fila que desaparezca en silencio.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
    describeEvent,
    labelFor,
    loincEntries,
    measurement,
    rangeText,
    reportHeadline,
    resolveCatalog,
    sortByDateDescending,
    typeSummary,
    unitLabel,
} from '../../resources/js/reader/clinicalReport.js';
import { DEFAULT_LOCALE, setLocale } from '../../resources/js/i18n/index.js';

afterEach(() => {
    setLocale(DEFAULT_LOCALE);
});

/** Recorte del catálogo que emite `App\Sharing\ReaderCatalog`, con los dos idiomas que se afirman. */
const CATALOG = {
    locales: [{ code: 'en', label: 'English' }, { code: 'es', label: 'Español' }],
    labels: {
        en: {
            types: { glucose: 'Blood glucose', bloodPressure: 'Blood pressure', meal: 'Meals', insulin: 'Insulin', bodyWeight: 'Body weight', temperature: 'Temperature' },
            glucoseMethods: { capillary: 'Capillary blood' },
            mealContexts: { fasting: 'Fasting' },
            arms: { left: 'Left arm' },
            postures: { sitting: 'Sitting' },
            insulinTypes: { rapid: 'Rapid-acting' },
            injectionSites: { abdomen: 'Abdomen' },
            mealTypes: { lunch: 'Lunch' },
            temperatureSites: { oral: 'Mouth' },
            recordedBy: { self: 'The person themselves', caregiver: 'A caregiver' },
            foodUnits: { g: 'grams' },
        },
        es: {
            types: { glucose: 'Glucemia' },
            glucoseMethods: { capillary: 'Sangre capilar' },
            mealContexts: {},
            recordedBy: { self: 'La propia persona' },
        },
    },
    loinc: {
        '41653-7': 'Glucose [Mass/volume] in Capillary blood by Glucometer',
        '8480-6': 'Systolic blood pressure',
        '8462-4': 'Diastolic blood pressure',
        '8867-4': 'Heart rate',
    },
    units: { 'mg/dL': 'mg/dL', 'mm[Hg]': 'mmHg', '/min': 'bpm', Cel: '°C', '[iU]': 'IU', kg: 'kg', cm: 'cm' },
};

const EN = resolveCatalog(CATALOG, 'en');

/**
 * @param {string} type
 * @param {object} data
 * @param {object} [extra]
 * @returns {{occurredAt: string, content: object}}
 */
function event(type, data, extra = {}) {
    return {
        occurredAt: '2026-07-20T09:30:00.000000Z',
        content: { v: 1, type, tz: '+02:00', origin: 'manual', recordedBy: 'self', ...extra, data },
    };
}

// --- Vocabulario ---------------------------------------------------------------------------------

test('resolveCatalog: un idioma que el catálogo no trae cae al inglés y no deja la tabla en blanco', () => {
    assert.equal(resolveCatalog(CATALOG, 'zh_CN').labels.types.glucose, 'Blood glucose');
});

test('labelFor: un token desconocido se enseña tal cual, nunca se calla', () => {
    assert.equal(labelFor(EN, 'glucoseMethods', 'venous'), 'venous');
    assert.equal(labelFor(EN, 'glucoseMethods', undefined), null);
});

test('unitLabel: el código UCUM se enseña como se lee, no como se intercambia', () => {
    assert.equal(unitLabel(EN, 'Cel'), '°C');
    assert.equal(unitLabel(EN, '/min'), 'bpm');
    /** Un código que la tabla no conoce se enseña crudo antes que desaparecer. */
    assert.equal(unitLabel(EN, '[oz_av]'), '[oz_av]');
});

test('measurement: valor y unidad juntos, y el valor sin reformatear', () => {
    /**
     * El valor viaja como cadena dentro del sobre (ADR 0004) y aquí no se convierte: `7.8` es lo
     * que marcó el aparato, y reescribirlo como `7,8` por estar en castellano sería reinterpretar
     * una medida.
     */
    setLocale('es');
    assert.equal(measurement(EN, '7.8', 'mg/dL'), '7.8 mg/dL');
});

test('loincEntries: una cadena y un objeto de varias magnitudes salen con la misma forma', () => {
    assert.deepEqual(loincEntries(EN, '41653-7'), [
        { code: '41653-7', name: 'Glucose [Mass/volume] in Capillary blood by Glucometer' },
    ]);

    assert.deepEqual(
        loincEntries(EN, { systolic: '8480-6', diastolic: '8462-4' }).map((entry) => entry.code),
        ['8480-6', '8462-4'],
    );

    /** Un código que el catálogo no conoce se enseña sin término, nunca se omite. */
    assert.deepEqual(loincEntries(EN, '99999-9'), [{ code: '99999-9', name: null }]);
});

// --- Una fila por tipo ---------------------------------------------------------------------------

test('glucemia: valor con unidad, método, contexto y término LOINC', () => {
    const row = describeEvent(EN, event('glucose', {
        value: '112',
        unit: 'mg/dL',
        loinc: '41653-7',
        method: 'capillary',
        mealContext: 'fasting',
    }));

    assert.equal(row.typeLabel, 'Blood glucose');
    assert.equal(row.value, '112 mg/dL');
    assert.ok(row.details.includes('Capillary blood'));
    assert.ok(row.details.includes('Fasting'));
    assert.equal(row.loinc[0].name, 'Glucose [Mass/volume] in Capillary blood by Glucometer');
    assert.equal(row.unreadable, false);
});

test('tensión: sistólica/diastólica con unidad, pulso, brazo y postura', () => {
    const row = describeEvent(EN, event('bloodPressure', {
        systolic: '128',
        diastolic: '82',
        unit: 'mm[Hg]',
        pulse: '64',
        pulseUnit: '/min',
        loinc: { systolic: '8480-6', diastolic: '8462-4', pulse: '8867-4' },
        arm: 'left',
        posture: 'sitting',
    }));

    assert.equal(row.value, '128/82 mmHg');
    assert.ok(row.details.includes('Pulse 64 bpm'));
    assert.ok(row.details.includes('Left arm'));
    assert.equal(row.loinc.length, 3);
});

test('insulina: dosis con unidad, tipo, producto y zona', () => {
    const row = describeEvent(EN, event('insulin', {
        insulinType: 'rapid',
        dose: '6',
        unit: '[iU]',
        product: 'NovoRapid',
        site: 'abdomen',
    }));

    assert.equal(row.value, '6 IU');
    assert.deepEqual(row.details.slice(0, 3), ['Rapid-acting', 'NovoRapid', 'Abdomen']);
});

test('comida: tipo de comida y la lista de alimentos legible', () => {
    const row = describeEvent(EN, event('meal', {
        mealType: 'lunch',
        foods: [{ name: 'Rice', quantity: '80', unit: 'g' }],
    }));

    assert.equal(row.value, 'Lunch');
    assert.ok(row.details.includes('Rice · 80 grams'));
});

test('peso: valor con unidad y la estatura cuando la hay', () => {
    const row = describeEvent(EN, event('bodyWeight', {
        value: '71.4',
        unit: 'kg',
        loinc: '29463-7',
        height: { value: '172', unit: 'cm', loinc: '8302-2' },
    }));

    assert.equal(row.value, '71.4 kg');
    assert.ok(row.details.includes('Height 172 cm'));
});

test('temperatura: valor con unidad y sitio de medición', () => {
    const row = describeEvent(EN, event('temperature', { value: '37.2', unit: 'Cel', loinc: '8331-1', site: 'oral' }));

    assert.equal(row.value, '37.2 °C');
    assert.ok(row.details.includes('Mouth'));
});

/**
 * Quién apuntó el registro se dice siempre, también cuando es la propia persona: un dato apuntado
 * por quien cuida a alguien y uno apuntado por esa persona no valen lo mismo en consulta.
 */
test('cada fila dice quién lo apuntó y con qué aparato', () => {
    const row = describeEvent(EN, event(
        'glucose',
        { value: '90', unit: 'mg/dL', loinc: '41653-7', method: 'capillary' },
        { device: 'Accu-Chek', recordedBy: 'caregiver', note: 'Se encontraba mareada' },
    ));

    assert.ok(row.details.includes('Device: Accu-Chek'));
    assert.ok(row.details.includes('Recorded by: A caregiver'));
    assert.equal(row.note, 'Se encontraba mareada');
});

/**
 * Un registro con forma inesperada se pinta como fila de error y **nunca** se omite (ADR 0004): en
 * un recorte que va a leer otra persona, un registro que falta es indistinguible de un registro que
 * no existió, y esa diferencia es clínica.
 */
test('un evento ilegible sale como fila marcada, con su fecha, y no desaparece', () => {
    for (const broken of [event('glucose', null), event('unicornio', { value: '1' })]) {
        const row = describeEvent(EN, broken);

        assert.equal(row.unreadable, true);
        assert.equal(row.value, 'Unreadable record');
        assert.notEqual(row.occurredAtLabel, '');
    }
});

// --- Cabecera y orden ----------------------------------------------------------------------------

test('ordena de lo más reciente a lo más antiguo', () => {
    const sorted = sortByDateDescending([
        { occurredAt: '2026-07-01T10:00:00.000000Z' },
        { occurredAt: '2026-07-20T10:00:00.000000Z' },
        { occurredAt: '2026-07-10T10:00:00.000000Z' },
    ]);

    assert.deepEqual(sorted.map((entry) => entry.occurredAt.slice(0, 10)), ['2026-07-20', '2026-07-10', '2026-07-01']);
});

/**
 * La cabecera es lo que hace visible un recorte truncado: quien lee compara el número que anuncia
 * con las filas que tiene delante. Por eso el recuento sale **siempre**, también con cero eventos.
 */
test('la cabecera dice siempre cuántos, de cuándo a cuándo y cuándo se generó', () => {
    const headline = reportHeadline({
        eventCount: 0,
        events: [],
        range: { from: '2026-06-01T00:00:00.000000Z', to: '2026-07-01T00:00:00.000000Z' },
        generatedAt: '2026-07-20T08:00:00.000000Z',
    });

    assert.equal(headline.count, '0 records');
    assert.match(headline.range, /^Covering from /);
    assert.match(headline.generatedAt, /^Generated on /);
});

test('un rango abierto se dice con palabras, no con un hueco', () => {
    assert.equal(rangeText(null, null), 'Covering the whole history');
    assert.match(rangeText('2026-06-01T00:00:00.000000Z', null), /^Covering from /);
    assert.match(rangeText(null, '2026-07-01T00:00:00.000000Z'), /^Covering up to /);
});

/**
 * Los tipos excluidos se dicen en voz alta: una ausencia se lee como un cero clínico, y «no apunta
 * comidas» no es lo mismo que «no me las enseñó».
 */
test('la cabecera nombra los tipos incluidos y los excluidos', () => {
    const summary = typeSummary(EN, { includedTypes: ['glucose'], excludedTypes: ['meal', 'insulin'] });

    assert.equal(summary.included, 'Includes: Blood glucose');
    assert.match(summary.excluded, /Meals, Insulin$/);

    assert.equal(typeSummary(EN, { includedTypes: ['glucose'], excludedTypes: [] }).excluded, null);
});

test('el idioma del lector cambia las etiquetas pero nunca el término LOINC', () => {
    setLocale('es');

    const spanish = resolveCatalog(CATALOG, 'es');
    const row = describeEvent(spanish, event('glucose', {
        value: '112',
        unit: 'mg/dL',
        loinc: '41653-7',
        method: 'capillary',
    }));

    assert.equal(row.typeLabel, 'Glucemia');
    assert.ok(row.details.includes('Sangre capilar'));
    /** ADR 0005: el término oficial LOINC no se traduce. */
    assert.equal(row.loinc[0].name, 'Glucose [Mass/volume] in Capillary blood by Glucometer');
});
