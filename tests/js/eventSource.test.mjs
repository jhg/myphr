/**
 * Checks of the event source (`health/eventSource.js`, ADR 0004, ADR 0006).
 *
 * What is really tested here is that **the two implementations are interchangeable**: the patient
 * panel asks the server for pages and the professional's reader serves from memory, and both have
 * to return the same events of the same range in the same order. Otherwise patient and doctor
 * would see different means for the same period, which is exactly what the abstraction prevents.
 *
 * `livewireEventSource` is tested with no master key in memory on purpose: that way every envelope
 * fails to open and it also checks that a broken envelope is counted and does not take the load
 * down (ADR 0004). What is asserted of that implementation is the pagination, which is its job.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    flattenDecryptedEvent,
    memoryEventSource,
    needsAnotherPage,
    rangeEndMs,
    rangeStartMs,
} from '../../resources/js/health/eventSource.js';
import { livewireEventSource } from '../../resources/js/health/livewireEventSource.js';

/**
 * @param {string} occurredAt
 * @param {string} [type]
 * @returns {object} Event already decrypted and flattened.
 */
function decryptedEvent(occurredAt, type = 'glucose') {
    return { v: 1, type, tz: '+00:00', occurredAt, data: { value: '100', unit: 'mg/dL' } };
}

// --- Ranges --------------------------------------------------------------------------------------

test('rangeEndMs: a range open at the top sets no ceiling', () => {
    assert.equal(rangeEndMs({ to: null }), Infinity);
    assert.equal(rangeEndMs({}), Infinity);
    assert.equal(rangeEndMs({ to: 'no es una fecha' }), Infinity);
    assert.equal(rangeEndMs({ to: '2026-07-25T00:00:00.000000Z' }), Date.parse('2026-07-25T00:00:00.000000Z'));
});

// --- memoryEventSource ---------------------------------------------------------------------------

/**
 * The same criterion as the server (`HealthEventPage::fetchEvents`): `>=` at the start and `<` at
 * the end. An event exactly on the cut instant cannot enter two periods or fall out of both.
 */
test('memoryEventSource: clips [from, to) like the server', async () => {
    const source = memoryEventSource([
        decryptedEvent('2026-07-23T12:00:00.000000Z'),
        decryptedEvent('2026-07-24T00:00:00.000000Z'),
        decryptedEvent('2026-07-24T18:00:00.000000Z'),
        decryptedEvent('2026-07-25T00:00:00.000000Z'),
    ]);

    const { events } = await source({ from: '2026-07-24T00:00:00.000000Z', to: '2026-07-25T00:00:00.000000Z' });

    assert.deepEqual(events.map((event) => event.occurredAt), [
        '2026-07-24T18:00:00.000000Z',
        '2026-07-24T00:00:00.000000Z',
    ]);
});

test('memoryEventSource: returns from most recent to oldest, like the server', async () => {
    const source = memoryEventSource([
        decryptedEvent('2026-07-20T09:00:00.000000Z'),
        decryptedEvent('2026-07-25T09:00:00.000000Z'),
        decryptedEvent('2026-07-22T09:00:00.000000Z'),
    ]);

    const { events, truncated, failedToOpen } = await source({ from: null, to: null });

    assert.deepEqual(events.map((event) => event.occurredAt), [
        '2026-07-25T09:00:00.000000Z',
        '2026-07-22T09:00:00.000000Z',
        '2026-07-20T09:00:00.000000Z',
    ]);
    /** There is no pagination to exhaust: they are all right here. */
    assert.equal(truncated, false);
    assert.equal(failedToOpen, 0);
});

/** Hiding a record is worse than showing it badly placed: an unreadable date is not dropped. */
test('memoryEventSource: an unreadable date does not make the record disappear', async () => {
    const source = memoryEventSource([decryptedEvent('no es una fecha')]);

    const { events } = await source({ from: '2026-07-24T00:00:00.000000Z', to: '2026-07-25T00:00:00.000000Z' });

    assert.equal(events.length, 1);
});

/** The reader envelopes are opened while unpacking: the count has to reach the view. */
test('memoryEventSource: keeps how many envelopes did not open (ADR 0004)', async () => {
    const source = memoryEventSource([decryptedEvent('2026-07-25T09:00:00.000000Z')], { failedToOpen: 3 });

    const { failedToOpen } = await source({ from: null, to: null });

    assert.equal(failedToOpen, 3);
});

// --- livewireEventSource -------------------------------------------------------------------------

/**
 * @param {list<list<object>>} pages What the server returns, in order.
 * @returns {{fetchPage: Function, calls: list<object>}}
 */
function fakeServer(pages) {
    const calls = [];

    return {
        calls,
        fetchPage: async (cursor, limit, range) => {
            calls.push({ cursor, limit, range });

            return pages[calls.length - 1] ?? [];
        },
    };
}

/**
 * @param {string} occurredAt
 * @returns {{occurredAt: string, payload: string}} As `fetchEvents` returns it, undecrypted.
 */
function rawEvent(occurredAt) {
    return { id: occurredAt, occurredAt, payload: 'v1.no-abre' };
}

test('livewireEventSource: passes the range to the server and pages with the oldest as cursor', async () => {
    const server = fakeServer([
        [rawEvent('2026-07-25T09:00:00.000000Z'), rawEvent('2026-07-24T09:00:00.000000Z')],
        [rawEvent('2026-06-01T09:00:00.000000Z')],
    ]);
    const range = { from: '2026-06-25T00:00:00.000000Z', to: null };

    const { events, failedToOpen, truncated } = await livewireEventSource({
        fetchPage: server.fetchPage,
        userId: 'user-1',
        pageSize: 2,
    })(range);

    assert.equal(server.calls.length, 2);
    assert.equal(server.calls[0].cursor, null);
    assert.equal(server.calls[0].limit, 2);
    assert.deepEqual(server.calls[0].range, range);
    /** The cursor is the oldest event of the previous page; the server applies it with `<`. */
    assert.equal(server.calls[1].cursor, '2026-07-24T09:00:00.000000Z');
    assert.equal(truncated, false);
    /** With no master key in memory no envelope opens: they are counted and the load survives (ADR 0004). */
    assert.equal(events.length, 0);
    assert.equal(failedToOpen, 3);
});

test('livewireEventSource: an incomplete page closes the load without asking for more', async () => {
    const server = fakeServer([[rawEvent('2026-07-25T09:00:00.000000Z')]]);

    const { truncated } = await livewireEventSource({
        fetchPage: server.fetchPage,
        userId: 'user-1',
        pageSize: 500,
    })({ from: null, to: null });

    assert.equal(server.calls.length, 1);
    assert.equal(truncated, false);
});

/**
 * Exhausting the page cap without reaching the start of the range has to **be said**: the summary
 * is still the one of the most recent records, and presenting it as the one of the whole period is
 * the kind of silent clip that makes everything else be read wrongly.
 */
test('livewireEventSource: on exhausting the page cap it declares the load truncated', async () => {
    const pages = Array.from({ length: 4 }, (unused, index) => [
        rawEvent(new Date(Date.parse('2026-07-25T09:00:00.000Z') - (index * 3_600_000)).toISOString()),
    ]);
    const server = fakeServer(pages);

    const { truncated } = await livewireEventSource({
        fetchPage: server.fetchPage,
        userId: 'user-1',
        pageSize: 1,
        maxPages: 3,
    })({ from: '2020-01-01T00:00:00.000000Z', to: null });

    assert.equal(server.calls.length, 3);
    assert.equal(truncated, true);
});

// --- Loose pieces ---------------------------------------------------------------------------------

test('needsAnotherPage and rangeStartMs still govern the pagination loop', () => {
    assert.equal(needsAnotherPage([{ occurredAt: '2026-07-25T09:00:00.000000Z' }], 2, -Infinity), false);
    assert.equal(rangeStartMs({ from: null }), -Infinity);
});

test('flattenDecryptedEvent: joins occurredAt with the decrypted content', () => {
    const flattened = flattenDecryptedEvent(
        { occurredAt: '2026-07-25T09:00:00.000000Z' },
        { v: 1, type: 'glucose', tz: '+00:00', data: { value: '100' } },
    );

    assert.equal(flattened.occurredAt, '2026-07-25T09:00:00.000000Z');
    assert.equal(flattened.type, 'glucose');
});
