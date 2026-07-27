/**
 * Checks of the search over decrypted events (`health/eventSearch.js`).
 *
 * The search is purely in memory and never leaves the browser (see the module header: the global
 * panel search is switched off because it would resolve on the server, over encrypted columns).
 * What is checked here is what the person expects when typing: that it finds what they see
 * written, with or without accents, and that several terms narrow instead of widening.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchesSearch, normalizeForSearch, searchEvents, searchTerms } from '../../resources/js/health/eventSearch.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/** These tests assert text in Spanish, so they set the language instead of assuming it. */
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

test('normalizeForSearch: no uppercase and no accents, which is how people type', () => {
    assert.equal(normalizeForSearch('Café CON Leche'), 'cafe con leche');
});

test('searchTerms: splits and drops the spaces; an empty query searches for nothing', () => {
    assert.deepEqual(searchTerms('  capilar   112 '), ['capilar', '112']);
    assert.deepEqual(searchTerms('   '), []);
    assert.deepEqual(searchTerms(undefined), []);
});

/** With nothing typed nothing is hidden: the same list is returned. */
test('searchEvents: an empty query does not filter', () => {
    const events = [MEAL, GLUCOSE];

    assert.equal(searchEvents(events, ''), events);
    assert.equal(searchEvents(events, '   ').length, 2);
});

test('searchEvents: finds by the free note and by the device', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'andar'), [GLUCOSE]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'libre'), [GLUCOSE]);
});

test('searchEvents: finds by the name of a food, with or without an accent', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'cafe'), [MEAL]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'CAFÉ'), [MEAL]);
});

/**
 * The search runs over what is **read**, not over the tokens of the envelope: whoever sees
 * "Capilar" on screen types "capilar", not `capillary`. Both have to find the same reading.
 */
test('searchEvents: the translated label finds the same as the catalog token', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'capilar'), [GLUCOSE]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'capillary'), [GLUCOSE]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'desayuno'), [MEAL]);
});

test('searchEvents: finds by the value and by the unit of the measurement', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], '112'), [GLUCOSE]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'mg/dl'), [GLUCOSE]);
});

/** Several terms narrow: "capilar 112" is the capillary reading of 112, not everything capillary plus everything 112. */
test('searchEvents: several terms are all required', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'capilar 112'), [GLUCOSE]);
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], 'capilar cafe'), []);
});

/**
 * The date does not enter the search: it has its own period control, and searching "11" cannot
 * bring back everything that happened at 11:00 on any day.
 */
test('searchEvents: the date of the event is not searchable text', () => {
    assert.deepEqual(searchEvents([MEAL, GLUCOSE], '2026'), []);
});

test('matchesSearch: with no terms, everything matches', () => {
    assert.equal(matchesSearch(GLUCOSE, []), true);
});

/** A type the timeline cannot describe can still be searched by its content. */
test('matchesSearch: an unknown type is searched by the strings of its content', () => {
    const future = { v: 1, type: 'futureType', tz: '+00:00', occurredAt: '2026-07-25T09:00:00.000000Z', note: 'Rarito' };

    assert.equal(matchesSearch(future, searchTerms('rarito')), true);
});
