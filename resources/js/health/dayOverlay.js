/**
 * Superposición de días sobre un eje de 24 horas: el perfil glucémico ambulatorio (ADR 0004,
 * ADR 0006, ADR 0007, ADR 0008).
 *
 * **Qué enseña que ninguna serie cronológica enseña.** Todas las lecturas del periodo caen sobre un
 * solo eje de 0 a 24 h, una línea translúcida por día, y encima la mediana de cada hora en trazo
 * grueso. Es el formato del informe estándar de consulta, y revela lo que se repite todos los días
 * —la subida de madrugada, el pico de después de comer— que en una línea de tiempo continua queda
 * disuelto entre semanas.
 *
 * Lógica pura: ni DOM ni Chart.js (`tests/js/dayOverlay.test.mjs`). Quien la pinta es
 * `health/dayOverlayChart.js`.
 *
 * Decisiones que implementa y que no le corresponde revisar:
 *
 * - **Una serie por método de medición** (ADR 0008): capilar e intersticial tienen cada una sus
 *   días y **su propia mediana horaria**; promediarlas juntas mezclaría dos formas de medir.
 * - **La hora del día es la del reloj de quien registró** ({@see eventWallClockMs}), no la del
 *   navegador que mira: con la del navegador, un desayuno en Madrid visto desde México aparecería
 *   de madrugada y el patrón diario que se busca aquí quedaría desplazado entero.
 * - **Las horas sin lecturas van como hueco**, nunca como cero: la mediana horaria de una hora sin
 *   lecturas no existe, y un cero sería una hipoglucemia inventada.
 * - **No se convierte entre unidades** (ADR 0007): se cuenta lo excluido en `excludedByUnit`.
 * - **Nada se recorta en silencio**: los días que no caben se cuentan en `omittedDays`.
 */

import { eventDayKey, eventWallClockMs } from './dailyBands.js';
import { medianOf, toFiniteNumber } from './statistics.js';

/**
 * Tope de días superpuestos.
 *
 * Cada día es una línea translúcida más; pasadas unas decenas, el fondo se satura y la mediana deja
 * de destacar sobre él, que es justo lo que hace legible este formato. Se conservan los días **más
 * recientes** y se dice cuántos quedaron fuera: un recorte callado se leería como «antes no había
 * nada». La mediana horaria se calcula solo con los días dibujados, para que la línea gruesa
 * describa exactamente la nube que hay debajo.
 */
export const MAX_OVERLAY_DAYS = 45;

const DAY_MS = 86_400_000;

/**
 * Hora del día, con decimales, en el reloj de quien registró el evento.
 *
 * @param {number} wallClockMs
 * @returns {number} Entre 0 y 24.
 */
export function hourOfDay(wallClockMs) {
    return (((wallClockMs % DAY_MS) + DAY_MS) % DAY_MS) / 3_600_000;
}

/**
 * Construye la superposición de días de un tipo de evento.
 *
 * @param {list<{type: string, tz?: string, occurredAt: string, data: object}>} events
 * @param {object} params
 * @param {string} [params.type] Token del tipo. Por defecto glucemia, que es para lo que existe este
 *        formato.
 * @param {string} [params.valueKey]
 * @param {string} [params.groupBy] Campo que dice cómo se midió. Sin él, un único grupo `''`.
 * @param {string} [params.unit] Unidad de presentación; lo demás se cuenta en `excludedByUnit`.
 * @param {number} [params.maxDays]
 * @returns {{
 *   groups: list<{
 *     group: string,
 *     days: list<{day: string, points: list<{x: number, y: number}>}>,
 *     median: list<{x: number, y: number|null}>,
 *   }>,
 *   dayCount: number,
 *   excludedByUnit: number,
 *   discarded: number,
 *   omittedDays: number,
 * }}
 */
export function buildDayOverlay(events, {
    type = 'glucose',
    valueKey = 'value',
    groupBy = 'method',
    unit,
    maxDays = MAX_OVERLAY_DAYS,
} = {}) {
    /** @type {list<{group: string, day: string, x: number, y: number}>} */
    const readings = [];
    const dayKeys = new Set();
    let excludedByUnit = 0;
    let discarded = 0;

    for (const event of events) {
        if (event?.type !== type) {
            continue;
        }

        const value = toFiniteNumber(event.data?.[valueKey]);
        const at = eventWallClockMs(event.occurredAt, event.tz);

        if (value === null || at === null) {
            discarded += 1;

            continue;
        }

        if (unit !== undefined && unit !== null && event.data?.unit !== unit) {
            excludedByUnit += 1;

            continue;
        }

        const day = eventDayKey(event.occurredAt, event.tz);

        dayKeys.add(day);
        readings.push({
            group: groupBy === undefined ? '' : (event.data?.[groupBy] ?? ''),
            day,
            x: hourOfDay(at),
            y: value,
        });
    }

    if (dayKeys.size === 0) {
        return { groups: [], dayCount: 0, excludedByUnit, discarded, omittedDays: 0 };
    }

    /**
     * A diferencia de la gráfica de bandas, aquí **no** se rellenan los días intermedios: el eje es
     * de horas y un día sin lecturas simplemente no aporta línea. Lo que sí se conserva es el tramo
     * más reciente, y se cuenta lo que queda fuera.
     */
    const observed = [...dayKeys].sort();
    const kept = new Set(observed.slice(-maxDays));

    /** @type {Map<string, Map<string, list<{x: number, y: number}>>>} Grupo → día → puntos. */
    const byGroup = new Map();

    for (const reading of readings) {
        if (!kept.has(reading.day)) {
            continue;
        }

        if (!byGroup.has(reading.group)) {
            byGroup.set(reading.group, new Map());
        }

        const byDay = byGroup.get(reading.group);

        if (!byDay.has(reading.day)) {
            byDay.set(reading.day, []);
        }

        byDay.get(reading.day).push({ x: reading.x, y: reading.y });
    }

    /** Orden estable por token, para que el color de un método no cambie entre dos cargas. */
    const groups = [...byGroup.keys()].sort((a, b) => a.localeCompare(b)).map((group) => {
        const byDay = byGroup.get(group);
        const days = [...byDay.keys()].sort().map((day) => ({
            day,
            points: byDay.get(day).sort((left, right) => left.x - right.x),
        }));

        return { group, days, median: hourlyMedian(days) };
    });

    return {
        groups,
        dayCount: kept.size,
        excludedByUnit,
        discarded,
        omittedDays: observed.length - kept.size,
    };
}

/**
 * Mediana de cada hora del día, con las 24 franjas siempre presentes.
 *
 * Una hora sin ninguna lectura sale con `y` a `null` —hueco—, jamás con un cero: en glucemia un cero
 * es una hipoglucemia mortal, así que dibujarlo donde no hubo medición no es un detalle estético.
 *
 * El punto se coloca en el **centro** de la franja (`hora + 0,5`) porque representa toda la hora, no
 * su comienzo; colocarlo al principio desplazaría media hora a la izquierda el pico que se busca.
 *
 * @param {list<{points: list<{x: number, y: number}>}>} days
 * @returns {list<{x: number, y: number|null}>}
 */
function hourlyMedian(days) {
    /** @type {list<list<number>>} */
    const buckets = Array.from({ length: 24 }, () => []);

    for (const day of days) {
        for (const point of day.points) {
            buckets[Math.min(23, Math.floor(point.x))].push(point.y);
        }
    }

    return buckets.map((values, hour) => ({
        x: hour + 0.5,
        y: values.length === 0 ? null : medianOf(values),
    }));
}
