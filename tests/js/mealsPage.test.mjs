/**
 * Comprobaciones de la lógica pura de `health/mealsPage.js` (ADR 0004, ADR 0006).
 *
 * No se monta Alpine: `mealsPage()` solo orquesta DOM, y esa orquestación no se prueba aquí. Lo que
 * se prueba es la lógica que no depende del navegador, exportada aparte para poder llamarla
 * directamente (mismo enfoque que `tests/js/glucosePage.test.mjs`).
 *
 * Corredor incorporado de Node, como el resto de `tests/js` (ver `crypto.test.mjs`).
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
 * Estos tests afirman el texto **en castellano**, así que fijan el idioma en vez de darlo por
 * supuesto: el idioma por defecto del cliente es el inglés (igual que `config/app.php`), y en Node
 * no hay `<html lang>` del que deducirlo. Sin esta línea, las afirmaciones de texto de abajo
 * estarían comprobando el catálogo de respaldo sin decirlo.
 */
setLocale('es');

/**
 * Campos comunes de prueba, con la forma que devuelve `buildCommonEventFields` cuando no se le pasa
 * `origin`: siempre `manual`, porque el formulario de comidas no pregunta el origen del dato.
 */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

/** Catálogo de prueba, con la forma que devuelve `Meals::catalog()` (ADR 0005). */
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

test('buildMealContent: forma exacta del ADR 0006, con los alimentos en el orden del DOM', () => {
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

test('buildMealContent: sin tipo de comida es un error, no un valor por defecto', () => {
    assert.throws(
        () => buildMealContent({ mealType: '', rawFoods: [], tz: '+02:00', common: COMMON_FIELDS }),
        /tipo de comida/
    );
});

test('normalizeFoods: la fila en blanco con la que arranca el formulario no cuenta como alimento', () => {
    assert.deepEqual(normalizeFoods([{ name: '', quantity: '', unit: '' }]), []);
    assert.deepEqual(normalizeFoods([{ name: '  ', quantity: ' ', unit: '' }]), []);
});

test('normalizeFoods: una fila a medias es un error, nunca un alimento incompleto guardado', () => {
    assert.throws(() => normalizeFoods([{ name: 'Arroz', quantity: '', unit: 'g' }]), /Completa el nombre/);
    assert.throws(() => normalizeFoods([{ name: '', quantity: '150', unit: 'g' }]), /Completa el nombre/);
});

/**
 * La cantidad es un campo numérico clínico: pasa por `numericValue.js` como el valor de glucemia o
 * la dosis de insulina (convención de `.ai/guidelines/ai.md`). Sin esto, «250,5» y «250.5» se
 * guardarían como dos cadenas distintas dentro de un sobre ya cifrado.
 */
test('normalizeFoods: la coma decimal se normaliza a punto y el valor sigue siendo cadena (ADR 0004)', () => {
    const foods = normalizeFoods([{ name: 'Yogur', quantity: '125,5', unit: 'g' }]);

    assert.deepEqual(foods, [{ name: 'Yogur', quantity: '125.5', unit: 'g' }]);
    assert.equal(typeof foods[0].quantity, 'string');
});

test('normalizeFoods: rechaza cantidades negativas, no numéricas y de más de 2 decimales', () => {
    assert.throws(() => normalizeFoods([{ name: 'Arroz', quantity: '-1', unit: 'g' }]), /negativ/);
    assert.throws(() => normalizeFoods([{ name: 'Arroz', quantity: 'mucho', unit: 'g' }]), /número/);
    assert.throws(() => normalizeFoods([{ name: 'Arroz', quantity: '1.234', unit: 'g' }]), /2 decimales/);
});

test('buildMealContent: normaliza la cantidad de cada alimento antes de cifrar', () => {
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

test('filterMealEvents: descarta lo que no es una comida (el servidor no puede filtrar, ADR 0006)', () => {
    const events = [
        { id: '1', occurredAt: 'a', content: { type: 'meal' } },
        { id: '2', occurredAt: 'b', content: { type: 'glucose' } },
        { id: '3', occurredAt: 'c', content: null },
        { id: '4', occurredAt: 'd', content: { type: 'meal' } },
    ];

    assert.deepEqual(filterMealEvents(events).map((event) => event.id), ['1', '4']);
});

test('describeMealEvent: traduce tokens a etiquetas del catálogo y deja fuera nota y aparato ausentes', () => {
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

test('describeMealEvent: un token que ya no está en el catálogo se muestra tal cual, sin romper la vista', () => {
    const described = describeMealEvent(CATALOG, {
        data: { mealType: 'brunch', foods: [{ name: 'Café', quantity: '1', unit: '[cup_us]' }] },
    });

    assert.equal(described.mealTypeLabel, 'brunch');
    assert.equal(described.foods[0].unitLabel, '[cup_us]');
});

/**
 * Un sobre que abre pero cuyo contenido no tiene la forma esperada no puede dejar el historial
 * entero en blanco: se pinta lo que haya, igual que un sobre que no abre se cuenta y se avisa.
 */
test('describeMealEvent: tolera un contenido sin `data` y sin lista de alimentos', () => {
    assert.deepEqual(describeMealEvent(CATALOG, { type: 'meal' }), {
        mealTypeLabel: '',
        foods: [],
        note: null,
        device: null,
    });

    assert.deepEqual(describeMealEvent(CATALOG, { data: { mealType: 'lunch' } }).foods, []);
});

test('describeMealEvent: conserva nota y aparato cuando los hay', () => {
    const described = describeMealEvent(CATALOG, {
        data: { mealType: 'lunch', foods: [] },
        note: 'Comí fuera',
        device: 'Báscula',
    });

    assert.equal(described.note, 'Comí fuera');
    assert.equal(described.device, 'Báscula');
});

test('formatTzOffset: signo positivo cuando la hora local va por delante de UTC (ADR 0006)', () => {
    assert.equal(formatTzOffset(120), '+02:00');
    assert.equal(formatTzOffset(-330), '-05:30');
    assert.equal(formatTzOffset(0), '+00:00');
});

test('datetimeLocalToCanonical: forma canónica del ADR 0004 y desfase coherente', () => {
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-07-25T14:30:05', { timezoneOffsetMinutes: -120 });

    assert.equal(occurredAt, '2026-07-25T12:30:05.000000Z');
    assert.equal(tz, '+02:00');
});
