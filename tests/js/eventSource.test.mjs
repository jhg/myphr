/**
 * Comprobaciones del origen de eventos (`health/eventSource.js`, ADR 0004, ADR 0006).
 *
 * Lo que de verdad se prueba aquí es que **las dos implementaciones son intercambiables**: el panel
 * del paciente pide páginas al servidor y el lector del profesional sirve desde memoria, y las dos
 * tienen que devolver los mismos eventos del mismo rango en el mismo orden. Si no, el paciente y el
 * médico verían medias distintas del mismo periodo, que es justo lo que la abstracción impide.
 *
 * `livewireEventSource` se prueba sin clave maestra en memoria a propósito: así todos los sobres
 * fallan al abrirse y se comprueba de paso que un sobre roto se cuenta y no tumba la carga
 * (ADR 0004). Lo que se afirma de esa implementación es la paginación, que es su trabajo.
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
 * @returns {object} Evento ya descifrado y aplanado.
 */
function decryptedEvent(occurredAt, type = 'glucose') {
    return { v: 1, type, tz: '+00:00', occurredAt, data: { value: '100', unit: 'mg/dL' } };
}

// --- Rangos --------------------------------------------------------------------------------------

test('rangeEndMs: un rango abierto por arriba no pone techo', () => {
    assert.equal(rangeEndMs({ to: null }), Infinity);
    assert.equal(rangeEndMs({}), Infinity);
    assert.equal(rangeEndMs({ to: 'no es una fecha' }), Infinity);
    assert.equal(rangeEndMs({ to: '2026-07-25T00:00:00.000000Z' }), Date.parse('2026-07-25T00:00:00.000000Z'));
});

// --- memoryEventSource ---------------------------------------------------------------------------

/**
 * El mismo criterio que el servidor (`HealthEventPage::fetchEvents`): `>=` al inicio y `<` al final.
 * Un evento justo en el instante de corte no puede entrar en dos periodos ni caerse de los dos.
 */
test('memoryEventSource: acota [from, to) igual que el servidor', async () => {
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

test('memoryEventSource: devuelve del más reciente al más antiguo, como el servidor', async () => {
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
    /** No hay paginación que agotar: están todos delante. */
    assert.equal(truncated, false);
    assert.equal(failedToOpen, 0);
});

/** Esconder un registro es peor que enseñarlo mal colocado: una fecha ilegible no se descarta. */
test('memoryEventSource: una fecha ilegible no hace desaparecer el registro', async () => {
    const source = memoryEventSource([decryptedEvent('no es una fecha')]);

    const { events } = await source({ from: '2026-07-24T00:00:00.000000Z', to: '2026-07-25T00:00:00.000000Z' });

    assert.equal(events.length, 1);
});

/** Los sobres del lector se abren al deshacer el paquete: el recuento tiene que llegar a la vista. */
test('memoryEventSource: conserva cuántos sobres no abrieron (ADR 0004)', async () => {
    const source = memoryEventSource([decryptedEvent('2026-07-25T09:00:00.000000Z')], { failedToOpen: 3 });

    const { failedToOpen } = await source({ from: null, to: null });

    assert.equal(failedToOpen, 3);
});

// --- livewireEventSource -------------------------------------------------------------------------

/**
 * @param {list<list<object>>} pages Lo que devuelve el servidor, en orden.
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
 * @returns {{occurredAt: string, payload: string}} Como lo devuelve `fetchEvents`, sin descifrar.
 */
function rawEvent(occurredAt) {
    return { id: occurredAt, occurredAt, payload: 'v1.no-abre' };
}

test('livewireEventSource: pasa el rango al servidor y pagina con el más antiguo como cursor', async () => {
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
    /** El cursor es el evento más antiguo de la página anterior; el servidor lo aplica con `<`. */
    assert.equal(server.calls[1].cursor, '2026-07-24T09:00:00.000000Z');
    assert.equal(truncated, false);
    /** Sin clave maestra en memoria ningún sobre abre: se cuentan y la carga no se cae (ADR 0004). */
    assert.equal(events.length, 0);
    assert.equal(failedToOpen, 3);
});

test('livewireEventSource: una página incompleta cierra la carga sin pedir más', async () => {
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
 * Agotar el tope de páginas sin llegar al inicio del rango tiene que **decirse**: el resumen sigue
 * siendo el de los registros más recientes, y presentarlo como el del periodo entero es la clase de
 * recorte silencioso que hace leer mal todo lo demás.
 */
test('livewireEventSource: al agotar el tope de páginas lo declara como truncado', async () => {
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

// --- Piezas sueltas -------------------------------------------------------------------------------

test('needsAnotherPage y rangeStartMs siguen gobernando el bucle de paginación', () => {
    assert.equal(needsAnotherPage([{ occurredAt: '2026-07-25T09:00:00.000000Z' }], 2, -Infinity), false);
    assert.equal(rangeStartMs({ from: null }), -Infinity);
});

test('flattenDecryptedEvent: junta occurredAt con el contenido descifrado', () => {
    const flattened = flattenDecryptedEvent(
        { occurredAt: '2026-07-25T09:00:00.000000Z' },
        { v: 1, type: 'glucose', tz: '+00:00', data: { value: '100' } },
    );

    assert.equal(flattened.occurredAt, '2026-07-25T09:00:00.000000Z');
    assert.equal(flattened.type, 'glucose');
});
