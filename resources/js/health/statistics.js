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
 * antes de calcular nada por el campo que dice cómo se midió —`data.method` en glucemia y tensión,
 * `data.site` en temperatura, `data.insulinType` en insulina— y devuelve las claves que agrupó para
 * que la vista pueda decir siempre qué incluye un número.
 *
 * **Ya no se resumen ventanas fijas.** Estas funciones reciben los eventos del periodo que la
 * persona ha elegido, acotado por el servidor con `[from, to)` (`occurred_at` es columna en claro,
 * ADR 0006); aquí no se vuelve a recortar por fecha.
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

/**
 * Duración en días de los atajos de periodo relativos, comunes al panel de inicio y a las pantallas
 * de historial (`health/dateRange.js`, que los importa de aquí y no los copia).
 *
 * `day` es el periodo por defecto del panel de inicio: son las últimas 24 horas, no «el día de hoy»
 * desde medianoche, porque el resto de atajos también cuentan hacia atrás desde ahora y mezclar los
 * dos criterios haría que «último día» y «última semana» no midieran lo mismo.
 */
export const WINDOW_DAYS = Object.freeze({ day: 1, week: 7, month: 30 });

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
 * Se exporta porque la regla que aplica —el valor clínico viaja como cadena, con el punto como
 * separador decimal (ADR 0004)— es la misma para quien calcula estadísticas y para quien construye
 * las series de una gráfica (`health/dailyBands.js`). Duplicarla allí sería duplicar el criterio de
 * qué se descarta, que es justo lo que no puede divergir entre la tarjeta y la gráfica de al lado.
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
export function toFiniteNumber(raw) {
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
 * Media y mediana de una lista de números, con la precisión fija del módulo.
 *
 * La mediana de un número par de muestras es el promedio de las dos centrales (con la lista ya
 * ordenada), como cualquier definición estándar; con un número impar es la muestra central.
 *
 * @param {list<number>} numbers No vacía.
 * @returns {{mean: number, median: number}}
 */
function meanAndMedian(numbers) {
    const sum = numbers.reduce((total, value) => total + value, 0);

    return { mean: round(sum / numbers.length, STAT_DECIMALS), median: medianOf(numbers) };
}

/**
 * Mediana de una lista de números, con la misma precisión fija que el resto del módulo.
 *
 * Vive aquí y no en quien la necesita para que la mediana de una tarjeta de estadísticas y la de la
 * gráfica de al lado sean **el mismo número**: dos implementaciones con redondeos distintos darían
 * dos cifras para el mismo dato en la misma pantalla, y no hay forma de que quien lo lea sepa cuál
 * creer.
 *
 * @param {list<number>} numbers No vacía.
 * @returns {number}
 */
export function medianOf(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;

    return round(median, STAT_DECIMALS);
}

/**
 * Unidad con la que se resume un tipo de evento cuando la persona no la ha elegido en ninguna
 * parte: la del registro **más reciente** con valor numérico.
 *
 * La glucemia no pasa por aquí porque su unidad de presentación es un ajuste explícito del perfil
 * (ADR 0007). El peso, la temperatura y la insulina no tienen ese ajuste, y aun así no se pueden
 * promediar kilos con libras ni grados Celsius con Fahrenheit. Se toma la del último registro y no
 * la más frecuente porque es la que la persona está usando ahora: si acaba de cambiar de báscula,
 * el resumen habla de la báscula nueva y las lecturas en la unidad vieja se cuentan aparte
 * (`excludedByUnit`) en vez de desaparecer.
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events
 * @param {string} type
 * @param {string} [valueKey] Campo numérico del sobre (`value`, `dose`, ...).
 * @returns {string|null} `null` si no hay ningún registro utilizable de ese tipo.
 */
export function dominantUnit(events, type, valueKey = 'value') {
    let latest = null;

    for (const event of events) {
        if (event.type !== type || toFiniteNumber(event.data?.[valueKey]) === null) {
            continue;
        }

        if (typeof event.data.unit !== 'string' || event.data.unit === '') {
            continue;
        }

        if (latest === null || toEpochMs(event.occurredAt) > toEpochMs(latest.occurredAt)) {
            latest = event;
        }
    }

    return latest === null ? null : latest.data.unit;
}

/**
 * Unidad con la que se resume un tipo cuando lo que se mira es un **conjunto cerrado y ajeno**: la
 * de la **mayoría** de las lecturas, no la de la más reciente.
 *
 * {@see dominantUnit} elige por recencia y tiene razón en el panel del paciente: quien acaba de
 * cambiar de báscula quiere el resumen en la unidad que está usando ahora, y sabe que ha cambiado.
 * En un recorte compartido nadie sabe eso. Un paciente que estrena medidor, con dos lecturas en
 * mmol/L y doscientas anteriores en mg/dL, produciría una tarjeta «Recuento 2 · Media 7,4» y
 * mandaría las doscientas restantes a una nota al pie: el profesional leería un resumen de dos
 * lecturas creyendo que es el del recorte. Por mayoría, el resumen habla de las doscientas y las dos
 * quedan declaradas aparte, que es el error que sí se ve.
 *
 * Los empates se resuelven por la unidad más reciente, para no depender del orden del array.
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events
 * @param {string} type
 * @param {string} [valueKey] Campo numérico del sobre (`value`, `dose`, ...).
 * @returns {string|null} `null` si no hay ningún registro utilizable de ese tipo.
 */
export function majorityUnit(events, type, valueKey = 'value') {
    /** @type {Map<string, number>} */
    const counts = new Map();

    for (const event of events) {
        if (event.type !== type || toFiniteNumber(event.data?.[valueKey]) === null) {
            continue;
        }

        if (typeof event.data.unit !== 'string' || event.data.unit === '') {
            continue;
        }

        counts.set(event.data.unit, (counts.get(event.data.unit) ?? 0) + 1);
    }

    if (counts.size === 0) {
        return null;
    }

    const mostRecent = dominantUnit(events, type, valueKey);
    let winner = mostRecent;

    for (const [unit, count] of counts) {
        if (count > counts.get(winner) || (count === counts.get(winner) && unit === mostRecent)) {
            winner = unit;
        }
    }

    return winner;
}

/**
 * ¿Cuántas unidades distintas hay en las lecturas de un tipo?
 *
 * Sirve para decidir si la exclusión por unidad merece un aviso de verdad o una nota al pie: con una
 * sola unidad no hay nada que advertir, y con dos el número que se enseña describe a una parte del
 * recorte, no al recorte.
 *
 * @param {list<{type: string, data: object}>} events
 * @param {string} type
 * @param {string} [valueKey]
 * @returns {number}
 */
export function unitCount(events, type, valueKey = 'value') {
    const units = new Set();

    for (const event of events) {
        if (event.type !== type || toFiniteNumber(event.data?.[valueKey]) === null) {
            continue;
        }

        if (typeof event.data.unit === 'string' && event.data.unit !== '') {
            units.add(event.data.unit);
        }
    }

    return units.size;
}

/**
 * Resumen de un tipo de evento de **una sola magnitud numérica** (glucemia, peso, temperatura,
 * dosis de insulina) en un periodo, agrupado por el campo que distingue cómo se midió.
 *
 * Es el mismo cálculo para los cuatro, así que vive una sola vez: lo que cambia entre ellos es el
 * nombre del campo con el valor (`value`, `dose`) y el del campo que agrupa (`method`, `site`,
 * `insulinType`, o ninguno en el peso, que se mide de una única forma). Un tipo sin campo de
 * agrupación cae entero en el grupo `''`, y quien pinte decide no escribir ninguna cabecera.
 *
 * Las dos exclusiones son las mismas que ya documentaba la glucemia y por los mismos motivos: lo
 * que no trae número (`discarded`, incluidos los resultados cualitativos del ADR 0008) y lo que
 * está en otra unidad (`excludedByUnit`, ADR 0007: no se convierte).
 *
 * @param {list<{type: string, occurredAt: string, data: object}>} events Eventos del periodo, ya
 *        acotados por fecha (hoy lo hace el servidor con `[from, to)`, no el cliente).
 * @param {object} params
 * @param {string} params.type Token del tipo de evento (`glucose`, `bodyWeight`, ...).
 * @param {string} [params.valueKey] Campo numérico del sobre. Por defecto `value`.
 * @param {string} [params.groupBy] Campo de agrupación. Sin él, un único grupo `''`.
 * @param {string} params.unit Unidad con la que se resume; el resto se cuenta en `excludedByUnit`.
 * @param {{low: string|number, high: string|number}} [params.targetRange] Ver
 *        {@see summarizeGlucosePeriod}: **sin rango no hay clave `inRangePercent`**.
 * @returns {{
 *   byGroup: Record<string, {
 *     count: number, mean: number, median: number, min: number, max: number,
 *     last: {value: number, occurredAt: string}, inRangePercent?: number
 *   }>,
 *   excludedByUnit: number,
 *   discarded: number,
 * }}
 */
export function summarizeMeasurementPeriod(events, { type, valueKey = 'value', groupBy, unit, targetRange } = {}) {
    /** @type {Record<string, list<{value: number, occurredAt: string}>>} */
    const readingsByGroup = {};
    let excludedByUnit = 0;
    let discarded = 0;

    for (const event of events) {
        if (event.type !== type) {
            continue;
        }

        const value = toFiniteNumber(event.data?.[valueKey]);

        if (value === null) {
            discarded += 1;

            continue;
        }

        if (event.data.unit !== unit) {
            excludedByUnit += 1;

            continue;
        }

        const group = groupBy === undefined ? '' : (event.data[groupBy] ?? '');

        (readingsByGroup[group] ??= []).push({ value, occurredAt: event.occurredAt });
    }

    const hasTargetRange = targetRange !== undefined && targetRange !== null;
    const low = hasTargetRange ? Number(targetRange.low) : null;
    const high = hasTargetRange ? Number(targetRange.high) : null;

    /** @type {Record<string, object>} */
    const byGroup = {};

    for (const [group, readings] of Object.entries(readingsByGroup)) {
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

        byGroup[group] = summary;
    }

    return { byGroup, excludedByUnit, discarded };
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
 *        del periodo elegido, ya acotados por fecha por el servidor (`[from, to)`).
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
    /**
     * El cálculo es el genérico; lo único propio de la glucemia es cómo se llaman sus campos y que
     * la clave del resultado se siga llamando `byMethod`, que es lo que el ADR 0008 nombra y lo que
     * lee la vista.
     */
    const { byGroup, excludedByUnit, discarded } = summarizeMeasurementPeriod(events, {
        type: 'glucose',
        groupBy: 'method',
        unit,
        targetRange,
    });

    return { byMethod: byGroup, excludedByUnit, discarded };
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
 *        ya acotados por fecha por el servidor (`[from, to)`).
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
