/**
 * Checks of the pure logic of `health/insulinPage.js` (ADR 0004, ADR 0006).
 *
 * Neither Alpine nor Chart.js is mounted: `insulinPage()` only orchestrates DOM and external
 * libraries, and that orchestration is not tested here. What is tested is the logic that depends
 * on neither of the two, exported apart so it can be called directly (the same approach as
 * `tests/js/glucosePage.test.mjs`).
 *
 * Node's built-in runner, like the rest of `tests/js` (see `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNumericValue } from '../../resources/js/health/numericValue.js';
import { test } from 'node:test';

import {
    buildInsulinContent,
    filterInsulinEvents,
    groupInsulinByDay,
    injectionSiteLabel,
    INSULIN_UNIT,
    productLabel,
    summarizeDailyDoses,
} from '../../resources/js/health/insulinPage.js';
import { MAX_CHART_DAYS } from '../../resources/js/health/dailyBands.js';
import { datetimeLocalToCanonical, formatTzOffset } from '../../resources/js/health/datetimeLocal.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/**
 * These tests assert the text **in Spanish**, so they set the language instead of assuming it: the
 * client default language is English (as in `config/app.php`), and in Node there is no
 * `<html lang>` to work it out from. Without this line, the text assertions below would be
 * checking the fallback catalog without saying so.
 */
setLocale('es');

/**
 * Test common fields, with the shape `buildCommonEventFields` returns when no `origin` is passed:
 * always `manual`, because the insulin form does not ask for the origin of the datum (scope
 * correction of 2026-07-25).
 */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

test('INSULIN_UNIT is the UCUM code of the international unit, [iU]', () => {
    assert.equal(INSULIN_UNIT, '[iU]');
});

test('buildInsulinContent: exact ADR 0006 shape, with no LOINC code', () => {
    const content = buildInsulinContent({
        dose: '6',
        insulinType: 'rapid',
        product: 'NovoRapid',
        site: 'abdomen',
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.deepEqual(content, {
        v: 1,
        type: 'insulin',
        tz: '+02:00',
        origin: 'manual',
        recordedBy: 'self',
        data: {
            insulinType: 'rapid',
            dose: '6',
            unit: '[iU]',
            product: 'NovoRapid',
            site: 'abdomen',
        },
    });

    assert.equal('loinc' in content.data, false, 'la insulina no lleva código LOINC (ADR 0006)');
});

test('buildInsulinContent: the decimal dose travels as a string, never as a number (ADR 0004)', () => {
    const content = buildInsulinContent({
        dose: '0.5',
        insulinType: 'rapid',
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.dose, '0.5');
    assert.equal(typeof content.data.dose, 'string');
});

test('buildInsulinContent: product and site absent when they arrive empty or are not given', () => {
    const withEmptyStrings = buildInsulinContent({
        dose: '6',
        insulinType: 'long',
        product: '',
        site: '',
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.equal('product' in withEmptyStrings.data, false);
    assert.equal('site' in withEmptyStrings.data, false);

    const withoutFields = buildInsulinContent({
        dose: '6',
        insulinType: 'long',
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.equal('product' in withoutFields.data, false);
    assert.equal('site' in withoutFields.data, false);
});

test('buildInsulinContent: a product with extra spaces is trimmed', () => {
    const content = buildInsulinContent({
        dose: '6',
        insulinType: 'mixed',
        product: '  Humalog Mix 25  ',
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.product, 'Humalog Mix 25');
});

test('buildInsulinContent: the common fields go at the top level, never inside data', () => {
    const content = buildInsulinContent({
        dose: '6',
        insulinType: 'rapid',
        tz: '+02:00',
        common: { origin: 'manual', recordedBy: 'caregiver', device: 'NovoPen', note: 'Nota libre' },
    });

    assert.equal(content.origin, 'manual');
    assert.equal(content.recordedBy, 'caregiver');
    assert.equal(content.device, 'NovoPen');
    assert.equal(content.note, 'Nota libre');

    assert.equal('origin' in content.data, false);
    assert.equal('recordedBy' in content.data, false);
    assert.equal('device' in content.data, false);
    assert.equal('note' in content.data, false);
});

test('buildInsulinContent: with no dose, it throws instead of storing something half done', () => {
    assert.throws(() => buildInsulinContent({
        dose: '   ',
        insulinType: 'rapid',
        tz: '+02:00',
        common: COMMON_FIELDS,
    }));
});

test('buildInsulinContent: with no insulin type, it throws instead of guessing one', () => {
    assert.throws(() => buildInsulinContent({
        dose: '6',
        insulinType: '',
        tz: '+02:00',
        common: COMMON_FIELDS,
    }));

    assert.throws(() => buildInsulinContent({
        dose: '6',
        tz: '+02:00',
        common: COMMON_FIELDS,
    }));
});

test('injectionSiteLabel: tolerates an event with no site and invents nothing', () => {
    const catalog = { injectionSites: [{ token: 'abdomen', label: 'Abdomen' }] };

    assert.equal(injectionSiteLabel(catalog, {}), null);
    assert.equal(injectionSiteLabel(catalog, { site: '' }), null);
    assert.equal(injectionSiteLabel(catalog, { site: 'abdomen' }), 'Abdomen');
    assert.equal(injectionSiteLabel(catalog, { site: 'unknown' }), 'unknown');
});

test('productLabel: tolerates an event with no product and invents nothing', () => {
    assert.equal(productLabel({}), null);
    assert.equal(productLabel({ product: '' }), null);
    assert.equal(productLabel({ product: 'Lantus' }), 'Lantus');
});

test('filterInsulinEvents: discards events of another type', () => {
    const events = [
        { id: '1', occurredAt: '2026-07-25T08:00:00.000000Z', content: { type: 'insulin' } },
        { id: '2', occurredAt: '2026-07-25T08:05:00.000000Z', content: { type: 'glucose' } },
    ];

    const result = filterInsulinEvents(events);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
});

test('groupInsulinByDay: adds up the dose per day and type, and tolerates decimals', () => {
    const events = [
        {
            id: '1',
            occurredAt: '2026-07-25T08:00:00.000000Z',
            content: { data: { insulinType: 'rapid', dose: '6' } },
        },
        {
            id: '2',
            occurredAt: '2026-07-25T20:00:00.000000Z',
            content: { data: { insulinType: 'rapid', dose: '0.5' } },
        },
        {
            id: '3',
            occurredAt: '2026-07-25T22:00:00.000000Z',
            content: { data: { insulinType: 'long', dose: '10' } },
        },
        {
            id: '4',
            occurredAt: '2026-07-26T08:00:00.000000Z',
            content: { data: { insulinType: 'rapid', dose: '7' } },
        },
    ];

    const { days, totalsByType } = groupInsulinByDay(events);

    assert.deepEqual(days, ['2026-07-25', '2026-07-26']);
    assert.deepEqual(totalsByType.rapid, [6.5, 7]);
    assert.deepEqual(totalsByType.long, [10, 0]);
});

test('groupInsulinByDay: the axis covers the whole stretch, so a break in the therapy is seen', () => {
    /** Injections on the 1st, the 2nd and the 20th: eighteen days of nothing in between. */
    const events = ['2026-03-01', '2026-03-02', '2026-03-20'].map((day, index) => ({
        id: String(index),
        occurredAt: `${day}T08:00:00.000000Z`,
        content: { data: { insulinType: 'rapid', dose: '6' }, tz: '+00:00' },
    }));

    const { days, totalsByType, omittedDays } = groupInsulinByDay(events);

    /** Twenty days on the axis, not three bars stuck together. */
    assert.equal(days.length, 20);
    assert.equal(days[0], '2026-03-01');
    assert.equal(days[19], '2026-03-20');
    assert.equal(omittedDays, 0);

    /** The days with no injection are a gap, never a zero: a zero would say the dose was nil. */
    assert.deepEqual(totalsByType.rapid.slice(0, 3), [6, 6, null]);
    assert.equal(totalsByType.rapid[19], 6);
    assert.equal(totalsByType.rapid.filter((dose) => dose === null).length, 17);
});

test('groupInsulinByDay: inside a day with records, a type not injected is a zero and not a gap', () => {
    const events = [
        {
            id: '1',
            occurredAt: '2026-03-01T08:00:00.000000Z',
            content: { data: { insulinType: 'rapid', dose: '6' }, tz: '+00:00' },
        },
        {
            id: '2',
            occurredAt: '2026-03-02T08:00:00.000000Z',
            content: { data: { insulinType: 'long', dose: '10' }, tz: '+00:00' },
        },
    ];

    const { totalsByType } = groupInsulinByDay(events);

    assert.deepEqual(totalsByType.rapid, [6, 0]);
    assert.deepEqual(totalsByType.long, [0, 10]);
});

test('groupInsulinByDay: a very long stretch is clipped and says how much it left out', () => {
    const events = [
        {
            id: '1',
            occurredAt: '2024-01-01T08:00:00.000000Z',
            content: { data: { insulinType: 'rapid', dose: '6' }, tz: '+00:00' },
        },
        {
            id: '2',
            occurredAt: '2026-01-01T08:00:00.000000Z',
            content: { data: { insulinType: 'rapid', dose: '6' }, tz: '+00:00' },
        },
    ];

    const { days, omittedDays } = groupInsulinByDay(events);

    assert.equal(days.length, MAX_CHART_DAYS);
    /** The most recent ones are kept: the stretch being looked at is the one at the end. */
    assert.equal(days[days.length - 1], '2026-01-01');
    assert.ok(omittedDays > 0);
});

test('groupInsulinByDay: the day is the one of the zone it was recorded in, not the browser one', () => {
    const events = [{
        id: '1',
        /** 23:30 in Madrid on the 4th, which is 21:30 UTC: it belongs to the 4th, not the 5th. */
        occurredAt: '2026-03-04T21:30:00.000000Z',
        content: { data: { insulinType: 'rapid', dose: '6' }, tz: '+02:00' },
    }];

    assert.deepEqual(groupInsulinByDay(events).days, ['2026-03-04']);
});

test('groupInsulinByDay: with no events, there are no days and no series', () => {
    const { days, totalsByType } = groupInsulinByDay([]);

    assert.deepEqual(days, []);
    assert.deepEqual(totalsByType, {});
});

test('formatTzOffset: sign and padding to two digits', () => {
    assert.equal(formatTzOffset(120), '+02:00');
    assert.equal(formatTzOffset(-300), '-05:00');
    assert.equal(formatTzOffset(0), '+00:00');
});

test('datetimeLocalToCanonical: converts with an explicit offset, without depending on the local time zone', () => {
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-07-25T09:30:00', { timezoneOffsetMinutes: -120 });

    assert.equal(occurredAt, '2026-07-25T07:30:00.000000Z');
    assert.equal(tz, '+02:00');
});

test('the dose goes through the numeric validation: comma normalized to a dot and decimal limit', () => {
    const content = buildInsulinContent({
        dose: parseNumericValue('7,85', 'La dosis'),
        insulinType: 'rapid',
        tz: '+02:00',
        common: { origin: 'manual', recordedBy: 'self' },
    });

    assert.strictEqual(content.data.dose, '7.85');
    assert.strictEqual(typeof content.data.dose, 'string');

    assert.throws(() => parseNumericValue('7,855', 'La dosis'), /decimales/);
    assert.throws(() => parseNumericValue('-1', 'La dosis'), /negativ/);
});

test('summarizeDailyDoses: with no days, it explains what will appear here instead of leaving the caption blank', () => {
    const caption = summarizeDailyDoses([], {}, (type) => type);

    assert.match(caption, /Aquí aparecerá la dosis total de cada día/);
});

test('summarizeDailyDoses: it states in text the types and their accumulated dose (DESIGN.md Do\'s #3)', () => {
    const caption = summarizeDailyDoses(
        ['2026-07-25', '2026-07-26'],
        { rapid: [6.5, 7], long: [10, 0] },
        (type) => ({ rapid: 'Rápida', long: 'Lenta' })[type] ?? type,
    );

    assert.match(caption, /2 días con registro/);
    assert.match(caption, /Rápida: 13\.5 \[iU\]/);
    assert.match(caption, /Lenta: 10 \[iU\]/);
});

/**
 * DOM contract between `insulin.blade.php` and `insulinPage.js`.
 *
 * A `this.$refs.whatever` the template does not declare is `undefined` and blows up on press, with
 * no warning beforehand; an `x-ref` declared and read by nobody is dead weight pretending a
 * contract that does not exist. The browser catches neither, so this test does: both sets have to
 * match exactly.
 */
test('DOM contract: the x-ref of the template and the $refs of the module match exactly', () => {
    const template = readFileSync(new URL('../../resources/views/phr/pages/insulin.blade.php', import.meta.url), 'utf8');
    const module = readFileSync(new URL('../../resources/js/health/insulinPage.js', import.meta.url), 'utf8');

    const declared = new Set([...template.matchAll(/x-ref="([a-zA-Z]+)"/g)].map((match) => match[1]));
    const used = new Set([...module.matchAll(/\$refs\.([a-zA-Z]+)/g)].map((match) => match[1]));

    assert.deepEqual(
        [...used].filter((ref) => !declared.has(ref)),
        [],
        'hay $refs que la plantilla no declara: serían undefined en tiempo de ejecución',
    );

    assert.deepEqual(
        [...declared].filter((ref) => !used.has(ref)),
        [],
        'hay x-ref declarados que nadie lee: sobran',
    );
});

/**
 * Contract with the server, the half that can be checked without PHP: which methods the module
 * calls. That they really exist in `App\Filament\Pages\Insulin` is checked by
 * `tests/Feature/InsulinPageTest.php`, which can look at the class by reflection.
 */
test('contract with the server: the module only calls storeEvent and fetchEvents', () => {
    const module = readFileSync(new URL('../../resources/js/health/insulinPage.js', import.meta.url), 'utf8');

    const called = [...new Set([...module.matchAll(/\$wire\.([a-zA-Z]+)/g)].map((match) => match[1]))].sort();

    assert.deepEqual(called, ['fetchEvents', 'storeEvent']);
});

test('summarizeDailyDoses: it counts the days WITH records, not the days on the axis', () => {
    /** Twenty days of axis, three with an injection: saying "20 days with records" would be false. */
    const days = Array.from({ length: 20 }, (unused, index) => `2026-03-${String(index + 1).padStart(2, '0')}`);
    const doses = days.map((unused, index) => ([0, 1, 19].includes(index) ? 6 : null));

    const caption = summarizeDailyDoses(days, { rapid: doses }, (type) => type);

    assert.match(caption, /3 días con registro/);
    /** The gaps do not add to the total either: they are not zeros. */
    assert.match(caption, /rapid: 18 \[iU\]/);
});

test('summarizeDailyDoses: a silent clip would read as "there was nothing before", so it is stated', () => {
    const withoutClip = summarizeDailyDoses(['2026-03-01'], { rapid: [6] }, (type) => type);
    const withClip = summarizeDailyDoses(['2026-03-01'], { rapid: [6] }, (type) => type, 12);

    assert.notEqual(withClip, withoutClip);
    assert.match(withClip, /12/);
});
