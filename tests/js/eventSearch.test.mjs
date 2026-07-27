/**
 * Comprobaciones de la búsqueda sobre eventos descifrados (`health/eventSearch.js`).
 *
 * La búsqueda es puramente de memoria y nunca sale del navegador (ver el encabezado del módulo: el
 * buscador global del panel está apagado porque resolvería en el servidor, sobre columnas cifradas).
 * Aquí se comprueba lo que la persona espera al teclear: que encuentre lo que ve escrito, con o sin
 * tildes, y que varios términos acoten en vez de ampliar.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchesSearch, normalizeForSearch, searchEvents, searchTerms } from '../../resources/js/health/eventSearch.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/** Estos tests afirman texto en castellano, así que fijan el idioma en vez de darlo por supuesto. */
setLocale('es');

const MEAL = Object.freeze({
    v: 1,
    type: 'meal',
    tz: '+00:00',
    occurredAt: '2026-07-25T08:00:00.000000Z',
    data: { mealType: 'breakfast', foods: [{ name: 'Café con leche', quantity: '1', unit: '{unidad}' }] },
});

const GLUCOSE = Object.freeze({
    v: 1,
    type: 'glucose',
    tz: '+00:00',
    occurredAt: '2026-07-25T09:30:00.000000Z',
    note: 'Antes de salir a andar',
    device: 'Freestyle Libre 3',
    data: { value: '112', unit: 'mg/dL', method: 'capillary' },
});

test('normalizeForSearch: sin mayúsculas y sin tildes, que es como se teclea', () => {
    assert.equal(normalizeForSearch('Café CON Leche'), 'cafe con leche');
});

test('searchTerms: trocea y descarta los espacios; lo vacío no busca nada', () => {
    assert.deepEqual(searchTerms('  capilar   112 '), ['capilar', '112']);
    assert.deepEqual(searchTerms('   '), []);
    assert.deepEqual(searchTerms(undefined), []);
});

/** Sin nada tecleado no se esconde nada: se devuelve la misma lista. */
test('searchEvents: una consulta vacía no filtra', () => {
    const events = [MEAL, GLUCOSE];

    assert.equal(searchEvents(events, ''), events);
    assert.equal(searchEvents(events, '   ').length, 2);
});

test('searchEvents: encuentra por la nota libre y por el aparato', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'andar'), [GLUCOSE]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'libre'), [GLUCOSE]);
});

test('searchEvents: encuentra por el nombre de un alimento, con o sin tilde', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'cafe'), [MEAL]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'CAFÉ'), [MEAL]);
});

/**
 * Se busca sobre lo que se **lee**, no sobre los tokens del sobre: quien ve «Capilar» en pantalla
 * teclea «capilar», no `capillary`. Los dos tienen que encontrar la misma lectura.
 */
test('searchEvents: la etiqueta traducida encuentra igual que el token del catálogo', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'capilar'), [GLUCOSE]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'capillary'), [GLUCOSE]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'desayuno'), [MEAL]);
});

test('searchEvents: encuentra por el valor y por la unidad de la medición', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], '112'), [GLUCOSE]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'mg/dl'), [GLUCOSE]);
});

/** Varios términos acotan: «capilar 112» es la lectura capilar de 112, no todo lo capilar más todo 112. */
test('searchEvents: varios términos se exigen todos', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'capilar 112'), [GLUCOSE]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'capilar cafe'), []);
});

/**
 * La fecha no entra en la búsqueda: tiene su propio control de periodo, y buscar «11» no puede traer
 * todo lo ocurrido a las 11:00 de cualquier día.
 */
test('searchEvents: la fecha del evento no es texto buscable', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], '2026'), []);
});

test('matchesSearch: sin términos, todo casa', () => {
    assert.equal(matchesSearch(GLUCOSE, []), true);
});

/** Un tipo que la línea temporal no sabe describir se sigue pudiendo buscar por su contenido. */
test('matchesSearch: un tipo desconocido se busca por las cadenas de su contenido', () => {
    const future = { v: 1, type: 'futureType', tz: '+00:00', occurredAt: '2026-07-25T09:00:00.000000Z', note: 'Rarito' };

    assert.equal(matchesSearch(future, searchTerms('rarito')), true);
});
