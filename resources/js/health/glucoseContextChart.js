/**
 * Dibujo de la curva de glucemia con las marcas de comida e insulina encima.
 *
 * Recibe lo que construye `health/glucoseContext.js` —ya agrupado, ya recortado y ya etiquetado— y
 * devuelve la instancia de Chart.js. No calcula nada y no lee eventos: por eso la misma gráfica sale
 * igual en el panel del paciente, en el lector del profesional y en la vista previa de compartir.
 *
 * **El eje X es lineal, no de categorías ni de tiempo.** De tiempo no puede ser: no hay adaptador de
 * fechas de Chart.js instalado (misma razón que en `medianBandChart.js`). Y de categorías tampoco
 * debe serlo, porque aquí las distancias significan: dos lecturas separadas diez minutos y dos
 * separadas diez horas no pueden quedar igual de lejos, o la subida de después de comer se leería
 * como una pendiente inventada. Los valores del eje son horas de pared (`eventWallClockMs`), así que
 * las etiquetas se formatean en UTC ({@see wallClockFormat}) para no desplazarlas dos veces.
 *
 * **Las marcas viven en su propio eje vertical, invisible y fijo de 0 a 1.** Así se quedan pegadas
 * abajo pase lo que pase con la glucemia: colgarlas del eje de mg/dL las movería con cada cambio de
 * escala y una comida acabaría dibujada a la altura de una hiperglucemia.
 */

import Chart from 'chart.js/auto';

import { formatNumber, t } from '../i18n/index.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, CHART_FONTS } from './chartTheme.js';
import { wallClockFormat } from './chartTime.js';

/**
 * Altura de cada tipo de marca en el eje auxiliar (0 abajo, 1 arriba).
 *
 * Dos carriles y no uno: apiladas en la misma altura, una comida y su inyección —que suelen ir
 * juntas— se taparían, y lo que se quiere ver es precisamente que van juntas.
 */
const MARKER_LEVELS = Object.freeze({ meal: 0.06, insulin: 0.16 });

/**
 * Forma de cada tipo de marca. Es la segunda codificación que pide Do's #3: la marca de comida y la
 * de insulina se distinguen por silueta, no solo por color.
 */
const MARKER_SHAPES = Object.freeze({ meal: 'rectRot', insulin: 'triangle' });

/**
 * Cuántas marcas de insulina pueden llevar la dosis escrita al lado.
 *
 * Pasado ese número, los rótulos se solapan entre sí y con la curva: dejan de ser información y se
 * convierten en la valla ilegible que este límite existe para evitar. La dosis no se pierde —sigue
 * en la marca al pasar por encima o tocar, y en la línea temporal—, solo deja de estar escrita.
 */
const MAX_DOSE_LABELS = 10;

/** Radio de una marca, que crece un poco con las que lleva agrupadas dentro. */
const MARKER_RADIUS = 6;

/**
 * Descriptores de las series de glucemia: color y forma por posición.
 *
 * Se reparten **solo los dos primeros colores** de DESIGN.md § Charts, que son los dos azules
 * neutros del sistema: los otros dos son los matices de Success y Warning y aquí están reservados
 * para las marcas de comida e insulina, que sí son otra cosa. Dos métodos con el mismo azul siguen
 * distinguiéndose por patrón de trazo y forma de punto.
 *
 * @param {list<string>} labels
 * @param {{series: list<string>}} colors
 * @returns {list<{label: string, color: string, borderDash: list<number>, pointStyle: string}>}
 */
export function describeGlucoseSeries(labels, colors) {
    const shapes = [
        { borderDash: [], pointStyle: 'circle' },
        { borderDash: [6, 4], pointStyle: 'triangle' },
        { borderDash: [2, 3], pointStyle: 'rect' },
    ];

    return labels.map((label, index) => ({
        label,
        color: colors.series[index % 2],
        ...shapes[index % shapes.length],
    }));
}

/**
 * Texto de una marca al pasar por encima: qué lleva dentro y, si agrupa varias, cuántas.
 *
 * @param {{count: number, items: list<string>}} marker
 * @returns {list<string>}
 */
export function markerTooltipLines(marker) {
    const lines = [...marker.items];
    const hidden = marker.count - marker.items.length;

    if (hidden > 0) {
        lines.push(t('dashboard.chart.context.moreGrouped', { count: hidden }));
    }

    return lines;
}

/**
 * Conjunto de Chart.js de un tipo de marca.
 *
 * @param {string} kind `meal` o `insulin`.
 * @param {list<object>} markers Solo los de ese tipo.
 * @param {{color: string, label: string}} style
 * @returns {object}
 */
function markerDataset(kind, markers, style) {
    return {
        type: 'scatter',
        label: style.label,
        yAxisID: 'marks',
        data: markers.map((marker) => ({ x: marker.x, y: MARKER_LEVELS[kind] })),
        /** Los detalles viajan con el conjunto, para el tooltip y para los rótulos de dosis. */
        markers,
        markerKind: kind,
        backgroundColor: style.color,
        borderColor: style.color,
        pointStyle: MARKER_SHAPES[kind],
        pointRadius: (context) => MARKER_RADIUS + Math.min(4, (markers[context.dataIndex]?.count ?? 1) - 1),
        pointHoverRadius: (context) => MARKER_RADIUS + 2 + Math.min(4, (markers[context.dataIndex]?.count ?? 1) - 1),
        showLine: false,
    };
}

/**
 * Escribe la dosis encima de cada marca de insulina, mientras quepan.
 *
 * Es un complemento de Chart.js y no un rótulo del DOM porque tiene que seguir a la marca en cada
 * redibujado (redimensionar la ventana mueve todas las posiciones). El color es el de los rótulos de
 * eje, leído del tema en el momento de dibujar como todo lo demás (§ Charts — Dark).
 *
 * @param {{tick: string}} colors
 * @returns {object}
 */
function doseLabelPlugin(colors) {
    return {
        id: 'phrDoseLabels',
        afterDatasetsDraw(chart) {
            for (const [index, dataset] of chart.data.datasets.entries()) {
                if (dataset.markerKind !== 'insulin' || dataset.markers.length > MAX_DOSE_LABELS) {
                    continue;
                }

                const { ctx } = chart;

                ctx.save();
                ctx.fillStyle = colors.tick;
                ctx.font = `12px ${CHART_FONTS.mono}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';

                for (const [position, element] of chart.getDatasetMeta(index).data.entries()) {
                    const marker = dataset.markers[position];
                    const text = marker.count > 1
                        ? t('dashboard.chart.context.groupedShort', { count: marker.count })
                        : marker.short;

                    if (text !== '') {
                        ctx.fillText(text, element.x, element.y - MARKER_RADIUS - 3);
                    }
                }

                ctx.restore();
            }
        },
    };
}

/**
 * Pinta la gráfica y devuelve la instancia, o `null` si no hay ninguna lectura de glucemia.
 *
 * Sin glucemia no se dibuja el lienzo aunque haya comidas e insulina: esta gráfica es la relación
 * entre las tres cosas, y unas marcas sueltas sobre unos ejes vacíos no dicen nada que la línea
 * temporal no diga mejor.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} params
 * @param {list<{label: string, points: list<{x: number, y: number|null}>}>} params.series
 * @param {list<{kind: string, x: number, count: number, items: list<string>, short: string}>} params.markers
 * @param {string} params.unit Código UCUM (ADR 0005: no se traduce).
 * @param {string} params.legendId
 * @returns {Chart|null}
 */
export function renderGlucoseContextChart(canvas, { series, markers, unit, legendId }) {
    const colors = chartColors();
    const described = describeGlucoseSeries(series.map((entry) => entry.label), colors);

    const markerStyles = {
        meal: { color: colors.series[2], label: t('dashboard.chart.context.meals') },
        insulin: { color: colors.series[3], label: t('dashboard.chart.context.injections') },
    };

    const presentKinds = Object.keys(markerStyles).filter(
        (kind) => markers.some((marker) => marker.kind === kind),
    );

    renderLegend(legendElementFor(canvas, legendId), legendItems([
        ...described,
        ...presentKinds.map((kind) => ({
            label: markerStyles[kind].label,
            color: markerStyles[kind].color,
            pointStyle: MARKER_SHAPES[kind],
            /** Sucesos, no una serie continua: en la leyenda van sin trazo. */
            lineless: true,
        })),
    ]));

    if (series.length === 0) {
        return null;
    }

    const timeFormat = wallClockFormat({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const datasets = [
        ...described.map((entry, index) => ({
            label: entry.label,
            data: series[index].points,
            borderColor: entry.color,
            backgroundColor: entry.color,
            pointBackgroundColor: entry.color,
            pointBorderColor: colors.surface,
            pointBorderWidth: 1,
            /**
             * Punto pequeño: una serie de sensor trae cientos de lecturas y con el radio de las
             * gráficas de mediana la línea se convertiría en una cadena de bolas. Lo que se lee aquí
             * es el recorrido, no cada punto; el detalle está en el tooltip.
             */
            pointRadius: 2.5,
            pointHoverRadius: 5,
            borderWidth: 2,
            borderDash: [...entry.borderDash],
            pointStyle: entry.pointStyle,
            tension: 0.25,
            /** `spanGaps` en falso (de fábrica): los huecos que abrió `splitOnGaps` son huecos. */
        })),
        ...presentKinds.map((kind) => markerDataset(
            kind,
            markers.filter((marker) => marker.kind === kind),
            markerStyles[kind],
        )),
    ];

    return new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
            maintainAspectRatio: false,
            color: colors.tick,
            /** Interacción por cercanía: las marcas son pequeñas y se tocan con el dedo. */
            interaction: { mode: 'nearest', intersect: false },
            scales: {
                x: {
                    type: 'linear',
                    grid: { color: colors.grid },
                    border: { color: colors.tick },
                    ticks: {
                        color: colors.tick,
                        font: { family: CHART_FONTS.mono, size: 12 },
                        maxRotation: 0,
                        autoSkipPadding: 16,
                        callback: (value) => timeFormat.format(new Date(value)),
                    },
                },
                y: {
                    grid: { color: colors.grid },
                    border: { color: colors.tick },
                    ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                    title: {
                        display: true,
                        text: unit,
                        color: colors.tick,
                        font: { family: CHART_FONTS.mono, size: 13, weight: 400 },
                    },
                },
                /**
                 * El carril de las marcas. `display: false` y rango fijo: no es una magnitud, es una
                 * posición, y enseñar un eje de 0 a 1 al lado de la glucemia invitaría a leerlo.
                 */
                marks: { type: 'linear', display: false, min: 0, max: 1 },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => timeFormat.format(new Date(items[0].parsed.x)),
                        label: (item) => {
                            const marker = item.dataset.markers?.[item.dataIndex];

                            if (marker !== undefined) {
                                return markerTooltipLines(marker);
                            }

                            return t('dashboard.chart.context.reading', {
                                label: item.dataset.label,
                                value: formatNumber(item.parsed.y),
                                unit,
                            });
                        },
                    },
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
        plugins: [doseLabelPlugin(colors)],
    });
}
