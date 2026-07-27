/**
 * La curva de glucemia con las marcas de comida y de insulina encima (ADR 0004, ADR 0006, ADR 0007,
 * ADR 0008).
 *
 * **Por qué es la gráfica que más importa.** Ninguna pantalla por tipo puede enseñar la relación
 * entre comer, pincharse y lo que hace la glucosa después, y es exactamente lo que se mira en una
 * consulta: no «cómo fue la media de ayer», sino «qué pasó a las dos horas de aquella comida». Sale
 * además casi gratis en peticiones: el servidor no puede filtrar por tipo (ADR 0006), así que la
 * petición que ya se hace para el resumen baja los tres tipos del periodo.
 *
 * Lógica pura: ni DOM ni Chart.js, para poder probarla sin montar nada
 * (`tests/js/glucoseContext.test.mjs`). Quien la pinta es `health/glucoseContextChart.js`.
 *
 * Decisiones que este módulo implementa y que no le corresponde revisar:
 *
 * - **Una serie por método de medición** (ADR 0008): una glucemia capilar y una intersticial no son
 *   el mismo dato y no comparten línea.
 * - **Las horas sin lecturas van como hueco**, jamás como cero ({@see MAX_READING_GAP_MS}): un cero
 *   es una lectura, y una falsa. Y una línea recta de doce horas entre dos puntos afirma un
 *   recorrido que nadie midió.
 * - **No se convierte entre unidades** (ADR 0007): se dibuja una sola unidad y lo demás se cuenta en
 *   `excludedByUnit` para que el pie lo declare.
 * - **La hora es la del reloj de quien registró** ({@see eventWallClockMs}), no la del navegador que
 *   mira.
 * - **Nada se recorta en silencio**: lo que no cabe se cuenta en `omittedReadings`,
 *   `omittedMarkers` y `groupedMarkers`.
 */

import { eventWallClockMs } from './dailyBands.js';
import { catalogLabel, formatMeasuredValue, INSULIN_TYPE_KEYS, MEAL_TYPE_KEYS } from './eventLabels.js';
import { t } from '../i18n/index.js';
import { toFiniteNumber } from './statistics.js';

/**
 * Tope de lecturas dibujadas.
 *
 * Un sensor intersticial deja una lectura cada cinco minutos: un mes son más de ocho mil puntos, que
 * es una mancha antes que una curva. Cuando se pasa se conservan las **más recientes** y se dice
 * cuántas quedaron fuera, porque un recorte callado se lee como «antes no había nada».
 */
export const MAX_CONTEXT_READINGS = 1500;

/**
 * Hueco a partir del cual la línea se interrumpe.
 *
 * No es un umbral clínico, es de honestidad gráfica: entre dos lecturas separadas ocho horas no hay
 * ninguna medición, así que unirlas con un segmento dibujaría una glucemia nocturna que nadie tomó.
 * Seis horas deja unidas las lecturas de un día normal (antes y después de cada comida) y parte la
 * noche, que es justo el tramo del que no se sabe nada.
 */
export const MAX_READING_GAP_MS = 6 * 3_600_000;

/**
 * Ventana inicial para agrupar marcas vecinas, y tope de marcas dibujadas.
 *
 * Con muchos eventos las marcas se convierten en una valla ilegible pegada al eje. La salida no es
 * esconderlas: es agrupar las que caen juntas en una sola marca que dice cuántas lleva dentro
 * ({@see clusterMarkers}), y declarar el total agrupado en el pie.
 */
export const MARKER_CLUSTER_MS = 20 * 60_000;
export const MAX_MARKERS = 90;

/** Tope de la ventana de agrupación: más de tres horas ya no es «lo que pasó a la vez». */
const MAX_CLUSTER_MS = 3 * 3_600_000;

/** Cuántas etiquetas concretas guarda una marca agrupada; el resto se cuenta, no se enumera. */
const MAX_CLUSTER_ITEMS = 4;

/**
 * Etiqueta de una comida: el tipo de comida, que es lo que se lee de un vistazo. Qué se comió está
 * en la línea temporal, que es donde cabe.
 *
 * @param {object} data Sobre descifrado del evento.
 * @returns {string}
 */
function mealLabel(data) {
    return catalogLabel(MEAL_TYPE_KEYS, data?.mealType) || t('dashboard.timeline.type.meal');
}

/**
 * Etiqueta de una inyección: **la dosis con su unidad**, que es el dato que la marca tiene que
 * llevar, y el tipo de insulina detrás cuando el sobre lo trae.
 *
 * Una inyección sin dosis legible sigue siendo una inyección y se dibuja igual: lo que ocurrió
 * ocurrió, y esconder la marca por un campo que falta borraría el pinchazo de la gráfica.
 *
 * @param {object} data
 * @returns {string}
 */
function insulinLabel(data) {
    const dose = formatMeasuredValue(data?.dose);
    const type = catalogLabel(INSULIN_TYPE_KEYS, data?.insulinType);

    if (dose === '') {
        return { label: type || t('dashboard.timeline.type.insulin'), short: '' };
    }

    const measured = t('dashboard.timeline.measurement', { value: dose, unit: data?.unit ?? '' });

    /**
     * `short` es lo que se escribe **junto a la marca** cuando caben pocas: la dosis, que es el dato
     * que la marca de insulina tiene que llevar encima sin obligar a pasar el ratón por ella.
     */
    return { label: type === '' ? measured : `${measured} · ${type}`, short: measured };
}

/**
 * Agrupa marcas del mismo tipo que caen dentro de una misma ventana.
 *
 * La marca resultante se coloca en el instante de la **primera** del grupo y no en el promedio: un
 * promedio inventaría un instante en el que no ocurrió nada. Lo que lleva dentro se dice en el
 * detalle y en el recuento.
 *
 * @param {list<{x: number, label: string, short: string}>} marks Ya ordenadas por instante.
 * @param {number} window Milisegundos.
 * @returns {list<{x: number, count: number, items: list<string>, short: string}>}
 */
function clusterMarkers(marks, window) {
    /** @type {list<{x: number, count: number, items: list<string>, short: string}>} */
    const clusters = [];

    for (const mark of marks) {
        const last = clusters[clusters.length - 1];

        if (last !== undefined && mark.x - last.x <= window) {
            last.count += 1;

            if (last.items.length < MAX_CLUSTER_ITEMS) {
                last.items.push(mark.label);
            }

            continue;
        }

        clusters.push({ x: mark.x, count: 1, items: [mark.label], short: mark.short });
    }

    return clusters;
}

/**
 * Agrupa hasta que caben, ensanchando la ventana. Devuelve las marcas agrupadas de los dos tipos.
 *
 * @param {Record<string, list<{x: number, label: string}>>} byKind
 * @returns {{markers: list<object>, grouped: number}}
 */
function foldMarkers(byKind) {
    const total = Object.values(byKind).reduce((count, marks) => count + marks.length, 0);
    let window = MARKER_CLUSTER_MS;
    let markers = [];

    do {
        markers = Object.entries(byKind).flatMap(([kind, marks]) => clusterMarkers(marks, window)
            .map((cluster) => ({ kind, ...cluster })));
        window *= 2;
    } while (markers.length > MAX_MARKERS && window <= MAX_CLUSTER_MS);

    return { markers, grouped: total - markers.length };
}

/**
 * Parte una serie ordenada allí donde el hueco entre dos lecturas se pasa de {@see MAX_READING_GAP_MS}.
 *
 * El corte se hace con un punto de valor `null` en medio, que es lo que Chart.js dibuja como
 * interrupción con `spanGaps` en falso.
 *
 * @param {list<{x: number, y: number}>} points
 * @returns {list<{x: number, y: number|null}>}
 */
function splitOnGaps(points) {
    const withGaps = [];

    for (const [index, point] of points.entries()) {
        const previous = points[index - 1];

        if (previous !== undefined && point.x - previous.x > MAX_READING_GAP_MS) {
            withGaps.push({ x: (previous.x + point.x) / 2, y: null });
        }

        withGaps.push(point);
    }

    return withGaps;
}

/**
 * Construye la curva de glucemia del periodo y las marcas de comida e insulina que la acompañan.
 *
 * @param {list<{type: string, tz?: string, occurredAt: string, data: object}>} events Eventos ya
 *        descifrados del periodo, de **todos** los tipos: de ahí salen las marcas.
 * @param {object} params
 * @param {string} [params.unit] Unidad de presentación de glucemia (ADR 0007). Lo que esté en otra
 *        se cuenta en `excludedByUnit` y no se dibuja.
 * @param {number} [params.maxReadings]
 * @returns {{
 *   series: list<{group: string, points: list<{x: number, y: number|null}>}>,
 *   markers: list<{kind: string, x: number, count: number, items: list<string>, short: string}>,
 *   excludedByUnit: number,
 *   discarded: number,
 *   omittedReadings: number,
 *   omittedMarkers: number,
 *   groupedMarkers: number,
 * }}
 */
export function buildGlucoseContext(events, { unit, maxReadings = MAX_CONTEXT_READINGS } = {}) {
    /** @type {list<{x: number, y: number, group: string}>} */
    const readings = [];
    /** @type {Record<string, list<{x: number, label: string}>>} */
    const byKind = { meal: [], insulin: [] };
    let excludedByUnit = 0;
    let discarded = 0;

    for (const event of events) {
        const at = eventWallClockMs(event?.occurredAt, event?.tz);

        if (event?.type === 'glucose') {
            const value = toFiniteNumber(event.data?.value);

            if (value === null || at === null) {
                discarded += 1;
            } else if (unit !== undefined && unit !== null && event.data?.unit !== unit) {
                excludedByUnit += 1;
            } else {
                readings.push({ x: at, y: value, group: event.data?.method ?? '' });
            }

            continue;
        }

        if (event?.type !== 'meal' && event?.type !== 'insulin') {
            continue;
        }

        if (at === null) {
            discarded += 1;

            continue;
        }

        byKind[event.type].push(event.type === 'meal'
            ? { x: at, label: mealLabel(event.data), short: '' }
            : { x: at, ...insulinLabel(event.data) });
    }

    readings.sort((left, right) => left.x - right.x);

    /** Se conservan las lecturas más recientes: el tramo que se está mirando es el del final. */
    const kept = readings.slice(-maxReadings);
    const omittedReadings = readings.length - kept.length;

    if (kept.length === 0) {
        return {
            series: [],
            markers: [],
            excludedByUnit,
            discarded,
            omittedReadings,
            omittedMarkers: 0,
            groupedMarkers: 0,
        };
    }

    /**
     * Las marcas anteriores a la primera lectura dibujada caerían fuera del eje. No se tiran en
     * silencio: se cuentan, porque una comida que no se ve es una comida que el ojo da por no
     * ocurrida.
     */
    const from = kept[0].x;
    let omittedMarkers = 0;

    for (const kind of Object.keys(byKind)) {
        const visible = byKind[kind].filter((mark) => mark.x >= from);

        omittedMarkers += byKind[kind].length - visible.length;
        byKind[kind] = visible.sort((left, right) => left.x - right.x);
    }

    /** @type {Map<string, list<{x: number, y: number}>>} */
    const byGroup = new Map();

    for (const reading of kept) {
        if (!byGroup.has(reading.group)) {
            byGroup.set(reading.group, []);
        }

        byGroup.get(reading.group).push({ x: reading.x, y: reading.y });
    }

    /** Orden estable por token, igual que en `dailyBands.js`: el color de un método no puede bailar. */
    const series = [...byGroup.keys()].sort((a, b) => a.localeCompare(b))
        .map((group) => ({ group, points: splitOnGaps(byGroup.get(group)) }));

    const { markers, grouped } = foldMarkers(byKind);

    return {
        series,
        markers: markers.sort((left, right) => left.x - right.x),
        excludedByUnit,
        discarded,
        omittedReadings,
        omittedMarkers,
        groupedMarkers: grouped,
    };
}
