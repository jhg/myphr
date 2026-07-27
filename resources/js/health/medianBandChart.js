/**
 * Generic chart of daily median with a minimum and maximum band.
 *
 * **Why it exists.** Glucose and blood pressure already had a chart, but each inside its own
 * screen and tied to its own way of grouping. The home dashboard paints up to five types at once
 * and changes which ones depending on the filter, so it needs a piece that **takes a series and
 * paints it**, without knowing whether it comes from a capillary glucose reading, a weight or a
 * tympanic temperature. That is this module's whole responsibility: what `health/dailyBands.js`
 * builds goes in and a drawn canvas plus its legend comes out.
 *
 * What it does **not** do, on purpose: it computes nothing (no medians and no extremes: that
 * computation lives once, in `statistics.js` and `dailyBands.js`), it decides no units and no
 * labels (they arrive ready and translated), and it does not touch the decrypted events.
 *
 * It reuses the two pieces that already solved their part in the per-type screens: `chartTheme.js`
 * to read the theme colours at draw time —DESIGN.md § Charts — Dark demands not one literal colour
 * in the module— and `chartLegend.js` to paint the legend in HTML outside the `<canvas>`, with its
 * dash pattern and its marker, which is the second encoding Do's #3 asks for.
 *
 * **The band is a fill, not a line.** It is drawn with two auxiliary series —the maximum and the
 * minimum of the day— filling the space between them, and both go without border and without
 * points: the only line with markers is the median, which is the datum being read. The auxiliary
 * ones do not appear in the legend either; what the band is is stated by the caption in text,
 * which is where it has to be for whoever does not see the chart.
 */

import Chart from 'chart.js/auto';

import { formatChartDay, formatNumber, t } from '../i18n/index.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, CHART_FONTS } from './chartTheme.js';

/**
 * Second encoding of each series, besides the colour (Do's #3): dash pattern and point shape.
 * It is the same table the glucose and blood pressure screens use, so a capillary reading is drawn
 * the same here as there.
 */
const SERIES_SHAPES = Object.freeze([
    Object.freeze({ borderDash: [], pointStyle: 'circle' }),
    Object.freeze({ borderDash: [6, 4], pointStyle: 'triangle' }),
    Object.freeze({ borderDash: [2, 3], pointStyle: 'rect' }),
]);

/**
 * Opacity of the band fill.
 *
 * The band is context, not the datum: it has to let the median passing through it be read, and the
 * lines of other series crossing it. With an opaque fill, two methods with overlapping ranges
 * would cover each other and the chart would say less than the table next to it.
 */
const BAND_ALPHA = 0.16;

Chart.defaults.font.family = CHART_FONTS.body;
Chart.defaults.font.size = 13;

/**
 * The same colour with transparency, for the band fill.
 *
 * The theme tokens are hex values (`theme.css`, § Charts), which is the case being handled. A
 * format that cannot be decomposed is returned **as is**: an opaque band is ugly, but inventing a
 * derived colour would step outside the DESIGN.md palette, which is worse.
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
 * Chart.js datasets for one series: the band (two auxiliary series filled between each other) and
 * the median line on top.
 *
 * The order matters and is not cosmetic: `fill: '-1'` fills up to the **previous** dataset, so the
 * minimum has to come right before the maximum. The median comes afterwards so it is drawn on top
 * of the fill.
 *
 * `spanGaps` stays false —the factory value— in all three: a day with no readings is a gap, and
 * joining over it would draw a line asserting something nobody measured.
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
         * Marked so the tooltip discards them ({@see renderMedianBandChart}): their two numbers
         * already come out on the median line, and repeating them as two loose "maximum" and
         * "minimum" entries without saying which series they belong to is noise that reads badly.
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
             * The three numbers of the day travel with the dataset so the tooltip says them
             * together ({@see tooltipLine}). Reading the median without its extremes is reading half
             * a truth: on a day with six readings, the band says whether it was steady or jumpy.
             */
            bandPoints: points,
        },
    ];
}

/**
 * Tooltip line of a median point: the series, the median with its unit, and the range of the day.
 * A day with a single reading says so in those words, instead of showing a "min 112, max 112" that
 * looks like a chart bug.
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
 * Series descriptors: the label that arrives, plus the colour and the shape it gets by position.
 *
 * They are at once what Chart.js consumes and what the legend paints, as in the per-type screens:
 * one single source, so the legend cannot end up with a colour different from the line's. The
 * colours are handed out cyclically when there are more series than colours DESIGN.md defines;
 * the dash pattern and the point shape still tell them apart.
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
 * Paints the chart on the given canvas and returns the Chart.js instance, or `null` if no series
 * has data.
 *
 * With zero series no canvas of empty axes is drawn: it looks like a bug, not an empty state. The
 * legend is emptied in that case, because it would describe lines that are not there.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} params
 * @param {list<string>} params.days `YYYY-MM-DD` keys of the axis, in ascending order.
 * @param {list<{label: string, points: list<object|null>}>} params.series Already labelled and translated.
 * @param {string} params.unit UCUM code of the quantity, for the vertical axis title (ADR 0005:
 *        not translated).
 * @param {string} params.legendId Identifier of the legend `<ul>`.
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
        data: { labels: days.map((day) => formatChartDay(`${day}T00:00:00`)), datasets },
        options: {
            maintainAspectRatio: false,
            color: colors.tick,
            scales: {
                x: {
                    /**
                     * A category axis, and here it is not the mistake it would be on a chart of
                     * readings: one category is one calendar day and `buildDailyBands` already
                     * fills the whole stretch, gaps included, so equal widths are proportional to
                     * time and a week with nothing recorded is seven wide. The charts that do place
                     * each reading at its own instant use the linear axis of `timeAxis.js`.
                     *
                     * `autoSkip` is left as it comes: Chart.js writes the day labels that fit and
                     * drops the rest, which is what keeps 180 days readable.
                     */
                    type: 'category',
                    grid: { color: colors.grid },
                    /** The axis line goes in the tick shade, not the grid one (Don'ts #10). */
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
                        /** Weight 400: only that one of IBM Plex Mono is bundled (§ Typography · Code). */
                        font: { family: CHART_FONTS.mono, size: 13, weight: 400 },
                    },
                },
            },
            plugins: {
                /** The legend lives outside the canvas, in HTML (see `chartLegend.js`). */
                legend: { display: false },
                tooltip: {
                    /** The two auxiliary band series do not speak for themselves (see `bandDatasets`). */
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
