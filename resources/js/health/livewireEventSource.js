/**
 * El origen de eventos del **panel del paciente**: pide páginas a Livewire y las abre aquí.
 *
 * Vive aparte de `eventSource.js` por perímetro, no por tamaño. `eventSource.js` lo importa el lector
 * del profesional (`reader.js`), y Rollup arrastra al trozo común la cadena entera de importaciones
 * de todo lo que alcanzan dos entradas: con `livewireEventSource` allí dentro, el lector se llevaba
 * `eventEnvelope.js` → `auth/keyring.js` —el llavero de la clave maestra, con su `sessionStorage`— al
 * navegador de una consulta ajena (ADR 0011). Este fichero es la mitad que **sí** puede depender del
 * llavero, y por eso solo lo importan las pantallas con sesión.
 *
 * La forma de la abstracción y el porqué de las tres claves de la respuesta están documentados en
 * `eventSource.js`.
 */

import { openEvent } from './eventEnvelope.js';
import { FETCH_PAGE_SIZE, flattenDecryptedEvent, MAX_FETCH_PAGES, needsAnotherPage, rangeStartMs } from './eventSource.js';

/**
 * Origen del panel: pide páginas al servidor y las abre aquí, en el navegador.
 *
 * `fetchPage` se inyecta y es la **única** puerta al servidor de todo el camino de visualización:
 * quien lo llama pasa `(cursor, limit, range) => this.$wire.fetchEvents(cursor, limit, range.from,
 * range.to)`, y así este módulo no depende de Livewire. El rango viaja al servidor porque
 * `occurred_at` es una de las tres columnas en claro (ADR 0006) y acotarlo es la única optimización
 * que de verdad importa aquí: con «último día» se abren los sobres de 24 horas, no los de un mes.
 *
 * `truncated` avisa de que se agotó el tope de páginas antes de llegar al inicio del rango: el
 * resumen sigue siendo el de los registros más recientes, pero no puede presentarse como si fuera el
 * del periodo entero.
 *
 * @param {object} params
 * @param {(cursor: string|null, limit: number, range: object) => Promise<list<object>>} params.fetchPage
 * @param {string} params.userId Dato asociado del sobre (ADR 0004).
 * @param {number} [params.pageSize]
 * @param {number} [params.maxPages]
 * @returns {(range: {from: string|null, to: string|null}) => Promise<{events: list<object>, failedToOpen: number, truncated: boolean}>}
 */
export function livewireEventSource({ fetchPage, userId, pageSize = FETCH_PAGE_SIZE, maxPages = MAX_FETCH_PAGES }) {
    return async (range) => {
        const windowStartMs = rangeStartMs(range);
        const rawEvents = [];
        let cursor = null;
        let truncated = true;

        for (let page = 0; page < maxPages; page += 1) {
            const pageEvents = await fetchPage(cursor, pageSize, range);

            rawEvents.push(...pageEvents);

            if (!needsAnotherPage(pageEvents, pageSize, windowStartMs)) {
                truncated = false;

                break;
            }

            /**
             * El cursor es la fecha del evento más antiguo de la página y el servidor la aplica con
             * `<` estricto, así que cada vuelta avanza de verdad.
             */
            cursor = pageEvents[pageEvents.length - 1].occurredAt;
        }

        return { ...openAll(rawEvents, userId), truncated };
    };
}

/**
 * Abre todos los sobres de una lista, contando los que no abren.
 *
 * Un sobre que no abre **no tumba la pantalla** (ADR 0004): se cuenta y quien llama lo dice. Tirarlo
 * en silencio dejaría un historial con un hueco que se lee como «no hubo ninguna medición».
 *
 * @param {list<{occurredAt: string, payload: string}>} rawEvents
 * @param {string} userId
 * @returns {{events: list<object>, failedToOpen: number}}
 */
function openAll(rawEvents, userId) {
    let failedToOpen = 0;
    const events = [];

    for (const rawEvent of rawEvents) {
        try {
            const content = openEvent({
                userId,
                occurredAt: rawEvent.occurredAt,
                envelope: rawEvent.payload,
            });

            events.push(flattenDecryptedEvent(rawEvent, content));
        } catch {
            failedToOpen += 1;
        }
    }

    return { events, failedToOpen };
}

