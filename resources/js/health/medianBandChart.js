/**
 * Gráfica genérica de mediana diaria con banda de mínimo y máximo.
 *
 * **Por qué existe.** La glucemia y la tensión ya tenían gráfica, pero cada una dentro de su propia
 * pantalla y atada a su forma de agrupar. El panel de inicio pinta hasta cinco tipos a la vez y
 * cambia cuáles según el filtro, así que necesita una pieza que **reciba una serie y la pinte**, sin
 * saber si viene de una glucemia capilar, de un peso o de una temperatura timpánica. Esa es toda la
 * responsabilidad de este módulo: le entra lo que construye `health/dailyBands.js` y le sale un
 * lienzo dibujado y su leyenda.
 *
 * Lo que **no** hace, a propósito: no calcula nada (ni medianas ni extremos: ese cálculo vive una
 * sola vez, en `statistics.js` y `dailyBands.js`), no decide unidades ni etiquetas (se las dan
 * hechas y traducidas), y no toca los eventos descifrados.
 *
 * Reutiliza las dos piezas que ya resolvían lo suyo en las pantallas por tipo: `chartTheme.js` para
 * leer los colores del tema en el momento de dibujar —DESIGN.md § Charts — Dark exige que no haya
 * ni un color literal en el módulo— y `chartLegend.js` para pintar la leyenda en HTML fuera del
 * `<canvas>`, con su patrón de trazo y su marca, que es la segunda codificación que pide Do's #3.
 *
 * **La banda es relleno, no línea.** Se dibuja con dos series auxiliares —el máximo y el mínimo del
 * día— rellenando el hueco entre ellas, y las dos van sin borde ni puntos: la única línea con
 * marcadores es la mediana, que es el dato que se lee. Las auxiliares tampoco aparecen en la
 * leyenda; qué es la banda lo dice el pie en texto, que es donde tiene que estar para quien no ve la
 * gráfica.
 */

import Chart from 'chart.js/auto';

import { formatChartDay, formatNumber, t } from '../i18n/index.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, CHART_FONTS } from './chartTheme.js';

/**
 * Segunda codificación de cada serie, además del color (Do's #3): patrón de trazo y forma del punto.
 * Es la misma tabla que usan las pantallas de glucemia y tensión, para que una capilar se dibuje
 * igual aquí que allí.
 */
const SERIES_SHAPES = Object.freeze([
    Object.freeze({ borderDash: [], pointStyle: 'circle' }),
    Object.freeze({ borderDash: [6, 4], pointStyle: 'triangle' }),
    Object.freeze({ borderDash: [2, 3], pointStyle: 'rect' }),
]);

/**
 * Opacidad del relleno de la banda.
 *
 * La banda es contexto, no el dato: tiene que dejar leer la mediana que pasa por dentro y las líneas
 * de otras series que la cruzan. Con un relleno opaco, dos métodos con recorridos solapados se
 * taparían el uno al otro y la gráfica diría menos que la tabla de al lado.
 */
const BAND_ALPHA = 0.16;

Chart.defaults.font.family = CHART_FONTS.body;
Chart.defaults.font.size = 13;

/**
 * El mismo color con transparencia, para el relleno de la banda.
 *
 * Los tokens de tema son hexadecimales (`theme.css`, § Charts), que es el caso que se resuelve. Un
 * formato que no se sepa descomponer se devuelve **tal cual**: una banda opaca es fea, pero inventar
 * un color derivado sería salirse de la paleta de DESIGN.md, que es peor.
 *
 * @param {string} color
 * @param {number} alpha
 * @returns {string}
 */
export function withAlpha(color, alpha) {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());

    if (hex === null) {
        return color;
    }

    const digits = hex[1].length === 3
        ? [...hex[1]].map((digit) => digit + digit)
        : [hex[1].slice(0, 2), hex[1].slice(2, 4), hex[1].slice(4, 6)];

    const [red, green, blue] = digits.map((pair) => parseInt(pair, 16));

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * Conjuntos de datos de Chart.js para una serie: la banda (dos series auxiliares que se rellenan
 * entre sí) y la línea de medianas encima.
 *
 * El orden importa y no es cosmético: `fill: '-1'` rellena hasta el conjunto **anterior**, así que
 * el mínimo tiene que ir justo antes del máximo. La mediana va después para quedar dibujada por
 * encima del relleno.
 *
 * `spanGaps` se queda en falso —el valor de fábrica— en los tres: un día sin lecturas es un hueco, y
 * unir por encima de él dibujaría una línea que afirma algo que nadie midió.
 *
 * @param {{label: string, color: string, borderDash: list<number>, pointStyle: string}} series
 * @param {list<{median: number, min: number, max: number}|null>} points
 * @param {{surface: string}} colors
 * @returns {list<object>}
 */
export function bandDatasets(series, points, colors) {
    const band = {
        borderWidth: 0,
        pointRadius: 0,
        pointHitRadius: 0,
        backgroundColor: withAlpha(series.color, BAND_ALPHA),
        /**
         * Marca para que el tooltip las descarte ({@see renderMedianBandChart}): sus dos números ya
         * salen en la línea de la mediana, y repetirlos como dos entradas sueltas de «máximo» y
         * «mínimo» sin decir de qué serie son es ruido que se lee mal.
         */
        isBand: true,
    };

    return [
        { ...band, label: series.label, data: points.map((point) => point?.min ?? null), fill: false },
        { ...band, label: series.label, data: points.map((point) => point?.max ?? null), fill: '-1' },
        {
            label: series.label,
            data: points.map((point) => point?.median ?? null),
            borderColor: series.color,
            backgroundColor: series.color,
            pointBackgroundColor: series.color,
            pointBorderColor: colors.surface,
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 2,
            borderDash: [...series.borderDash],
            pointStyle: series.pointStyle,
            tension: 0.3,
            /**
             * Los tres números del día viajan con el conjunto para que el tooltip los diga juntos
             * ({@see tooltipLine}). Leer la mediana sin sus extremos es leer media verdad: en un día
             * con seis lecturas, la banda es lo que dice si fue un día estable o uno de sobresaltos.
             */
            bandPoints: points,
        },
    ];
}

/**
 * Línea del tooltip de un punto de mediana: la serie, la mediana con su unidad, y el recorrido del
 * día. Un día de una sola lectura lo dice con esas palabras, en vez de enseñar un «min 112, max 112»
 * que parece un fallo de la gráfica.
 *
 * @param {{dataset: {label: string, bandPoints?: list<object|null>}, dataIndex: number}} item
 * @param {string} unit
 * @returns {string}
 */
export function tooltipLine(item, unit) {
    const point = item.dataset.bandPoints?.[item.dataIndex];

    if (point === undefined || point === null) {
        return item.dataset.label;
    }

    if (point.count === 1) {
        return t('dashboard.chart.tooltipSingle', {
            label: item.dataset.label,
            value: formatNumber(point.median),
            unit,
        });
    }

    return t('dashboard.chart.tooltip', {
        label: item.dataset.label,
        median: formatNumber(point.median),
        min: formatNumber(point.min),
        max: formatNumber(point.max),
        unit,
        count: point.count,
    });
}

/**
 * Descriptores de serie: la etiqueta que llega, más el color y la forma que le tocan por posición.
 *
 * Son a la vez lo que consume Chart.js y lo que pinta la leyenda, igual que en las pantallas por
 * tipo: una sola fuente, para que la leyenda no pueda quedarse con un color distinto del de la
 * línea. Los colores se reparten en ciclo cuando hay más series que colores define DESIGN.md;
 * el patrón de trazo y la forma del punto siguen distinguiéndolas.
 *
 * @param {list<string>} labels
 * @param {{series: list<string>}} colors
 * @returns {list<{label: string, color: string, borderDash: list<number>, pointStyle: string}>}
 */
export function describeSeries(labels, colors) {
    return labels.map((label, index) => ({
        label,
        color: colors.series[index % colors.series.length],
        ...SERIES_SHAPES[index % SERIES_SHAPES.length],
    }));
}

/**
 * Pinta la gráfica en el lienzo dado y devuelve la instancia de Chart.js, o `null` si no hay ninguna
 * serie con datos.
 *
 * Con cero series no se dibuja un lienzo de ejes vacíos: parece un fallo, no un estado vacío. La
 * leyenda se vacía en ese caso, porque describiría líneas que no están.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} params
 * @param {list<string>} params.days Claves `YYYY-MM-DD` del eje, en orden ascendente.
 * @param {list<{label: string, points: list<object|null>}>} params.series Ya etiquetadas y traducidas.
 * @param {string} params.unit Código UCUM de la magnitud, para el título del eje vertical (ADR 0005:
 *        no se traduce).
 * @param {string} params.legendId Identificador del `<ul>` de la leyenda.
 * @returns {Chart|null}
 */
export function renderMedianBandChart(canvas, { days, series, unit, legendId }) {
    const colors = chartColors();
    const described = describeSeries(series.map((entry) => entry.label), colors);

    renderLegend(legendElementFor(canvas, legendId), legendItems(described));

    if (series.length === 0 || days.length === 0) {
        return null;
    }

    const datasets = described.flatMap((entry, index) => bandDatasets(entry, series[index].points, colors));

    return new Chart(canvas, {
        type: 'line',
        /** El eje es de categoría: no hay adaptador de fechas de Chart.js instalado (ver glucosePage). */
        data: { labels: days.map((day) => formatChartDay(`${day}T00:00:00`)), datasets },
        options: {
            maintainAspectRatio: false,
            color: colors.tick,
            scales: {
                x: {
                    type: 'category',
                    grid: { color: colors.grid },
                    /** La línea de eje va en el tono de los rótulos, no en el de la rejilla (Don'ts #10). */
                    border: { color: colors.tick },
                    ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                },
                y: {
                    grid: { color: colors.grid },
                    border: { color: colors.tick },
                    ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                    title: {
                        display: true,
                        text: unit,
                        color: colors.tick,
                        /** Peso 400: de IBM Plex Mono solo se empaqueta ese (§ Typography · Code). */
                        font: { family: CHART_FONTS.mono, size: 13, weight: 400 },
                    },
                },
            },
            plugins: {
                /** La leyenda vive fuera del lienzo, en HTML (ver `chartLegend.js`). */
                legend: { display: false },
                tooltip: {
                    /** Las dos series auxiliares de la banda no hablan por su cuenta (ver `bandDatasets`). */
                    filter: (item) => item.dataset.isBand !== true,
                    callbacks: { label: (item) => tooltipLine(item, unit) },
                    backgroundColor: colors.tooltipSurface,
                    titleColor: colors.tooltipInk,
                    bodyColor: colors.tooltipInk,
                    cornerRadius: 8,
                    padding: { top: 8, bottom: 8, left: 14, right: 14 },
                    titleFont: { family: CHART_FONTS.body, size: 13, weight: 500 },
                    bodyFont: { family: CHART_FONTS.mono, size: 13 },
                },
            },
        },
    });
}
