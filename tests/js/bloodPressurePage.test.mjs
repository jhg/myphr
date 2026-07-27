/**
 * Checks of the pure logic of `health/bloodPressurePage.js` (ADR 0004, ADR 0006, ADR 0008).
 *
 * Neither Alpine nor Chart.js is mounted: `bloodPressurePage()` only orchestrates DOM and external
 * libraries, and that orchestration is not tested here. What is tested is the logic that depends
 * on neither of the two, exported apart so it can be called directly. Same approach as
 * `tests/js/glucosePage.test.mjs`.
 *
 * Node's built-in runner, like the rest of `tests/js` (see `crypto.test.mjs`).
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

/** Test common fields, with the shape `buildCommonEventFields` returns (ADR 0006). */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

/** Test catalog, with the shape `BloodPressure::catalog()` returns (ADR 0005, ADR 0008). */
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

test('buildBloodPressureContent: exact ADR 0006 shape, with a pulse', () => {
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

test('buildBloodPressureContent: the three values travel as strings, never as numbers (ADR 0004)', () => {
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

test('buildBloodPressureContent: the three values reaching the payload are always strings with a dot, after going through parseNumericValue (client numeric criterion)', () => {
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

test('buildBloodPressureContent: with an absent pulse, neither pulse, pulseUnit nor loinc.pulse go in', () => {
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

test('buildBloodPressureContent: the common fields go at the top level, never inside data', () => {
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

test('buildBloodPressureContent: with no systolic, diastolic, arm or posture, it throws instead of storing something half done', () => {
    const base = { tz: '+02:00', catalog: CATALOG, common: COMMON_FIELDS };

    assert.throws(() => buildBloodPressureContent({ ...base, systolic: '', diastolic: '80', arm: 'left', posture: 'sitting' }));
    assert.throws(() => buildBloodPressureContent({ ...base, systolic: '120', diastolic: '  ', arm: 'left', posture: 'sitting' }));
    assert.throws(() => buildBloodPressureContent({ ...base, systolic: '120', diastolic: '80', arm: '', posture: 'sitting' }));
    assert.throws(() => buildBloodPressureContent({ ...base, systolic: '120', diastolic: '80', arm: 'left', posture: '' }));
});

test('buildBloodPressureContent: the three LOINC codes are the ones of the catalog, not invented', () => {
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

test('methodKey: joins arm and posture into a single stable key', () => {
    assert.equal(methodKey('left', 'sitting'), 'left_sitting');
    assert.equal(methodKey('right', 'standing'), 'right_standing');
});

test('methodLabel: resolves the catalog label for arm and posture', () => {
    assert.equal(methodLabel(CATALOG, 'left', 'sitting'), 'Izquierdo, Sentado');
    assert.equal(methodLabel(CATALOG, 'right', 'standing'), 'Derecho, De pie');
});

test('filterBloodPressureEvents: discards the events that are not of type bloodPressure', () => {
    const events = [
        { id: '1', occurredAt: 'a', content: { type: 'bloodPressure', data: {} } },
        { id: '2', occurredAt: 'b', content: { type: 'glucose', data: {} } },
        { id: '3', occurredAt: 'c', content: { type: 'meal', data: {} } },
        { id: '4', occurredAt: 'd', content: { type: 'bloodPressure', data: {} } },
    ];

    const filtered = filterBloodPressureEvents(events);

    assert.deepEqual(filtered.map((event) => event.id), ['1', '4']);
});

test('groupBloodPressureByMethod: separates systolic and diastolic by method (arm + posture), sorted', () => {
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

test('groupBloodPressureByMethod: it does not mix different arms or postures into one series (ADR 0008)', () => {
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

test('groupPulseByMethod: groups the pulse by method and counts the records with no pulse', () => {
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

test('groupPulseByMethod: tolerates an event with no pulse and does not count it as a zero', () => {
    const events = [
        bloodPressureEvent({ occurredAt: '2026-07-25T09:00:00.000000Z', systolic: '120', diastolic: '80', arm: 'left', posture: 'sitting' }),
    ];

    const { seriesByMethod, missingPulseCount } = groupPulseByMethod(events);

    assert.deepEqual(seriesByMethod, {});
    assert.equal(missingPulseCount, 1);
});

test('formatTzOffset: positive sign when local time is ahead of UTC', () => {
    assert.equal(formatTzOffset(120), '+02:00');
    assert.equal(formatTzOffset(-300), '-05:00');
    assert.equal(formatTzOffset(0), '+00:00');
});

test('datetimeLocalToCanonical: correct instant with a positive offset (Madrid, +02:00)', () => {
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-07-25T14:30:00', {
        timezoneOffsetMinutes: -120,
    });

    assert.equal(occurredAt, '2026-07-25T12:30:00.000000Z');
    assert.equal(tz, '+02:00');
});

test('datetimeLocalToCanonical: accepts a datetime-local with no seconds', () => {
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
 * Contract of the method key (ADR 0008). `methodKey` and `splitMethodKey` have to be exact
 * inverses: the chart and the captions group by that key and then undo it to label. If the split
 * were done on every separator and not on the first one, a composite token would give three pieces
 * and the label would come out wrong, in silence.
 */
test('splitMethodKey undoes methodKey', () => {
    assert.deepEqual(splitMethodKey(methodKey('left', 'sitting')), ['left', 'sitting']);
    assert.deepEqual(splitMethodKey(methodKey('right', 'standing')), ['right', 'standing']);
});

test('splitMethodKey splits on the first separator, not on every one', () => {
    assert.deepEqual(splitMethodKey(methodKey('left', 'semi_recumbent')), ['left', 'semi_recumbent']);
    assert.equal(methodLabel(CATALOG, ...splitMethodKey(methodKey('left', 'sitting'))), 'Izquierdo, Sentado');
});

test('splitMethodKey tolerates a key with no separator instead of blowing up', () => {
    assert.deepEqual(splitMethodKey('left'), ['left', '']);
});

/*
 * An envelope of another screen cannot slip into the blood pressure history or into the charts:
 * the server cannot filter by type because it travels encrypted (ADR 0006), so the client filter
 * is all there is.
 */
test('filterBloodPressureEvents leaves out an event with no decrypted content', () => {
    const filtered = filterBloodPressureEvents([
        { id: '1', occurredAt: '2026-07-25T10:00:00.000000Z', content: null },
        { id: '2', occurredAt: '2026-07-25T11:00:00.000000Z', content: { type: 'bloodPressure', data: {} } },
    ]);

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, '2');
});

/*
 * State with no data: neither grouping can invent a series or a zero. A zero in a blood pressure
 * chart reads as a real measurement.
 */
test('with no events, no grouping produces series or zeros', () => {
    assert.deepEqual(groupBloodPressureByMethod([]), {});
    assert.deepEqual(groupPulseByMethod([]), { seriesByMethod: {}, missingPulseCount: 0 });
});

/*
 * The pulse is optional (ADR 0006). If it is not typed, it cannot appear as an empty string or as
 * a zero in the encrypted content: absence has to mean absence.
 */
test('buildBloodPressureContent leaves out pulse, pulseUnit and loinc.pulse when no pulse is given', () => {
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

test('groupBloodPressureByMethod: the axis instant keeps the burst apart from the loose reading', () => {
    /**
     * Three readings of one same morning and one from a month before. Evenly spaced, the burst
     * —which is what makes those three one single measurement— looked like four loose readings.
     */
    const events = [
        '2026-02-25T08:00:00.000000Z',
        '2026-03-25T08:00:00.000000Z',
        '2026-03-25T08:02:00.000000Z',
        '2026-03-25T08:04:00.000000Z',
    ].map((occurredAt) => bloodPressureEvent({
        occurredAt,
        systolic: '128',
        diastolic: '82',
        arm: 'left',
        posture: 'sitting',
    }));

    const { systolic } = groupBloodPressureByMethod(events).left_sitting;
    const gaps = systolic.slice(1).map((point, index) => point.x - systolic[index].x);

    assert.equal(gaps[0], 28 * 86_400_000);
    assert.deepEqual(gaps.slice(1), [120_000, 120_000]);
});

test('groupBloodPressureByMethod: the instant is the wall clock of the event, not the browser one', () => {
    const event = bloodPressureEvent({
        /** 08:00 in Madrid, which is 06:00 UTC: on the axis it has to sit at 08:00. */
        occurredAt: '2026-03-25T06:00:00.000000Z',
        systolic: '128',
        diastolic: '82',
        arm: 'left',
        posture: 'sitting',
    });

    event.content.tz = '+02:00';

    const { systolic } = groupBloodPressureByMethod([event]).left_sitting;

    assert.equal(new Date(systolic[0].x).getUTCHours(), 8);
});

test('groupPulseByMethod: the pulse travels on the same instant as the pressure it came with', () => {
    const event = bloodPressureEvent({
        occurredAt: '2026-03-25T06:00:00.000000Z',
        systolic: '128',
        diastolic: '82',
        arm: 'left',
        posture: 'sitting',
        pulse: '70',
    });

    event.content.tz = '+02:00';

    const { systolic } = groupBloodPressureByMethod([event]).left_sitting;
    const { seriesByMethod } = groupPulseByMethod([event]);

    assert.equal(seriesByMethod.left_sitting[0].x, systolic[0].x);
});
