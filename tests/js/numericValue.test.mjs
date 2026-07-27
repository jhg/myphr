/**
 * Checks of `health/numericValue.js`: the numeric validation shared by every clinical event
 * screen (glucose, blood pressure, ...).
 *
 * Node's built-in runner, like the rest of `tests/js` (see `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeDecimalSeparator, parseNumericValue } from '../../resources/js/health/numericValue.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/**
 * These tests assert the text **in Spanish**, so they set the language instead of assuming it: the
 * client default language is English (as in `config/app.php`), and in Node there is no
 * `<html lang>` to work it out from. Without this line, the text assertions below would be
 * checking the fallback catalog without saying so.
 */
setLocale('es');

test('normalizeDecimalSeparator: replaces the decimal comma with a dot', () => {
    assert.equal(normalizeDecimalSeparator('7,8'), '7.8');
    assert.equal(normalizeDecimalSeparator('142'), '142');
    assert.equal(normalizeDecimalSeparator('7.8'), '7.8');
});

test('parseNumericValue: accepts integers', () => {
    assert.equal(parseNumericValue('142', 'El valor'), '142');
    assert.equal(parseNumericValue('0', 'El valor'), '0');
});

test('parseNumericValue: accepts 1 and 2 decimals', () => {
    assert.equal(parseNumericValue('7.5', 'El valor'), '7.5');
    assert.equal(parseNumericValue('7.85', 'El valor'), '7.85');
});

test('parseNumericValue: normalizes the comma to a dot', () => {
    assert.equal(parseNumericValue('7,8', 'El valor'), '7.8');
    assert.equal(parseNumericValue('  7,85  ', 'El valor'), '7.85');
});

test('parseNumericValue: rejects 3 or more decimals', () => {
    assert.throws(() => parseNumericValue('7.855', 'El valor'), /2 decimales/);
    assert.throws(() => parseNumericValue('7,855', 'El valor'), /2 decimales/);
});

test('parseNumericValue: rejects non-numeric text', () => {
    assert.throws(() => parseNumericValue('abc', 'El valor'), /número/);
    assert.throws(() => parseNumericValue('7.8.5', 'El valor'), /número/);
    assert.throws(() => parseNumericValue('7,8,5', 'El valor'), /número/);
});

test('parseNumericValue: rejects negatives', () => {
    assert.throws(() => parseNumericValue('-5', 'El valor'), /negativo/);
    assert.throws(() => parseNumericValue('-5.5', 'La sistólica'), /negativo/);
});

test('parseNumericValue: an empty or whitespace-only string comes back empty (the caller decides if it is required)', () => {
    assert.equal(parseNumericValue('', 'El valor'), '');
    assert.equal(parseNumericValue('   ', 'El valor'), '');
});
