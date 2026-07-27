/**
 * Clinical reading of a clipping (`resources/js/reader/clinicalReport.js`, ADR 0011).
 *
 * What these tests fix is not the look of the table, but what a professional needs so as not to
 * misread a datum: value **with** unit, measurement method, untranslated LOINC term, and no row
 * disappearing in silence.
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

/** Slice of the catalog `App\Sharing\ReaderCatalog` emits, with the two languages asserted here. */
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

// --- Vocabulary ----------------------------------------------------------------------------------

test('resolveCatalog: a language the catalog does not bring falls back to English and does not leave the table blank', () => {
    assert.equal(resolveCatalog(CATALOG, 'zh_CN').labels.types.glucose, 'Blood glucose');
});

test('labelFor: an unknown token is shown as is, it is never hidden', () => {
    assert.equal(labelFor(EN, 'glucoseMethods', 'venous'), 'venous');
    assert.equal(labelFor(EN, 'glucoseMethods', undefined), null);
});

test('unitLabel: the UCUM code is shown as it is read, not as it is interchanged', () => {
    assert.equal(unitLabel(EN, 'Cel'), '°C');
    assert.equal(unitLabel(EN, '/min'), 'bpm');
    /** A code the table does not know is shown raw rather than disappearing. */
    assert.equal(unitLabel(EN, '[oz_av]'), '[oz_av]');
});

test('measurement: value and unit together, and the value unformatted', () => {
    /**
     * The value travels as a string inside the envelope (ADR 0004) and it is not converted here:
     * `7.8` is what the device showed, and rewriting it as `7,8` because the language is Spanish
     * would be reinterpreting a measurement.
     */
    setLocale('es');
    assert.equal(measurement(EN, '7.8', 'mg/dL'), '7.8 mg/dL');
});

test('loincEntries: a string and an object of several quantities come out in the same shape', () => {
    assert.deepEqual(loincEntries(EN, '41653-7'), [
        { code: '41653-7', name: 'Glucose [Mass/volume] in Capillary blood by Glucometer' },
    ]);

    assert.deepEqual(
        loincEntries(EN, { systolic: '8480-6', diastolic: '8462-4' }).map((entry) => entry.code),
        ['8480-6', '8462-4'],
    );

    /** A code the catalog does not know is shown with no term, it is never left out. */
    assert.deepEqual(loincEntries(EN, '99999-9'), [{ code: '99999-9', name: null }]);
});

// --- One row per type ------------------------------------------------------------------------------

test('glucose: value with unit, method, context and LOINC term', () => {
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

test('blood pressure: systolic/diastolic with unit, pulse, arm and posture', () => {
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

test('insulin: dose with unit, type, product and site', () => {
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

test('meal: meal type and the readable food list', () => {
    const row = describeEvent(EN, event('meal', {
        mealType: 'lunch',
        foods: [{ name: 'Rice', quantity: '80', unit: 'g' }],
    }));

    assert.equal(row.value, 'Lunch');
    assert.ok(row.details.includes('Rice · 80 grams'));
});

test('weight: value with unit and the height when there is one', () => {
    const row = describeEvent(EN, event('bodyWeight', {
        value: '71.4',
        unit: 'kg',
        loinc: '29463-7',
        height: { value: '172', unit: 'cm', loinc: '8302-2' },
    }));

    assert.equal(row.value, '71.4 kg');
    assert.ok(row.details.includes('Height 172 cm'));
});

test('temperature: value with unit and measurement site', () => {
    const row = describeEvent(EN, event('temperature', { value: '37.2', unit: 'Cel', loinc: '8331-1', site: 'oral' }));

    assert.equal(row.value, '37.2 °C');
    assert.ok(row.details.includes('Mouth'));
});

/**
 * Who wrote the record down is always said, including when it is the person themselves: a datum
 * written by a carer and one written by that person are not worth the same in an appointment.
 */
test('every row says who wrote it down and with which device', () => {
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
 * A record with an unexpected shape is painted as an error row and is **never** left out (ADR
 * 0004): in a clipping somebody else is going to read, a missing record is indistinguishable from
 * a record that never existed, and that difference is clinical.
 */
test('an unreadable event comes out as a flagged row, with its date, and does not disappear', () => {
    for (const broken of [event('glucose', null), event('unicornio', { value: '1' })]) {
        const row = describeEvent(EN, broken);

        assert.equal(row.unreadable, true);
        assert.equal(row.value, 'Unreadable record');
        assert.notEqual(row.occurredAtLabel, '');
    }
});

// --- Header and order ------------------------------------------------------------------------------

test('it sorts from the most recent to the oldest', () => {
    const sorted = sortByDateDescending([
        { occurredAt: '2026-07-01T10:00:00.000000Z' },
        { occurredAt: '2026-07-20T10:00:00.000000Z' },
        { occurredAt: '2026-07-10T10:00:00.000000Z' },
    ]);

    assert.deepEqual(sorted.map((entry) => entry.occurredAt.slice(0, 10)), ['2026-07-20', '2026-07-10', '2026-07-01']);
});

/**
 * The header is what makes a truncated clipping visible: the reader compares the number it
 * announces with the rows in front of them. So the count comes out **always**, even with zero events.
 */
test('the header always says how many, from when to when and when it was generated', () => {
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

test('an open range is said with words, not with a gap', () => {
    assert.equal(rangeText(null, null), 'Covering the whole history');
    assert.match(rangeText('2026-06-01T00:00:00.000000Z', null), /^Covering from /);
    assert.match(rangeText(null, '2026-07-01T00:00:00.000000Z'), /^Covering up to /);
});

/**
 * The excluded types are said out loud: an absence reads as a clinical zero, and "they do not
 * record meals" is not the same as "they did not show me any".
 */
test('the header names the included and the excluded types', () => {
    const summary = typeSummary(EN, { includedTypes: ['glucose'], excludedTypes: ['meal', 'insulin'] });

    assert.equal(summary.included, 'Includes: Blood glucose');
    assert.match(summary.excluded, /Meals, Insulin$/);

    assert.equal(typeSummary(EN, { includedTypes: ['glucose'], excludedTypes: [] }).excluded, null);
});

test('the reader language changes the labels but never the LOINC term', () => {
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
    /** ADR 0005: the official LOINC term is not translated. */
    assert.equal(row.loinc[0].name, 'Glucose [Mass/volume] in Capillary blood by Glucometer');
});
