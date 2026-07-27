/**
 * Búsqueda de texto libre sobre eventos **ya descifrados**.
 *
 * ## Por qué esto puede existir aquí y el buscador global del panel está apagado a propósito
 *
 * El buscador de Filament resuelve en el servidor: escribe un `where ... like` contra columnas de la
 * base de datos. En este proyecto las columnas de un evento son `user_id`, `occurred_at` y un blob
 * cifrado (ADR 0006), así que ese buscador o no encontraría nada nunca, o —peor— empujaría a
 * guardar en claro algo por lo que buscar. Un índice de «alimentos que come esta persona» o de
 * «aparato con el que se mide» en la base de datos es exactamente el metadato que el ADR 0006
 * cifró; leer `["insulina rápida"]` es saber que esa persona es diabética sin descifrar un byte. Por
 * eso está desactivado y por eso tiene que seguir estándolo.
 *
 * Esta búsqueda es lo contrario: corre **entera en el navegador**, sobre los eventos que ya se
 * bajaron y se abrieron para pintar la pantalla. No hay petición, no hay parámetro de consulta, no
 * hay `$wire`, no hay propiedad pública de Livewire (el snapshot viaja al servidor y se queda ahí,
 * ADR 0002) y el texto tecleado no sale del dispositivo. Es gratis por la misma razón que el filtro
 * por tipo: los datos ya están descifrados en memoria.
 *
 * La consecuencia honesta, escrita para que nadie se lleve una sorpresa: **solo busca en lo
 * cargado**. Si el periodo elegido es el último día, no encuentra la nota de hace un mes. La salida
 * es ampliar el periodo, que sí viaja al servidor por `occurred_at`, columna en claro. Cualquier
 * intento de arreglarlo «buscando en todo el historial» sin ampliar el periodo significaría bajarlo
 * y descifrarlo entero, o pedírselo al servidor, y lo segundo no es posible sin romper el cifrado.
 *
 * ## Qué se busca
 *
 * El texto que la persona **ve**: el tipo, el resumen y el detalle de la línea temporal (que ya
 * traducen los tokens de catálogo, así que «capilar» encuentra un `capillary`), más todas las
 * cadenas del contenido descifrado —nota, aparato, nombres de alimentos, unidades, valores—. Buscar
 * sobre lo que se lee es lo único que no sorprende: si aparece en pantalla, se encuentra.
 */

import { typeLabel } from './eventLabels.js';
import { describeTimelineEvent } from './timelineView.js';

/**
 * Profundidad máxima al recorrer el contenido en busca de cadenas. Los eventos del ADR 0006 son
 * planos o casi (`data.foods[].name` es lo más hondo); el tope existe para que un contenido
 * inesperado no pueda hacer entrar al recorrido en un bucle.
 */
const MAX_DEPTH = 4;

/**
 * Normaliza para comparar: sin mayúsculas y sin tildes.
 *
 * Sin quitar tildes, buscar «desayuno» no encontraría «Desayúno» y, sobre todo, quien teclea sin
 * acentos —lo normal en un buscador— no encontraría «Café». Es comparación de texto, no
 * almacenamiento: el dato no se toca.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeForSearch(text) {
    return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Trocea lo tecleado en términos. Varios términos se exigen **todos** (Y lógica, no O): quien
 * escribe «capilar 140» busca la lectura capilar de 140, no todo lo capilar más todo lo que valga
 * 140.
 *
 * @param {unknown} query
 * @returns {list<string>} Vacía si no hay nada que buscar.
 */
export function searchTerms(query) {
    if (typeof query !== 'string') {
        return [];
    }

    return normalizeForSearch(query).split(/\s+/).filter((term) => term !== '');
}

/**
 * Todas las cadenas de un valor cualquiera, recursivamente. Los números también cuentan: el valor de
 * una glucemia viaja como cadena (ADR 0004), pero una `quantity` numérica de un futuro tipo de
 * evento se buscaría igual.
 *
 * @param {unknown} value
 * @param {number} depth
 * @param {list<string>} into
 */
function collectStrings(value, depth, into) {
    if (typeof value === 'string') {
        into.push(value);

        return;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        into.push(String(value));

        return;
    }

    if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') {
        return;
    }

    for (const nested of Object.values(value)) {
        collectStrings(nested, depth + 1, into);
    }
}

/**
 * Texto contra el que se busca un evento: lo que se ve en pantalla más el contenido en claro.
 *
 * @param {object} event Evento descifrado y aplanado.
 * @returns {string} Ya normalizado.
 */
export function searchableText(event) {
    /** @type {list<string>} */
    const parts = [];

    if (typeof event?.type === 'string') {
        parts.push(event.type, typeLabel(event.type));
    }

    const entry = describeTimelineEvent(event);

    if (entry !== null) {
        parts.push(entry.summary);

        if (entry.detail !== null) {
            parts.push(entry.detail);
        }
    }

    /**
     * Los campos comunes (`note`, `device`, `origin`, `recordedBy`) van en el nivel superior del
     * contenido y `data` lleva lo propio del tipo, así que se recorre el evento entero menos la
     * fecha, que ya tiene su propio control de periodo y solo añadiría ruido: buscar «11» no debe
     * traer todo lo ocurrido a las 11:00.
     */
    for (const [key, value] of Object.entries(event ?? {})) {
        if (key === 'occurredAt' || key === 'tz' || key === 'v') {
            continue;
        }

        collectStrings(value, 0, parts);
    }

    return normalizeForSearch(parts.join(' '));
}

/**
 * ¿Casa este evento con todos los términos?
 *
 * @param {object} event
 * @param {list<string>} terms Ya normalizados ({@see searchTerms}).
 * @returns {boolean}
 */
export function matchesSearch(event, terms) {
    if (terms.length === 0) {
        return true;
    }

    const haystack = searchableText(event);

    return terms.every((term) => haystack.includes(term));
}

/**
 * Filtra por texto libre. Una consulta vacía devuelve **la misma lista**, no una copia filtrada: no
 * buscar nada no puede esconder nada.
 *
 * @param {list<object>} events Eventos descifrados y aplanados.
 * @param {unknown} query Lo tecleado.
 * @returns {list<object>}
 */
export function searchEvents(events, query) {
    const terms = searchTerms(query);

    if (terms.length === 0) {
        return events;
    }

    return events.filter((event) => matchesSearch(event, terms));
}
