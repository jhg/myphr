/**
 * Línea temporal unificada de eventos ya descifrados.
 *
 * **Qué es y por qué es un módulo propio.** Es la única vista que enseña la relación entre comer,
 * pincharse insulina y lo que hace la glucosa después: ninguna pantalla por tipo puede hacerlo.
 * Vivía dentro de `dashboardPage.js`, atada al panel del paciente; ahora **recibe un array de
 * eventos descifrados y devuelve nodos**, sin tocar Livewire, ni `$wire`, ni ningún `x-ref`, para
 * que el médico que abre un recorte compartido vea exactamente la misma línea temporal que el
 * paciente, sin cuenta y sin sesión.
 *
 * Las dos exclusiones posibles —el tope de entradas y los tipos que este módulo no sabe describir—
 * se declaran siempre con su recuento exacto. Una línea temporal recortada que se presenta como
 * completa hace leer mal lo que sí aparece.
 */

import { formatDayHeading, formatTimeOfDay, joinList, t } from '../i18n/index.js';
import {
    catalogLabel,
    formatMeasuredValue,
    formatMethodLabel,
    INSULIN_TYPE_KEYS,
    MEAL_TYPE_KEYS,
    TEMPERATURE_SITE_KEYS,
    typeLabel,
} from './eventLabels.js';
import { createCallout, renderEmptyState } from './eventVisuals.js';

/**
 * Tope de entradas que se pintan.
 *
 * **El descifrado no lo motiva**: los eventos llegan ya descifrados. Lo que cuesta es el DOM: un mes
 * de registro intensivo puede pasar del millar de filas, y pintarlas todas deja la pantalla pesada
 * en un móvil.
 *
 * Se recorta por lo más reciente, **nunca en silencio** ({@see renderTimelineSection}).
 */
export const TIMELINE_MAX_ENTRIES = 100;

/**
 * Alimentos que se nombran en la línea de una comida antes de resumir el resto con `+N`.
 *
 * Una comida de doce ingredientes ocuparía cinco líneas y rompería el «se lee de un vistazo»; los
 * nombres completos siguen estando en la pantalla de comidas.
 */
const TIMELINE_MAX_FOODS = 3;

/**
 * Resumen de una línea de cada tipo de evento.
 *
 * Cada entrada devuelve `{summary, detail}`: `summary` es el dato (la cifra con su unidad) y
 * `detail` el contexto que evita leerlo mal —el método de medición, el sitio, el tipo de insulina—,
 * que la vista pinta en tinta secundaria. `detail` puede ser `null`: todos esos campos son
 * opcionales en el sobre (ADR 0006) y aquí no se inventa ninguno.
 *
 * Las unidades salen del propio evento y son códigos UCUM (ADR 0005): no se traducen ni se
 * convierten (ADR 0007).
 *
 * @type {Record<string, (data: object) => {summary: string, detail: string|null}>}
 */
const TIMELINE_SUMMARIES = Object.freeze({
    glucose: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.value),
            unit: data.unit ?? '',
        }),
        detail: typeof data.method === 'string' && data.method !== '' ? formatMethodLabel(data.method) : null,
    }),

    bloodPressure: (data) => {
        const reading = t('dashboard.timeline.bloodPressureReading', {
            systolic: formatMeasuredValue(data.systolic),
            diastolic: formatMeasuredValue(data.diastolic),
            unit: data.unit ?? '',
        });

        /** El pulso es opcional (ADR 0006): sin él la línea no deja ningún hueco ni escribe un cero. */
        const pulse = typeof data.pulse === 'string' && data.pulse !== ''
            ? t('dashboard.timeline.pulse', {
                pulse: formatMeasuredValue(data.pulse),
                unit: t('dashboard.unit.bpm'),
            })
            : null;

        return {
            summary: pulse === null ? reading : `${reading} · ${pulse}`,
            detail: typeof data.arm === 'string' && typeof data.posture === 'string'
                ? formatMethodLabel(`${data.arm}_${data.posture}`)
                : null,
        };
    },

    insulin: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.dose),
            unit: data.unit ?? '',
        }),
        detail: catalogLabel(INSULIN_TYPE_KEYS, data.insulinType) || null,
    }),

    /**
     * En una comida el dato clínico no es una cifra sino qué se comió: el tipo de comida es el
     * resumen y los alimentos, el detalle. Es justo el dato que permite leer la línea temporal como
     * lo que persigue: comer, pincharse y lo que hace la glucosa después.
     */
    meal: (data) => {
        const foods = Array.isArray(data.foods) ? data.foods : [];
        const names = foods
            .map((food) => (typeof food?.name === 'string' ? food.name.trim() : ''))
            .filter((name) => name !== '');
        const shown = names.slice(0, TIMELINE_MAX_FOODS);
        const hidden = names.length - shown.length;

        if (hidden > 0) {
            shown.push(t('dashboard.timeline.moreFoods', { count: hidden }));
        }

        return {
            summary: catalogLabel(MEAL_TYPE_KEYS, data.mealType),
            detail: names.length === 0 ? t('dashboard.timeline.noFoods') : joinList(shown),
        };
    },

    bodyWeight: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.value),
            unit: data.unit ?? '',
        }),
        detail: null,
    }),

    temperature: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.value),
            unit: data.unit ?? '',
        }),
        detail: catalogLabel(TEMPERATURE_SITE_KEYS, data.site) || null,
    }),
});

/**
 * Trazo del icono de cada tipo, en el estilo de línea de los demás iconos (24×24, sin relleno,
 * `stroke-width` 1.5).
 *
 * **Por qué icono y no color propio.** Seis tipos exigirían seis colores, y DESIGN.md solo define
 * cuatro colores de serie —los dos últimos con significado de estado (Success, Warning) y el rojo
 * reservado a errores (Don'ts #4)—; inventar dos más sería exactamente la «paleta privada» que la
 * sección § Charts prohíbe. Además el color nunca puede ser el único portador del significado
 * (Do's #3). Con la silueta del icono más el nombre del tipo escrito, la distinción se sostiene
 * también en escala de grises y con el tema oscuro.
 *
 * @type {Record<string, string>}
 */
const TIMELINE_ICONS = Object.freeze({
    glucose: 'M12 3.75s5.25 5.25 5.25 9a5.25 5.25 0 0 1-10.5 0c0-3.75 5.25-9 5.25-9Z',
    bloodPressure: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733'
        + '-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z',
    insulin: 'm15.75 3.75 4.5 4.5M18.75 6.75 6.75 18.75l-3.75 1.5 1.5-3.75L16.5 4.5M9.75 12l1.5 1.5M12 9.75l1.5 1.5',
    meal: 'M6 3v6a2.25 2.25 0 0 0 2.25 2.25M6 3v18M9.75 3v6M8.25 11.25V21M17.25 3c-1.125 1.5-1.5 3-1.5 5.25 '
        + '0 1.5.75 2.25 1.5 2.25V21',
    bodyWeight: 'M4.5 6.75h15v12.75h-15V6.75Zm7.5 2.25-2.25 4.5h4.5L12 9Z',
    temperature: 'M12 3.75a2.25 2.25 0 0 1 2.25 2.25v7.06a4.5 4.5 0 1 1-4.5 0V6A2.25 2.25 0 0 1 12 3.75Z',
});

/**
 * Resume un evento ya descifrado en una entrada de la línea temporal.
 *
 * Devuelve `null` para un tipo que este módulo no sabe describir —un tipo futuro, o un sobre cuyo
 * contenido no tiene la forma esperada—. Quien llame cuenta esos casos y los declara en pantalla
 * ({@see buildTimeline}).
 *
 * @param {{type?: string, occurredAt: string, data?: object}} event Aplanado con
 *        `flattenDecryptedEvent`.
 * @returns {{type: string, typeLabel: string, summary: string, detail: string|null, occurredAt: string}|null}
 */
export function describeTimelineEvent(event) {
    const describe = TIMELINE_SUMMARIES[event?.type];

    if (describe === undefined) {
        return null;
    }

    const { summary, detail } = describe(event.data ?? {});

    return {
        type: event.type,
        /**
         * Clave compuesta con el token del tipo. Solo se alcanza para los tipos que están en
         * `TIMELINE_SUMMARIES` (los demás han salido ya por `null`), así que la lista de claves
         * `dashboard.timeline.type.*` que tienen que existir en los tres catálogos es exactamente la
         * de ese objeto.
         */
        typeLabel: typeLabel(event.type),
        summary,
        detail,
        occurredAt: event.occurredAt,
    };
}

/**
 * Clave de agrupación por día **en la zona del dispositivo**, no en UTC.
 *
 * Agrupar por la fecha UTC partiría en dos días una cena de las 23:30 en Madrid en verano, que es
 * justo la entrada que hay que ver junto a la glucemia de después.
 *
 * @param {string} occurredAt
 * @returns {string} `YYYY-MM-DD` local.
 */
export function localDayKey(occurredAt) {
    const date = new Date(occurredAt);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Entradas de la línea temporal: los eventos que llegan, mezclados y del más reciente al más
 * antiguo.
 *
 * No filtra por ventana ni por tipo: el periodo lo aplica el origen de datos (`eventSource.js`) y el
 * tipo quien llama (`filterBySelectedTypes`), así que aquí llega exactamente lo que hay que pintar.
 *
 * `hidden` son las entradas que quedaron fuera por el tope de {@see TIMELINE_MAX_ENTRIES} y
 * `unsupported` las de un tipo que este módulo no sabe describir. Los dos recuentos salen a
 * pantalla: ninguna de las dos exclusiones es silenciosa.
 *
 * @param {list<object>} events Eventos descifrados, aplanados y ya filtrados por periodo y por tipo.
 * @returns {{entries: list<object>, hidden: number, unsupported: number}}
 */
export function buildTimeline(events) {
    const entries = [];
    let unsupported = 0;

    for (const event of events) {
        const entry = describeTimelineEvent(event);

        if (entry === null) {
            unsupported += 1;

            continue;
        }

        entries.push(entry);
    }

    entries.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

    return {
        entries: entries.slice(0, TIMELINE_MAX_ENTRIES),
        hidden: Math.max(entries.length - TIMELINE_MAX_ENTRIES, 0),
        unsupported,
    };
}

/**
 * Agrupa entradas ya ordenadas en días, conservando el orden de llegada.
 *
 * @param {list<{occurredAt: string}>} entries Ordenadas de más reciente a más antigua.
 * @returns {list<{dayKey: string, occurredAt: string, entries: list<object>}>}
 */
export function groupEntriesByDay(entries) {
    /** @type {list<{dayKey: string, occurredAt: string, entries: list<object>}>} */
    const days = [];

    for (const entry of entries) {
        const dayKey = localDayKey(entry.occurredAt);
        const current = days[days.length - 1];

        if (current !== undefined && current.dayKey === dayKey) {
            current.entries.push(entry);

            continue;
        }

        days.push({ dayKey, occurredAt: entry.occurredAt, entries: [entry] });
    }

    return days;
}

/**
 * Icono del tipo de una entrada. Es decorativo (`aria-hidden`): el tipo va escrito al lado, y el
 * lector de pantalla ya lo lee ahí.
 *
 * @param {string} type
 * @returns {SVGSVGElement}
 */
function createTimelineIcon(type) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.5');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('class', 'mt-0.5 size-5 shrink-0 text-ink-secondary');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', TIMELINE_ICONS[type] ?? '');
    icon.appendChild(path);

    return icon;
}

/**
 * Una entrada: hora, icono del tipo, y el dato en una línea.
 *
 * La hora va en IBM Plex Mono y con ancho fijo para que la columna quede alineada entre entradas:
 * un día con seis registros se recorre con la vista por esa columna.
 *
 * @param {{type: string, typeLabel: string, summary: string, detail: string|null, occurredAt: string}} entry
 * @returns {HTMLLIElement}
 */
function createTimelineEntry(entry) {
    const row = document.createElement('li');
    /** El mismo separador entre filas que el historial de las pantallas por tipo (`insulinPage.js`). */
    row.className = 'flex min-h-11 items-start gap-3 border-b border-border py-2 last:border-b-0';

    const time = document.createElement('span');
    time.className = 'w-14 shrink-0 pt-0.5 font-mono text-body-sm text-ink-secondary';
    time.textContent = formatTimeOfDay(entry.occurredAt);
    row.appendChild(time);

    row.appendChild(createTimelineIcon(entry.type));

    const line = document.createElement('p');
    line.className = 'text-body-sm text-ink';

    const label = document.createElement('span');
    label.className = 'font-semibold';
    label.textContent = entry.typeLabel;
    line.appendChild(label);

    /** El dato en el mismo renglón que el tipo: «Glucemia 112 mg/dL» se lee de una pasada. */
    if (entry.summary !== '') {
        const summary = document.createElement('span');
        summary.className = 'ml-2 font-mono';
        summary.textContent = entry.summary;
        line.appendChild(summary);
    }

    /**
     * El contexto (método, sitio, tipo de insulina, alimentos) en tinta secundaria: acompaña al dato
     * sin competir con él, pero está siempre, porque un número sin su método se lee mal (ADR 0008).
     */
    if (entry.detail !== null && entry.detail !== '') {
        const detail = document.createElement('span');
        detail.className = 'ml-2 text-ink-secondary';
        detail.textContent = `· ${entry.detail}`;
        line.appendChild(detail);
    }

    row.appendChild(line);

    return row;
}

/**
 * Un día: la fecha como encabezado y sus entradas debajo.
 *
 * @param {{occurredAt: string, entries: list<object>}} day
 * @returns {HTMLDivElement}
 */
function createTimelineDay(day) {
    const section = document.createElement('div');
    section.className = 'border-t border-border pt-3 first:border-t-0 first:pt-0';

    const heading = document.createElement('h3');
    heading.className = 'font-display text-body-sm font-semibold text-ink';
    heading.textContent = formatDayHeading(day.occurredAt);
    section.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'mt-1';

    for (const entry of day.entries) {
        list.appendChild(createTimelineEntry(entry));
    }

    section.appendChild(list);

    return section;
}

/**
 * Sección de la línea temporal, agrupada por día.
 *
 * `emptyStateUrl` es **opcional y llega como argumento**: en el panel del paciente lleva a crear el
 * primer registro (la ruta la decide Filament y viaja en un `data-*`), y en el lector del
 * profesional no hay ninguna pantalla a la que enviarle, así que sin ella se pinta solo la frase.
 *
 * `emptyText` es igual de opcional y existe por un motivo más serio: la frase de serie —«todavía no
 * hay registros en este periodo»— afirma una ausencia clínica, y quien vacía la lista puede ser el
 * buscador. Decir «no hay registros» cuando lo que hay es un filtro puesto es exactamente la lectura
 * que este proyecto no puede permitirse, así que la pantalla que llama dice cuál de las dos cosas
 * está pasando.
 *
 * @param {list<object>} events Eventos descifrados y aplanados, ya filtrados por periodo y por tipo.
 * @param {{emptyStateUrl?: string|null, emptyText?: string}} [options]
 * @returns {DocumentFragment}
 */
export function renderTimelineSection(events, { emptyStateUrl = null, emptyText } = {}) {
    const fragment = document.createDocumentFragment();
    const { entries, hidden, unsupported } = buildTimeline(events);

    if (unsupported > 0) {
        const notice = createCallout('info', t('dashboard.timeline.unsupported', { count: unsupported }));
        notice.classList.add('mb-4');
        fragment.appendChild(notice);
    }

    if (entries.length === 0) {
        fragment.appendChild(renderEmptyState(emptyText ?? t('dashboard.empty'), emptyStateUrl, t('dashboard.addFirst')));

        return fragment;
    }

    if (hidden > 0) {
        const notice = createCallout('info', t('dashboard.timeline.capped', {
            count: hidden,
            shown: entries.length,
        }));
        notice.classList.add('mb-4');
        fragment.appendChild(notice);
    }

    const days = document.createElement('div');
    days.className = 'space-y-4';

    for (const day of groupEntriesByDay(entries)) {
        days.appendChild(createTimelineDay(day));
    }

    fragment.appendChild(days);

    return fragment;
}
