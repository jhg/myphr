/**
 * Comprobaciones de `health/numericValue.js`: la validación numérica compartida por todas las
 * pantallas de evento clínico (glucemia, tensión arterial, ...).
 *
 * Corredor incorporado de Node, como el resto de `tests/js` (ver `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeDecimalSeparator, parseNumericValue } from '../../resources/js/health/numericValue.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/**
 * Estos tests afirman el texto **en castellano**, así que fijan el idioma en vez de darlo por
 * supuesto: el idioma por defecto del cliente es el inglés (igual que `config/app.php`), y en Node
 * no hay `<html lang>` del que deducirlo. Sin esta línea, las afirmaciones de texto de abajo
 * estarían comprobando el catálogo de respaldo sin decirlo.
 */
setLocale('es');

test('normalizeDecimalSeparator: sustituye la coma decimal por un punto', () => {
    assert.equal(normalizeDecimalSeparator('7,8'), '7.8');
    assert.equal(normalizeDecimalSeparator('142'), '142');
    assert.equal(normalizeDecimalSeparator('7.8'), '7.8');
});

test('parseNumericValue: acepta enteros', () => {
    assert.equal(parseNumericValue('142', 'El valor'), '142');
    assert.equal(parseNumericValue('0', 'El valor'), '0');
});

test('parseNumericValue: acepta 1 y 2 decimales', () => {
    assert.equal(parseNumericValue('7.5', 'El valor'), '7.5');
    assert.equal(parseNumericValue('7.85', 'El valor'), '7.85');
});

test('parseNumericValue: normaliza la coma a punto', () => {
    assert.equal(parseNumericValue('7,8', 'El valor'), '7.8');
    assert.equal(parseNumericValue('  7,85  ', 'El valor'), '7.85');
});

test('parseNumericValue: rechaza 3 o más decimales', () => {
    assert.throws(() => parseNumericValue('7.855', 'El valor'), /2 decimales/);
    assert.throws(() => parseNumericValue('7,855', 'El valor'), /2 decimales/);
});

test('parseNumericValue: rechaza texto no numérico', () => {
    assert.throws(() => parseNumericValue('abc', 'El valor'), /número/);
    assert.throws(() => parseNumericValue('7.8.5', 'El valor'), /número/);
    assert.throws(() => parseNumericValue('7,8,5', 'El valor'), /número/);
});

test('parseNumericValue: rechaza negativos', () => {
    assert.throws(() => parseNumericValue('-5', 'El valor'), /negativo/);
    assert.throws(() => parseNumericValue('-5.5', 'La sistólica'), /negativo/);
});

test('parseNumericValue: cadena vacía o solo espacios se devuelve vacía (obligatoriedad la decide el llamador)', () => {
    assert.equal(parseNumericValue('', 'El valor'), '');
    assert.equal(parseNumericValue('   ', 'El valor'), '');
});
