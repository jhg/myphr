/**
 * Checks of the pure logic of `health/mealsPage.js` (ADR 0004, ADR 0006).
 *
 * Alpine is not mounted: `mealsPage()` only orchestrates DOM, and that orchestration is not tested
 * here. What is tested is the logic that does not depend on the browser, exported apart so it can
 * be called directly (the same approach as `tests/js/glucosePage.test.mjs`).
 *
 * Node's built-in runner, like the rest of `tests/js` (see `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildMealContent,
    describeMealEvent,
    filterMealEvents,
    normalizeFoods,
} from '../../resources/js/health/mealsPage.js';
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
 * always `manual`, because the meals form does not ask for the origin of the datum.
 */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

/** Test catalog, with the shape `Meals::catalog()` returns (ADR 0005). */
const CATALOG = Object.freeze({
    mealTypes: [
        { token: 'breakfast', label: 'Desayuno' },
        { token: 'lunch', label: 'Comida' },
    ],
    units: [
        { code: 'g', label: 'gramos (g)' },
        { code: 'mL', label: 'mililitros (mL)' },
    ],
});

test('buildMealContent: exact ADR 0006 shape, with the foods in DOM order', () => {
    const content = buildMealContent({
        mealType: 'lunch',
        rawFoods: [
            { name: 'Arroz', quantity: '150', unit: 'g' },
            { name: 'Caldo', quantity: '200', unit: 'mL' },
        ],
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.deepEqual(content, {
        v: 1,
        type: 'meal',
        tz: '+02:00',
        origin: 'manual',
        recordedBy: 'self',
        data: {
            mealType: 'lunch',
            foods: [
                { name: 'Arroz', quantity: '150', unit: 'g' },
                { name: 'Caldo', quantity: '200', unit: 'mL' },
            ],
        },
    });
});

test('buildMealContent: with no meal type it is an error, not a default value', () => {
    assert.throws(
        () => buildMealContent({ mealType: '', rawFoods: [], tz: '+02:00', common: COMMON_FIELDS }),
        /tipo de comida/
    );
});

test('normalizeFoods: the blank row the form starts with does not count as a food', () => {
    assert.deepEqual(normalizeFoods([{ name: '', quantity: '', unit: '' }]), []);
    assert.deepEqual(normalizeFoods([{ name: '  ', quantity: ' ', unit: '' }]), []);
});

test('normalizeFoods: a half-filled row is an error, never an incomplete food stored', () => {
    assert.throws(() => normalizeFoods([{ name: 'Arroz', quantity: '', unit: 'g' }]), /Completa el nombre/);
    assert.throws(() => normalizeFoods([{ name: '', quantity: '150', unit: 'g' }]), /Completa el nombre/);
});

/**
 * The quantity is a clinical numeric field: it goes through `numericValue.js` like the glucose
 * value or the insulin dose (convention of `.ai/guidelines/ai.md`). Without this, "250,5" and
 * "250.5" would be stored as two different strings inside an already encrypted envelope.
 */
test('normalizeFoods: the decimal comma is normalized to a dot and the value is still a string (ADR 0004)', () => {
    const foods = normalizeFoods([{ name: 'Yogur', quantity: '125,5', unit: 'g' }]);

    assert.deepEqual(foods, [{ name: 'Yogur', quantity: '125.5', unit: 'g' }]);
    assert.equal(typeof foods[0].quantity, 'string');
});

test('normalizeFoods: rejects negative, non-numeric and more-than-2-decimal quantities', () => {
    assert.throws(() => normalizeFoods([{ name: 'Arroz', quantity: '-1', unit: 'g' }]), /negativ/);
    assert.throws(() => normalizeFoods([{ name: 'Arroz', quantity: 'mucho', unit: 'g' }]), /número/);
    assert.throws(() => normalizeFoods([{ name: 'Arroz', quantity: '1.234', unit: 'g' }]), /2 decimales/);
});

test('buildMealContent: it normalizes the quantity of each food before encrypting', () => {
    const content = buildMealContent({
        mealType: 'breakfast',
        rawFoods: [
            { name: '', quantity: '', unit: '' },
            { name: 'Leche', quantity: '200,25', unit: 'mL' },
        ],
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.deepEqual(content.data.foods, [{ name: 'Leche', quantity: '200.25', unit: 'mL' }]);
});

test('filterMealEvents: discards whatever is not a meal (the server cannot filter, ADR 0006)', () => {
    const events = [
        { id: '1', occurredAt: 'a', content: { type: 'meal' } },
        { id: '2', occurredAt: 'b', content: { type: 'glucose' } },
        { id: '3', occurredAt: 'c', content: null },
        { id: '4', occurredAt: 'd', content: { type: 'meal' } },
    ];

    assert.deepEqual(filterMealEvents(events).map((event) => event.id), ['1', '4']);
});

test('describeMealEvent: translates tokens into catalog labels and leaves out an absent note and device', () => {
    const described = describeMealEvent(CATALOG, {
        type: 'meal',
        data: { mealType: 'lunch', foods: [{ name: 'Arroz', quantity: '150', unit: 'g' }] },
    });

    assert.deepEqual(described, {
        mealTypeLabel: 'Comida',
        foods: [{ name: 'Arroz', quantity: '150', unitLabel: 'gramos (g)' }],
        note: null,
        device: null,
    });
});

test('describeMealEvent: a token no longer in the catalog is shown as is, without breaking the view', () => {
    const described = describeMealEvent(CATALOG, {
        data: { mealType: 'brunch', foods: [{ name: 'Café', quantity: '1', unit: '[cup_us]' }] },
    });

    assert.equal(described.mealTypeLabel, 'brunch');
    assert.equal(described.foods[0].unitLabel, '[cup_us]');
});

/**
 * An envelope that opens but whose content does not have the expected shape cannot leave the
 * whole history blank: whatever there is gets painted, just as an envelope that does not open.
 */
test('describeMealEvent: tolerates content with no `data` and no food list', () => {
    assert.deepEqual(describeMealEvent(CATALOG, { type: 'meal' }), {
        mealTypeLabel: '',
        foods: [],
        note: null,
        device: null,
    });

    assert.deepEqual(describeMealEvent(CATALOG, { data: { mealType: 'lunch' } }).foods, []);
});

test('describeMealEvent: keeps the note and the device when there are any', () => {
    const described = describeMealEvent(CATALOG, {
        data: { mealType: 'lunch', foods: [] },
        note: 'Comí fuera',
        device: 'Báscula',
    });

    assert.equal(described.note, 'Comí fuera');
    assert.equal(described.device, 'Báscula');
});

test('formatTzOffset: positive sign when local time is ahead of UTC (ADR 0006)', () => {
    assert.equal(formatTzOffset(120), '+02:00');
    assert.equal(formatTzOffset(-330), '-05:30');
    assert.equal(formatTzOffset(0), '+00:00');
});

test('datetimeLocalToCanonical: ADR 0004 canonical form and a coherent offset', () => {
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-07-25T14:30:05', { timezoneOffsetMinutes: -120 });

    assert.equal(occurredAt, '2026-07-25T12:30:05.000000Z');
    assert.equal(tz, '+02:00');
});
