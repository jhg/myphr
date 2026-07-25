/**
 * Estadísticas del panel de salud (ADR 0006, ADR 0007, ADR 0008).
 *
 * Lógica pura: nada de DOM, Chart.js ni Livewire, para poder probarla sin montar nada
 * (`tests/js/statistics.test.mjs`). Todo el cálculo ocurre en el navegador sobre eventos ya
 * descifrados, porque el servidor no puede leerlos (ADR 0002, ADR 0006).
 *
 * **Forma de entrada.** Cada evento es el contenido ya descifrado del sobre (ADR 0006:
 * `{v, type, tz, data: {...}}`) más el instante en que ocurrió, aplanado en el mismo objeto:
 * `{v, type, tz, data: {...}, occurredAt: '2026-07-25T09:08:07.000000Z'}`. `occurredAt` es la
 * fecha canónica del ADR 0004, la misma que trae `openEvent` (`resources/js/health/eventEnvelope.js`).
 *
 * **El método de medición no se mezcla en silencio** (ADR 0008): toda función de resumen agrupa
 * por `data.method` antes de calcular nada, y devuelve las claves que agrupó para que la vista
 * pueda decir siempre qué métodos incluye un número.
 *
 * **No se convierte entre unidades.** La glucemia se resume para una única unidad de
 * presentación, y los eventos en otra unidad se cuentan aparte en vez de mezclarse (ADR 0007:
 * "promediar mg/dL con mmol/L sin convertir da un número sin sentido"; convertir exige fijar
 * precisión y redondeo, decisión clínica que ningún ADR ha tomado todavía).
 *
 * **Precisión de los cálculos.** Los valores llegan como cadena (ADR 0004: decimales como
 * cadena) y se convierten a número solo para calcular. La media, la mediana y el porcentaje en
 * rango que devuelven estas funciones son números JavaScript, no cadenas: no son el dato en
 * reposo del ADR 0004, sino un resultado derivado y efímero que la vista formatea. Para que ese
 * resultado sea reproducible se fija aquí una precisión, no se deja al azar de cómo sume cada
 * navegador: media y mediana con dos decimales (`STAT_DECIMALS`), redondeo "half away from
 * zero"; el porcentaje en rango, con un decimal. No es una decisión clínica (no interpreta si el
 * número es bueno o malo), es solo la precisión de la presentación.
 */

/** Duración de las dos ventanas del panel, en días. */
export const WINDOW_DAYS = Object.freeze({ week: 7, month: 30 });

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Decimales fijos para media y mediana (ver JSDoc del módulo). */
const STAT_DECIMALS = 2;

/** Decimales fijos para el porcentaje en rango. */
const PERCENT_DECIMALS = 1;

/**
 * Redondea a un número fijo de decimales.
 *
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
function round(value, decimals) {
    const factor = 10 ** decimals;

    return Math.round(value * factor) / factor;
}

/**
 * Convierte una cadena de valor a número finito, o `null` si no representa uno.
 *
 * Cubre a la vez dos motivos de descarte: un resultado cualitativo (ADR 0008, tira de orina),
 * que no trae `data.value` sino `data.result`, y un valor mal formado que no debe tumbar el
 * resumen (robustez pedida explícitamente).
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
function toFiniteNumber(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
        return null;
    }

    const value = Number(raw);

    return Number.isFinite(value) ? value : null;
}

/**
 * @param {string} occurredAt Fecha canónica ISO (ADR 0004).
 * @returns {number} Milisegundos desde epoch, o `NaN` si `occurredAt` no se pudo interpretar.
 */
function toEpochMs(occurredAt) {
    return Date.parse(occurredAt);
}

/**
 * ¿Cae `occurredAt` en la ventana de `windowDays` días terminada en `referenceInstant`?
 *
 * **Límites inclusivos en ambos extremos**: `[referenceInstant - windowDays días,
 * referenceInstant]`. Se fija así, y no con un límite abierto, para que el resumen no cambie
 * según la hora del día en que se abre el panel: con el límite inferior inclusivo, un evento
 * registrado hace exactamente `windowDays` días completos sigue contando igual a las 00:00 que a
 * las 23:59. Nada posterior al instante de referencia entra, aunque exista en la lista (evita que
 * un reloj de dispositivo adelantado cuente eventos "futuros").
 *
 * @param {string} occurredAt
 * @param {number} referenceEpochMs
 * @param {number} windowDays
 * @returns {boolean}
 */
export function isWithinWindow(occurredAt, referenceEpochMs, windowDays) {
    const epochMs = toEpochMs(occurredAt);

    if (Number.isNaN(epochMs)) {
        return false;
    }

    const lowerBoundMs = referenceEpochMs - (windowDays * MS_PER_DAY);

    return epochMs >= lowerBoundMs && epochMs <= referenceEpochMs;
}

/**
 * Filtra `events` a los que caen en una ventana de `windowDays` días terminada en
 * `referenceInstant`. Ver `isWithinWindow` para el criterio exacto de los límites.
 *
 * @param {list<{occurredAt: string}>} events
 * @param {Date|string|number} referenceInstant Instante de referencia ("ahora" del panel).
 * @param {number} windowDays
 * @returns {list<object>}
 */
export function filterByWindow(events, referenceInstant, windowDays) {
    const referenceEpochMs = new Date(referenceInstant).getTime();

    return events.filter((event) => isWithinWindow(event.occurredAt, referenceEpochMs, windowDays));
}

/**
 * Las dos ventanas que resume el panel: última semana y último mes, ambas terminadas en
 * `referenceInstant` con los límites inclusivos de `isWithinWindow`.
 *
 * @param {list<{occurredAt: string}>} events
 * @param {Date|string|number} referenceInstant
 * @returns {{week: list<object>, month: list<object>}}
 */
export function windowEvents(events, referenceInstant) {
    return {
        week: filterByWindow(events, referenceInstant, WINDOW_DAYS.week),
        month: filterByWindow(events, referenceInstant, WINDOW_DAYS.month),
    };
}

/**
 * Media y mediana de una lista de números, con la precisión fija del módulo.
 *
 * La mediana de un número par de muestras es el promedio de las dos centrales (con la lista ya
 * ordenada), como cualquier definición estándar; con un número impar es la muestra central.
 *
 * @param {list<number>} numbers No vacía.
 * @returns {{mean: number, median: number}}
 */
function meanAndMedian(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    const mean = sum / sorted.length;

    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;

    return { mean: round(mean, STAT_DECIMALS), median: round(median, STAT_DECIMALS) };
}

/**
 * Resumen de glucemia de un periodo, agrupado por método de medición (ADR 0008) dentro de una
 * única unidad de presentación (ADR 0007: no se convierte entre unidades).
 *
 * Se descartan, sin tumbar el resumen: los eventos que no son de tipo `glucose`; los resultados
 * cualitativos (tira de orina, ADR 0008: "no entran en estadísticas de rango ni tienen
 * promedio"), que no traen `data.value` numérico; y cualquier valor no numérico. Todos suman al
 * mismo contador `discarded`, porque de cara al resumen son el mismo caso: no hay número que
 * calcular.
 *
 * Los eventos en otra unidad que `unit` se cuentan aparte en `excludedByUnit` y no entran en
 * ningún grupo, para que la vista pueda decirlo (ADR 0007).
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events Eventos de un periodo
 *        (semana o mes), ya filtrados por ventana con `filterByWindow`/`windowEvents`.
 * @param {object} params
 * @param {string} params.unit Unidad de presentación (código UCUM, p. ej. `"mg/dL"`).
 * @param {{low: string|number, high: string|number}} [params.targetRange] Rango objetivo
 *        configurado por el usuario (ADR 0007). **Si no se pasa, ningún grupo lleva
 *        `inRangePercent`**: ni `null` ni `0`, la clave simplemente no está, porque la aplicación
 *        no trae rangos por defecto ni disfraza su ausencia de dato.
 * @returns {{
 *   byMethod: Record<string, {
 *     count: number, mean: number, median: number, min: number, max: number,
 *     last: {value: number, occurredAt: string}, inRangePercent?: number
 *   }>,
 *   excludedByUnit: number,
 *   discarded: number,
 * }}
 */
export function summarizeGlucosePeriod(events, { unit, targetRange } = {}) {
    /** @type {Record<string, list<{value: number, occurredAt: string}>>} */
    const readingsByMethod = {};
    let excludedByUnit = 0;
    let discarded = 0;

    for (const event of events) {
        if (event.type !== 'glucose') {
            continue;
        }

        const value = toFiniteNumber(event.data?.value);

        if (value === null) {
            discarded += 1;

            continue;
        }

        if (event.data.unit !== unit) {
            excludedByUnit += 1;

            continue;
        }

        const method = event.data.method;

        (readingsByMethod[method] ??= []).push({ value, occurredAt: event.occurredAt });
    }

    const hasTargetRange = targetRange !== undefined && targetRange !== null;
    const low = hasTargetRange ? Number(targetRange.low) : null;
    const high = hasTargetRange ? Number(targetRange.high) : null;

    /** @type {Record<string, object>} */
    const byMethod = {};

    for (const [method, readings] of Object.entries(readingsByMethod)) {
        const values = readings.map((reading) => reading.value);
        const { mean, median } = meanAndMedian(values);
        const last = readings.reduce((latest, reading) => (
            toEpochMs(reading.occurredAt) > toEpochMs(latest.occurredAt) ? reading : latest
        ));

        const summary = {
            count: readings.length,
            mean,
            median,
            min: Math.min(...values),
            max: Math.max(...values),
            last,
        };

        if (hasTargetRange) {
            const inRangeCount = values.filter((value) => value >= low && value <= high).length;
            summary.inRangePercent = round((inRangeCount / values.length) * 100, PERCENT_DECIMALS);
        }

        byMethod[method] = summary;
    }

    return { byMethod, excludedByUnit, discarded };
}

/**
 * `summarizeGlucosePeriod` aplicado a las dos ventanas del panel a la vez.
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events Todos los eventos ya
 *        descifrados, sin filtrar por ventana todavía (el filtro lo hace esta función).
 * @param {Date|string|number} referenceInstant
 * @param {object} params Ver `summarizeGlucosePeriod`.
 * @param {string} params.unit
 * @param {{low: string|number, high: string|number}} [params.targetRange]
 * @returns {{week: object, month: object}}
 */
export function summarizeGlucose(events, referenceInstant, params) {
    const { week, month } = windowEvents(events, referenceInstant);

    return {
        week: summarizeGlucosePeriod(week, params),
        month: summarizeGlucosePeriod(month, params),
    };
}

/**
 * Estadísticas de una sola magnitud (sistólica, diastólica o pulso) dentro de un grupo.
 *
 * @param {list<{value: number, occurredAt: string}>} readings
 * @returns {{mean: number, median: number, min: number, max: number, last: number}}
 */
function magnitudeSummary(readings) {
    const values = readings.map((reading) => reading.value);
    const { mean, median } = meanAndMedian(values);
    const last = readings.reduce((latest, reading) => (
        toEpochMs(reading.occurredAt) > toEpochMs(latest.occurredAt) ? reading : latest
    ));

    return { mean, median, min: Math.min(...values), max: Math.max(...values), last: last.value };
}

/**
 * Resumen de tensión arterial de un periodo, agrupado por método (brazo y postura, ADR 0008: un
 * único token por evento, p. ej. `left_sitting`).
 *
 * Un evento de tensión es uno solo con sistólica, diastólica y pulso juntos (ADR 0006): si a
 * cualquiera de las tres le falta un valor numérico, se descarta el evento entero en vez de
 * calcular con datos parciales, y cuenta como descartado sin tumbar el resumen.
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events Eventos de un periodo,
 *        ya filtrados por ventana.
 * @returns {{
 *   byMethod: Record<string, {
 *     systolic: {mean: number, median: number, min: number, max: number, last: number},
 *     diastolic: {mean: number, median: number, min: number, max: number, last: number},
 *     pulse: {mean: number, median: number, min: number, max: number, last: number},
 *     count: number,
 *     lastReading: {systolic: number, diastolic: number, pulse: number, occurredAt: string},
 *   }>,
 *   discarded: number,
 * }}
 */
export function summarizeBloodPressurePeriod(events) {
    /** @type {Record<string, list<{systolic: number, diastolic: number, pulse: number, occurredAt: string}>>} */
    const readingsByMethod = {};
    let discarded = 0;

    for (const event of events) {
        if (event.type !== 'bloodPressure') {
            continue;
        }

        const systolic = toFiniteNumber(event.data?.systolic);
        const diastolic = toFiniteNumber(event.data?.diastolic);
        const pulse = toFiniteNumber(event.data?.pulse);

        if (systolic === null || diastolic === null || pulse === null) {
            discarded += 1;

            continue;
        }

        const method = event.data.method;

        (readingsByMethod[method] ??= []).push({ systolic, diastolic, pulse, occurredAt: event.occurredAt });
    }

    /** @type {Record<string, object>} */
    const byMethod = {};

    for (const [method, readings] of Object.entries(readingsByMethod)) {
        const lastReading = readings.reduce((latest, reading) => (
            toEpochMs(reading.occurredAt) > toEpochMs(latest.occurredAt) ? reading : latest
        ));

        byMethod[method] = {
            systolic: magnitudeSummary(readings.map((r) => ({ value: r.systolic, occurredAt: r.occurredAt }))),
            diastolic: magnitudeSummary(readings.map((r) => ({ value: r.diastolic, occurredAt: r.occurredAt }))),
            pulse: magnitudeSummary(readings.map((r) => ({ value: r.pulse, occurredAt: r.occurredAt }))),
            count: readings.length,
            lastReading,
        };
    }

    return { byMethod, discarded };
}

/**
 * `summarizeBloodPressurePeriod` aplicado a las dos ventanas del panel a la vez.
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events
 * @param {Date|string|number} referenceInstant
 * @returns {{week: object, month: object}}
 */
export function summarizeBloodPressure(events, referenceInstant) {
    const { week, month } = windowEvents(events, referenceInstant);

    return {
        week: summarizeBloodPressurePeriod(week),
        month: summarizeBloodPressurePeriod(month),
    };
}
