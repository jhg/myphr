/**
 * Comprobaciones de la lógica pura de `auth/profilePage.js` (ADR 0004, ADR 0007).
 *
 * No se monta Alpine: `profilePage()` solo orquesta DOM y peticiones. Lo que se prueba es la
 * validación del rango objetivo de glucemia, que es donde un fallo silencioso se convierte en una
 * indicación clínica falsa: un rango a medias, del revés, o con un extremo inventado.
 *
 * Corredor incorporado de Node, como el resto de `tests/js` (ver `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSettingsPatch, parseGlucoseTargetRange } from '../../resources/js/auth/profilePage.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/**
 * Estos tests afirman el texto **en castellano**, así que fijan el idioma en vez de darlo por
 * supuesto: el idioma por defecto del cliente es el inglés (igual que `config/app.php`), y en Node
 * no hay `<html lang>` del que deducirlo. Sin esta línea, las afirmaciones de texto de abajo
 * estarían comprobando el catálogo de respaldo sin decirlo.
 */
setLocale('es');

test('parseGlucoseTargetRange: los dos límites en blanco significan «sin configurar»', () => {
    assert.equal(parseGlucoseTargetRange({ lowRaw: '', highRaw: '', unit: 'mg/dL' }), null);
    assert.equal(parseGlucoseTargetRange({ lowRaw: '   ', highRaw: '  ', unit: 'mg/dL' }), null);
});

test('parseGlucoseTargetRange: devuelve números y conserva la unidad con la que se escribió', () => {
    assert.deepEqual(
        parseGlucoseTargetRange({ lowRaw: '70', highRaw: '180', unit: 'mg/dL' }),
        { low: 70, high: 180, unit: 'mg/dL' },
    );

    assert.deepEqual(
        parseGlucoseTargetRange({ lowRaw: '3,9', highRaw: '10', unit: 'mmol/L' }),
        { low: 3.9, high: 10, unit: 'mmol/L' },
    );
});

test('parseGlucoseTargetRange: rechaza un rango a medias', () => {
    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '70', highRaw: '', unit: 'mg/dL' }),
        /los dos límites/i,
    );

    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '', highRaw: '180', unit: 'mg/dL' }),
        /los dos límites/i,
    );
});

test('parseGlucoseTargetRange: exige que el inferior sea menor que el superior', () => {
    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '180', highRaw: '70', unit: 'mg/dL' }),
        /menor que el superior/i,
    );

    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '100', highRaw: '100', unit: 'mg/dL' }),
        /menor que el superior/i,
    );
});

test('parseGlucoseTargetRange: rechaza el cero como límite', () => {
    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '0', highRaw: '180', unit: 'mg/dL' }),
        /mayores que cero/i,
    );
});

test('parseGlucoseTargetRange: hereda la validación numérica de numericValue.js', () => {
    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '70.123', highRaw: '180', unit: 'mg/dL' }),
        /2 decimales/,
    );

    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '-70', highRaw: '180', unit: 'mg/dL' }),
        /negativo/,
    );

    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: 'setenta', highRaw: '180', unit: 'mg/dL' }),
        /número/,
    );
});

test('parseGlucoseTargetRange: rechaza una unidad que no es UCUM', () => {
    assert.throws(
        () => parseGlucoseTargetRange({ lowRaw: '70', highRaw: '180', unit: 'mg/l' }),
        /unidad válida/i,
    );
});

test('buildSettingsPatch: sin rango, la clave se borra con null', () => {
    assert.deepEqual(
        buildSettingsPatch({ glucoseUnit: 'mg/dL', lowRaw: '', highRaw: '', rangeUnit: 'mg/dL' }),
        { glucoseUnit: 'mg/dL', glucoseTargetRange: null },
    );
});

test('buildSettingsPatch: con rango, lo incluye tal cual', () => {
    assert.deepEqual(
        buildSettingsPatch({ glucoseUnit: 'mmol/L', lowRaw: '3.9', highRaw: '10', rangeUnit: 'mmol/L' }),
        { glucoseUnit: 'mmol/L', glucoseTargetRange: { low: 3.9, high: 10, unit: 'mmol/L' } },
    );
});

test('buildSettingsPatch: rechaza una unidad preferida que no es UCUM', () => {
    assert.throws(
        () => buildSettingsPatch({ glucoseUnit: 'mgdl', lowRaw: '', highRaw: '', rangeUnit: 'mg/dL' }),
        /unidad válida/i,
    );
});
