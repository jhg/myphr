/**
 * Dibujo de la superposición de días sobre un eje de 24 horas.
 *
 * Recibe lo que construye `health/dayOverlay.js` y devuelve la instancia de Chart.js: ni calcula ni
 * lee eventos, por eso sale igual en el panel del paciente, en el lector del profesional y en la
 * vista previa de compartir.
 *
 * **Qué se ve y por qué en dos pesos.** Cada día es una línea fina y translúcida: sola no dice nada,
 * y juntas dibujan la nube de lo que suele pasar a cada hora. Encima, la mediana horaria en trazo
 * grueso, que es la que se lee. Si las dos tuvieran el mismo peso, cuarenta líneas taparían la única
 * que resume, que es exactamente el fallo que hace ilegible este formato cuando se hace mal.
 *
 * **El rango objetivo va de banda de fondo** (ADR 0007), cuando la persona lo tiene configurado: es
 * lo que convierte una nube de puntos en información, porque dice de un vistazo qué parte del día se
 * pasa fuera. Nunca se dibuja un rango de otra unidad: eso lo decide quien llama, y aquí llega ya
 * resuelto o no llega.
 */

import Chart from 'chart.js/auto';

import { formatNumber, t } from '../i18n/index.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, CHART_FONTS } from './chartTheme.js';
import { wallClockFormat } from './chartTime.js';
import { withAlpha } from './medianBandChart.js';

/** Opacidad de la línea de un día suelto: contexto, no dato. */
const DAY_ALPHA = 0.22;

/** Opacidad de la banda del rango objetivo: tiene que dejar leer todo lo que pasa por encima. */
const TARGET_ALPHA = 0.14;

/** Formas de la mediana de cada grupo, la segunda codificación de Do's #3. */
const MEDIAN_SHAPES = Object.freeze([
    Object.freeze({ borderDash: [], pointStyle: 'circle' }),
    Object.freeze({ borderDash: [6, 4], pointStyle: 'triangle' }),
    Object.freeze({ borderDash: [2, 3], pointStyle: 'rect' }),
]);

/**
 * Hora del eje, escrita en el idioma activo.
 *
 * Se formatea sobre un instante de la época en UTC porque lo que se enseña es una hora del reloj de
 * pared, no un instante ({@see wallClockFormat}).
 *
 * @param {Intl.DateTimeFormat} format
 * @param {number} hour Entre 0 y 24, con decimales.
 * @returns {string}
 */
export function hourLabel(format, hour) {
    return format.format(new Date(Math.round(hour * 3_600_000)));
}

/**
 * Banda de fondo del rango objetivo.
 *
 * Va en `beforeDatasetsDraw` para quedar **debajo** de todas las líneas: pintada encima teñiría los
 * datos y cambiaría el color con el que se lee una glucemia.
 *
 * @param {{low: number, high: number}|undefined} targetRange
 * @param {{series: list<string>}} colors
 * @returns {object|null}
 */
function targetRangePlugin(targetRange, colors) {
    if (targetRange === undefined || targetRange === null) {
        return null;
    }

    return {
        id: 'phrTargetRange',
        beforeDatasetsDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            const top = scales.y.getPixelForValue(targetRange.high);
            const bottom = scales.y.getPixelForValue(targetRange.low);

            ctx.save();
            /** Se recorta al área de datos: fuera de ella la banda invadiría los rótulos del eje. */
            ctx.beginPath();
            ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
            ctx.clip();
            /** Success con transparencia: el matiz de «dentro de rango», nunca un color inventado. */
            ctx.fillStyle = withAlpha(colors.series[2], TARGET_ALPHA);
            ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
            ctx.restore();
        },
    };
}

/**
 * Pinta la gráfica y devuelve la instancia, o `null` si no hay ningún día que superponer.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} params
 * @param {list<{group: string, label: string, days: list<object>, median: list<object>}>} params.groups
 *        Ya etiquetados y traducidos por quien llama.
 * @param {string} params.unit Código UCUM (ADR 0005: no se traduce).
 * @param {string} params.legendId
 * @param {{low: number, high: number, unit: string}} [params.targetRange] Ya comprobado que está en
 *        la misma unidad (ADR 0007: no se convierte).
 * @returns {Chart|null}
 */
export function renderDayOverlayChart(canvas, { groups, unit, legendId, targetRange }) {
    const colors = chartColors();
    const described = groups.map((group, index) => ({
        ...group,
        color: colors.series[index % colors.series.length],
        ...MEDIAN_SHAPES[index % MEDIAN_SHAPES.length],
    }));

    renderLegend(legendElementFor(canvas, legendId), legendItems(described.map((group) => ({
        label: t('dashboard.chart.overlay.medianLabel', { group: group.label }),
        color: group.color,
        borderDash: group.borderDash,
        pointStyle: group.pointStyle,
    }))));

    if (described.length === 0) {
        return null;
    }

    const hourFormat = wallClockFormat({ hour: '2-digit', minute: '2-digit' });
    const dayFormat = wallClockFormat({ month: 'short', day: 'numeric' });

    const datasets = described.flatMap((group) => [
        /**
         * Un conjunto por día. `order` alto los manda al fondo: Chart.js dibuja antes los de orden
         * mayor, así que la mediana queda encima de su propia nube.
         */
        ...group.days.map((day) => ({
            label: dayFormat.format(new Date(`${day.day}T00:00:00Z`)),
            data: day.points,
            borderColor: withAlpha(group.color, DAY_ALPHA),
            borderWidth: 1,
            pointRadius: 0,
            pointHitRadius: 6,
            tension: 0.25,
            order: 2,
            isDay: true,
        })),
        {
            label: t('dashboard.chart.overlay.medianLabel', { group: group.label }),
            data: group.median,
            borderColor: group.color,
            backgroundColor: group.color,
            pointBackgroundColor: group.color,
            pointBorderColor: colors.surface,
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 3,
            borderDash: [...group.borderDash],
            pointStyle: group.pointStyle,
            tension: 0.3,
            order: 1,
            /** `spanGaps` de fábrica en falso: una hora sin lecturas no tiene mediana y se ve así. */
        },
    ]);

    const plugin = targetRangePlugin(targetRange, colors);

    return new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
            maintainAspectRatio: false,
            color: colors.tick,
            interaction: { mode: 'nearest', intersect: false },
            scales: {
                x: {
                    type: 'linear',
                    min: 0,
                    max: 24,
                    grid: { color: colors.grid },
                    border: { color: colors.tick },
                    ticks: {
                        color: colors.tick,
                        font: { family: CHART_FONTS.mono, size: 12 },
                        stepSize: 3,
                        maxRotation: 0,
                        callback: (value) => hourLabel(hourFormat, value),
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
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => hourLabel(hourFormat, items[0].parsed.x),
                        label: (item) => t('dashboard.chart.overlay.tooltip', {
                            label: item.dataset.label,
                            value: formatNumber(item.parsed.y),
                            unit,
                        }),
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
        plugins: plugin === null ? [] : [plugin],
    });
}
