/**
 * Series diarias de mediana con banda de mínimo y máximo (ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * Lógica pura: nada de DOM ni de Chart.js, para poder probarla sin montar nada
 * (`tests/js/dailyBands.test.mjs`). Quien la pinta es `health/medianBandChart.js`; quien la alimenta
 * es el panel de inicio, con los eventos que ya tiene descifrados en memoria.
 *
 * **Por qué la mediana y no la media.** Un día con una hipoglucemia y cinco lecturas normales tiene
 * una media arrastrada por el valor extremo; la mediana dice cómo fue el día típico y la banda dice
 * hasta dónde llegó. Las dos cosas juntas responden a la pregunta que se lleva haciendo el proyecto
 * desde el principio —«¿cómo voy?»— sin esconder el extremo, que es lo que haría una media a secas.
 *
 * Decisiones que este módulo implementa y que no le corresponde revisar:
 *
 * - **Una serie por método de medición** (ADR 0008): una glucemia capilar y una intersticial no son
 *   el mismo dato, así que no comparten línea ni banda. El campo que agrupa lo dice quien llama
 *   (`groupBy`), igual que en `statistics.js`.
 * - **Los días sin lecturas van como hueco**, nunca como cero: un cero es una lectura, y una falsa.
 *   Por eso `days` cubre el tramo completo entre el primer y el último día con datos, y los días sin
 *   nada llevan `null` en todas las series, que es lo que Chart.js dibuja como interrupción.
 * - **Un día con una sola lectura colapsa la banda a un punto** (mediana = mínimo = máximo), y está
 *   bien que se vea así: es exactamente lo que se sabe de ese día.
 * - **No se convierte entre unidades** (ADR 0007): se construye la serie de una única unidad y lo
 *   demás se cuenta en `excludedByUnit` para que la vista pueda decirlo.
 * - **El día se calcula con la zona horaria del propio evento**, no con la del navegador que mira
 *   ({@see eventDayKey}).
 */

import { medianOf, toFiniteNumber } from './statistics.js';

/**
 * Tope de días del eje.
 *
 * El eje se rellena día a día para que los huecos sean huecos de verdad, así que un periodo de
 * «todos los registros» sobre varios años pediría miles de etiquetas y otros tantos puntos por
 * serie: la gráfica se vuelve ilegible mucho antes de volverse lenta. Cuando el tramo se pasa se
 * conservan los días **más recientes** y se devuelve cuántos quedaron fuera (`omittedDays`), que la
 * vista declara en el pie: un recorte silencioso haría leer «no hay nada antes» donde sí lo hay.
 */
export const MAX_CHART_DAYS = 180;

/**
 * Separador de la clave compuesta grupo + magnitud.
 *
 * Es el carácter nulo y no un espacio ni un guion porque los tokens de catálogo son libres de llevar
 * cualquiera de los dos (`left_sitting` hoy, otro mañana): una clave que se pudiera partir mal
 * mezclaría dos series clínicas distintas en una sola línea.
 */
const SERIES_KEY_SEPARATOR = '\u0000';

/**
 * Día al que pertenece un evento, en la zona horaria **con la que se registró**.
 *
 * No vale el calendario de la máquina que mira: una cena de las 23:30 en Madrid se registró el día 4
 * para quien la comió, y abrir la aplicación desde otro huso la movería al día 5 sin que el dato
 * haya cambiado. Tampoco vale UTC a secas, porque el día que importa es el de la persona. El desfase
 * viaja dentro del propio sobre, en `tz` (ADR 0006), así que es el que manda.
 *
 * Sin `tz`, o con uno que no se entiende, se cae a UTC de forma explícita: es el único valor que no
 * depende del dispositivo desde el que se mire.
 *
 * @param {string} occurredAt Instante en forma canónica (ADR 0004).
 * @param {string} [tz] Desfase del tipo `+02:00`, `-05:30` o `Z`.
 * @returns {string} `YYYY-MM-DD`, o cadena vacía si el instante no se pudo interpretar.
 */
export function eventDayKey(occurredAt, tz) {
    const shifted = new Date(new Date(occurredAt).getTime() + tzOffsetMinutes(tz) * 60_000);

    if (Number.isNaN(shifted.getTime())) {
        return '';
    }

    return utcDayKey(shifted);
}

/**
 * @param {string} [tz] Desfase del tipo `+02:00`, `-05:30` o `Z`.
 * @returns {number} Minutos de desfase. Cero si no viene o no se entiende, nunca la zona local.
 */
export function tzOffsetMinutes(tz) {
    const match = /^([+-])(\d{2}):(\d{2})$/.exec(tz ?? '');

    if (match === null) {
        return 0;
    }

    const magnitude = Number(match[2]) * 60 + Number(match[3]);

    return match[1] === '-' ? -magnitude : magnitude;
}

/**
 * @param {Date} date
 * @returns {string} `YYYY-MM-DD` de los componentes UTC de la fecha.
 */
function utcDayKey(date) {
    const pad = (value) => String(value).padStart(2, '0');

    return [date.getUTCFullYear(), pad(date.getUTCMonth() + 1), pad(date.getUTCDate())].join('-');
}

/**
 * Todos los días de calendario entre dos claves, las dos incluidas.
 *
 * Se cuenta con `Date.UTC` y no con el calendario local: las claves ya vienen resueltas en la zona
 * del evento, y volver a interpretarlas en la del navegador las movería un día en cuanto el desfase
 * fuera negativo.
 *
 * @param {string} first `YYYY-MM-DD`.
 * @param {string} last `YYYY-MM-DD`, no anterior a `first`.
 * @returns {list<string>}
 */
export function enumerateDays(first, last) {
    const toUtc = (key) => {
        const [year, month, day] = key.split('-').map(Number);

        return Date.UTC(year, month - 1, day);
    };

    const days = [];
    const lastMs = toUtc(last);

    for (let cursor = toUtc(first); cursor <= lastMs; cursor += 86_400_000) {
        days.push(utcDayKey(new Date(cursor)));
    }

    return days;
}

/**
 * Construye las series diarias de un tipo de evento.
 *
 * Las claves de agrupación y de valor son las mismas que usa `statistics.js` para ese tipo, y es a
 * propósito: la tarjeta de estadísticas y la gráfica de al lado tienen que estar contando lo mismo.
 * Un tipo con varias magnitudes en el mismo evento (la tensión: sistólica y diastólica) pide varias
 * `valueKeys` y sale con una serie por magnitud dentro de cada grupo.
 *
 * Un evento entra entero o no entra: si le falta cualquiera de las magnitudes pedidas se cuenta en
 * `discarded` y no aporta a ninguna serie, igual que hace `summarizeBloodPressurePeriod`. Media
 * lectura no es una lectura.
 *
 * @param {list<{type: string, tz?: string, occurredAt: string, data: object}>} events Eventos ya
 *        descifrados y aplanados, del periodo elegido (lo acota el servidor, ADR 0006).
 * @param {object} params
 * @param {string} params.type Token del tipo de evento.
 * @param {list<string>} [params.valueKeys] Campos numéricos del sobre. Por defecto `['value']`.
 * @param {string} [params.groupBy] Campo que dice cómo se midió. Sin él, un único grupo `''`.
 * @param {string} [params.unit] Unidad de presentación; el resto se cuenta en `excludedByUnit`. Sin
 *        unidad no se excluye nada (tipos cuyo sobre no la lleva).
 * @returns {{
 *   days: list<string>,
 *   series: list<{
 *     group: string,
 *     valueKey: string,
 *     points: list<{median: number, min: number, max: number, count: number}|null>,
 *   }>,
 *   excludedByUnit: number,
 *   discarded: number,
 *   omittedDays: number,
 * }}
 */
export function buildDailyBands(events, { type, valueKeys = ['value'], groupBy, unit } = {}) {
    /** @type {Map<string, Map<string, list<number>>>} Serie → día → valores de ese día. */
    const readings = new Map();
    const dayKeys = new Set();
    let excludedByUnit = 0;
    let discarded = 0;

    for (const event of events) {
        if (event?.type !== type) {
            continue;
        }

        const values = valueKeys.map((valueKey) => toFiniteNumber(event.data?.[valueKey]));

        if (values.some((value) => value === null)) {
            discarded += 1;

            continue;
        }

        if (unit !== undefined && unit !== null && event.data?.unit !== unit) {
            excludedByUnit += 1;

            continue;
        }

        const day = eventDayKey(event.occurredAt, event.tz);

        if (day === '') {
            discarded += 1;

            continue;
        }

        dayKeys.add(day);

        const group = groupBy === undefined ? '' : (event.data?.[groupBy] ?? '');

        values.forEach((value, index) => {
            const seriesKey = [group, valueKeys[index]].join(SERIES_KEY_SEPARATOR);

            if (!readings.has(seriesKey)) {
                readings.set(seriesKey, new Map());
            }

            const byDay = readings.get(seriesKey);

            if (!byDay.has(day)) {
                byDay.set(day, []);
            }

            byDay.get(day).push(value);
        });
    }

    if (dayKeys.size === 0) {
        return { days: [], series: [], excludedByUnit, discarded, omittedDays: 0 };
    }

    const observed = [...dayKeys].sort();
    const spanned = enumerateDays(observed[0], observed[observed.length - 1]);
    const days = spanned.slice(-MAX_CHART_DAYS);

    /**
     * Orden estable de las series: por grupo (alfabético por token) y, dentro del grupo, en el orden
     * en que se pidieron las magnitudes. Sin esto, la gráfica repartiría los colores de otra forma
     * entre una carga y la siguiente, y el color de una serie clínica dejaría de significar nada.
     */
    const series = [...readings.keys()]
        .sort((a, b) => {
            const [groupA, keyA] = a.split(SERIES_KEY_SEPARATOR);
            const [groupB, keyB] = b.split(SERIES_KEY_SEPARATOR);

            return groupA.localeCompare(groupB) || valueKeys.indexOf(keyA) - valueKeys.indexOf(keyB);
        })
        .map((seriesKey) => {
            const [group, valueKey] = seriesKey.split(SERIES_KEY_SEPARATOR);
            const byDay = readings.get(seriesKey);

            return { group, valueKey, points: days.map((day) => dayPoint(byDay.get(day))) };
        });

    return { days, series, excludedByUnit, discarded, omittedDays: spanned.length - days.length };
}

/**
 * Punto de un día: mediana, mínimo y máximo, o hueco.
 *
 * Un día sin lecturas devuelve `null` —hueco—, nunca un cero: un cero es una lectura, y una falsa.
 * Un día con una sola lectura devuelve los tres valores iguales, y la banda se ve colapsada en un
 * punto, que es justo lo que se sabe de ese día.
 *
 * @param {list<number>|undefined} values
 * @returns {{median: number, min: number, max: number, count: number}|null}
 */
function dayPoint(values) {
    if (values === undefined) {
        return null;
    }

    return {
        median: medianOf(values),
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
    };
}
