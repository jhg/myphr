/**
 * DOM pieces shared by every event view: the notice, the statistics tile and the empty state
 * (DESIGN.md).
 *
 * **They take data and return nodes.** They do not read the document, they know no `x-ref`, they
 * do not know which screen calls them and they do not talk to Livewire. That is the condition for
 * the same notice and the same tile to appear in the patient panel, in the professional's reader
 * (with no session) and in the preview of the share screen: if one of the three painted its
 * figures differently, patient and doctor would be looking at two different documents of the same datum.
 *
 * Every colour goes by its **role** (`error-*`, `info-*`, `bg-surface`, `text-ink`) and never by
 * the ramp: the roles switch on their own with the dark theme and the accent ramps are not
 * reassigned (see `theme.css`, § Ramp Mapping — Dark and § Notices and chips).
 */

/**
 * @param {'warning'|'info'} tone
 * @param {string} message
 * @returns {HTMLDivElement}
 */
export function createCallout(tone, message) {
    const callout = document.createElement('div');

    /**
     * The three roles of the notice —fill, line and ink— by their name (`error-*` / `info-*`), as
     * in `glucosePage.js`. Written with the ramp (`bg-danger-50`, `text-primary-600`) the notice
     * would come out in dark mode with an almost white background and light ink on top.
     */
    callout.className = tone === 'warning'
        ? 'flex items-start gap-3 rounded-control border border-error-outline bg-error-surface p-pad-md '
            + 'text-body text-error-ink shadow-large'
        : 'flex items-start gap-3 rounded-control border border-info-outline bg-info-surface p-pad-md '
            + 'text-body-lg text-info-ink';

    if (tone === 'warning') {
        callout.setAttribute('role', 'alert');
    }

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.5');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('class', 'mt-0.5 size-5 shrink-0');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', tone === 'warning'
        ? 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 '
            + '3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z'
        : 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
            + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z');
    icon.appendChild(path);
    callout.appendChild(icon);

    const text = document.createElement('p');
    text.textContent = message;
    callout.appendChild(text);

    return callout;
}

/**
 * Ink of each clinical reading of a figure.
 *
 * They are the semantic roles of DESIGN.md, which switch on their own with the dark theme.
 * `neutral` is the normal case: most figures (count, mean, minimum) mean nothing on their own and
 * tinting them would be decorating, not informing.
 *
 * @type {Record<string, string>}
 */
const TONE_INK = Object.freeze({
    neutral: 'text-ink',
    good: 'text-success-ink',
    warning: 'text-warning-ink',
});

/**
 * Fill of each semantic role when what is painted is a **surface** and not text: the segment of a
 * bar, the little square of a legend.
 *
 * The ink (`success-ink`, `warning-ink`) is used and not the soft fill (`*-surface`) because a bar
 * segment is a graphical object and needs 3:1 against the card (WCAG 1.4.11): the soft fills are
 * meant to carry text on top, not to be read on their own. Both roles switch with the theme by
 * themselves.
 *
 * @type {Record<string, string>}
 */
const TONE_FILL = Object.freeze({
    neutral: 'bg-ink-secondary',
    good: 'bg-success-ink',
    warning: 'bg-warning-ink',
});

/** Height and width of the logical canvas of the sparkline, in units of its `viewBox`. */
const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 24;

/** Vertical margin of the stroke, so a maximum or a minimum is not cut against the edge. */
const SPARKLINE_PADDING = 2;

/**
 * Minimum points for a sparkline to be painted.
 *
 * Two points always make a perfect straight line: drawing it asserts a trend that has not been
 * observed. With fewer than three nothing is painted, and the card keeps its figures, which are
 * data.
 */
export const SPARKLINE_MIN_POINTS = 3;

/**
 * Trend sparkline: a polyline with no axes, no labels and no legend.
 *
 * **Why hand-written SVG and not Chart.js.** A statistics card does not carry a chart, it carries a
 * gesture. Chart.js asks for a `<canvas>` with its life cycle (an instance to destroy on repaint,
 * colours to re-read from the theme on mode change, redraw on resize), and that multiplied by
 * every tile of every method of every type is a real cost for a four-line stroke. An SVG is one
 * more node of the fragment: it is thrown away with the rest when the view repaints, it inherits
 * the theme colour through `currentColor` without re-reading anything, and it scales on its own.
 *
 * **Gaps are gaps** (same rule as `dailyBands.js`): a day with no readings contributes no point and
 * **breaks the stroke**. Joining over the gap would draw a slope nobody measured, and filling it
 * with a zero would draw a fall that did not happen. A lone stretch between two gaps is marked
 * with a point, which is exactly what is known about it.
 *
 * The horizontal position is that of the day inside the period, not that of the point inside the
 * list: that way a gap of a week looks wide and one of a day, narrow.
 *
 * It is decorative (`aria-hidden`): everything it says is also in the figures of the tile, so there
 * is nothing to announce twice (DESIGN.md, Do's #3).
 *
 * @param {list<number|null>} points One value per day of the period, `null` on days with no readings.
 * @returns {SVGElement|null} `null` if there is no trend to show.
 */
export function createSparkline(points) {
    const present = points
        .map((value, index) => ({ value, index }))
        .filter((point) => typeof point.value === 'number' && Number.isFinite(point.value));

    if (present.length < SPARKLINE_MIN_POINTS || points.length < 2) {
        return null;
    }

    const values = present.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    const usableHeight = SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2;

    const x = (index) => (index / (points.length - 1)) * SPARKLINE_WIDTH;
    /** A flat series is drawn centred: there is no range to scale, and no division by zero either. */
    const y = (value) => (span === 0
        ? SPARKLINE_HEIGHT / 2
        : SPARKLINE_PADDING + ((max - value) / span) * usableHeight);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`);
    /**
     * The stroke stretches with the tile, so the aspect ratio is not kept; the line thickness is,
     * with `vector-effect`, or it would come out thicker horizontally than vertically.
     */
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'mt-2 h-6 w-full text-ink-secondary');

    for (const run of consecutiveRuns(present)) {
        const shape = run.length === 1
            ? document.createElementNS('http://www.w3.org/2000/svg', 'circle')
            : document.createElementNS('http://www.w3.org/2000/svg', 'polyline');

        if (run.length === 1) {
            shape.setAttribute('cx', String(round(x(run[0].index))));
            shape.setAttribute('cy', String(round(y(run[0].value))));
            shape.setAttribute('r', '1.5');
            shape.setAttribute('fill', 'currentColor');
        } else {
            const coordinates = run.map((point) => `${round(x(point.index))},${round(y(point.value))}`);

            shape.setAttribute('points', coordinates.join(' '));
            shape.setAttribute('fill', 'none');
            shape.setAttribute('stroke', 'currentColor');
            shape.setAttribute('stroke-width', '1.5');
            shape.setAttribute('stroke-linecap', 'round');
            shape.setAttribute('stroke-linejoin', 'round');
            shape.setAttribute('vector-effect', 'non-scaling-stroke');
        }

        svg.appendChild(shape);
    }

    return svg;
}

/**
 * Splits a list of points into stretches of **consecutive** days: every index jump is a day with no
 * readings and opens a new stretch.
 *
 * @param {list<{value: number, index: number}>} present
 * @returns {list<list<{value: number, index: number}>>}
 */
function consecutiveRuns(present) {
    const runs = [];

    for (const point of present) {
        const current = runs.at(-1);

        if (current !== undefined && point.index === current.at(-1).index + 1) {
            current.push(point);
        } else {
            runs.push([point]);
        }
    }

    return runs;
}

/**
 * Coordinate with two decimals: more precision only fattens the attribute without moving a pixel.
 *
 * @param {number} value
 * @returns {number}
 */
function round(value) {
    return Math.round(value * 100) / 100;
}

/**
 * Horizontal bar in segments, with its legend below.
 *
 * It is the standard way of reading a three-part split —below, inside, above— without doing any
 * arithmetic. The proportion of each segment is its percentage, distributed with `flex-grow` so the
 * bar fills the exact width seamlessly even if the three roundings do not add up to exactly 100.
 *
 * **The colour never goes alone** (DESIGN.md, Do's #3): the bar is decorative and what informs is
 * the legend, where each segment carries its written label and its percentage as a number. In
 * greyscale, with the dark theme or with a screen reader it reads the same.
 *
 * The style goes by attribute and not through the `style` property on purpose: these modules are
 * tested with a minimal `document` (see `tests/js`), and `setAttribute` is the only thing that
 * document needs to know how to do.
 *
 * @param {list<{label: string, percent: number, value: string, tone: 'neutral'|'good'|'warning'}>} segments
 * @returns {HTMLDivElement}
 */
export function createSegmentedBar(segments) {
    const wrapper = document.createElement('div');

    const track = document.createElement('div');
    track.className = 'flex h-3 w-full overflow-hidden rounded-full border border-border bg-background';
    track.setAttribute('aria-hidden', 'true');

    for (const segment of segments) {
        if (segment.percent <= 0) {
            continue;
        }

        const fill = document.createElement('div');
        fill.className = TONE_FILL[segment.tone] ?? TONE_FILL.neutral;
        fill.setAttribute('style', `flex-grow:${segment.percent}`);
        track.appendChild(fill);
    }

    wrapper.appendChild(track);

    const legend = document.createElement('ul');
    legend.className = 'mt-2 flex flex-wrap gap-x-4 gap-y-1';

    /**
     * An empty segment stays in the legend with its "0%". That is information: knowing there was no
     * reading below the range is not the same as knowing nothing about that band.
     */
    for (const segment of segments) {
        const item = document.createElement('li');
        item.className = 'flex items-center gap-2 text-caption text-ink-secondary';

        const swatch = document.createElement('span');
        swatch.className = `size-2 shrink-0 rounded-full ${TONE_FILL[segment.tone] ?? TONE_FILL.neutral}`;
        swatch.setAttribute('aria-hidden', 'true');
        item.appendChild(swatch);

        const text = document.createElement('span');
        text.textContent = segment.label;
        item.appendChild(text);

        const amount = document.createElement('span');
        amount.className = 'font-mono font-semibold text-ink';
        amount.textContent = segment.value;
        item.appendChild(amount);

        legend.appendChild(item);
    }

    wrapper.appendChild(legend);

    return wrapper;
}

/**
 * A value with its label and its unit, always together (Do's #2 and #7 of DESIGN.md: a lone number
 * is a number that gets misread). The value goes in IBM Plex Mono with high contrast, never in
 * light grey.
 *
 * @param {object} params
 * @param {string} params.label
 * @param {string} params.value Already formatted (`formatNumber` or the date).
 * @param {string} [params.unit]
 * @param {'neutral'|'good'|'warning'} [params.tone]
 * @param {list<number|null>} [params.trend] Daily series for the sparkline ({@see createSparkline}).
 *        Optional and with no effect if there is no trend to show: whoever already called this
 *        function without it still gets exactly the same tile.
 * @returns {HTMLDivElement}
 */
export function createStatTile({ label, value, unit, tone = 'neutral', trend }) {
    const tile = document.createElement('div');
    /**
     * `bg-background` and `border-border`: roles of § Colors, which switch on their own with the
     * theme. With `bg-gray-50` / `border-gray-200` the tile would come out in dark as an almost
     * white rectangle with a frame the colour of the ink.
     */
    tile.className = 'rounded-card border border-border bg-background px-4 py-3';

    const caption = document.createElement('p');
    caption.className = 'text-caption text-ink-secondary';
    caption.textContent = label;
    tile.appendChild(caption);

    /**
     * The figure in Headline size and the unit small next to it: the hierarchy comes from the size,
     * not from the colour, so it still reads the same in greyscale and with the dark theme.
     *
     * `tone` tints the figure when the datum has a clinical reading —inside or outside the target
     * range— and stays in the normal ink when it does not. The colour never goes alone: the figure
     * and its label are still there, which is what DESIGN.md demands (Do's #3).
     */
    const valueLine = document.createElement('p');
    valueLine.className = `mt-1 font-mono text-headline font-semibold ${TONE_INK[tone] ?? TONE_INK.neutral}`;
    valueLine.textContent = value;

    if (unit) {
        const unitSpan = document.createElement('span');
        unitSpan.className = 'ml-1 text-body-sm font-normal text-ink-secondary';
        unitSpan.textContent = unit;
        valueLine.appendChild(unitSpan);
    }

    tile.appendChild(valueLine);

    /**
     * The sparkline goes below the figure and never in its place: it is context ("is it going up?"),
     * not datum. If there is no trend to show, the tile stays as it was.
     */
    if (Array.isArray(trend)) {
        const sparkline = createSparkline(trend);

        if (sparkline !== null) {
            tile.appendChild(sparkline);
        }
    }

    return tile;
}

/**
 * Empty state with a way out.
 *
 * A grey sentence and nothing else leaves whoever has just signed up with nothing to do; with the
 * button, the only possible action at that moment is one click away. The destination arrives **as
 * an argument**, never read from the document: the panel route is decided by the Filament server
 * and the professional's reader has none to send anybody to, so `null` is a normal case and then
 * only the sentence is painted, which is what informs.
 *
 * @param {string} message
 * @param {string|null} href
 * @param {string} actionLabel
 * @returns {HTMLElement}
 */
export function renderEmptyState(message, href, actionLabel) {
    const wrapper = document.createElement('div');
    wrapper.className = 'flex flex-col items-center gap-3 rounded-control border border-dashed '
        + 'border-border-strong px-6 py-10 text-center';

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.5');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('class', 'size-8 text-ink-muted');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', 'M3 13.5h4.5l2.25-4.5 3 9 2.25-4.5H21');
    icon.appendChild(path);
    wrapper.appendChild(icon);

    const text = document.createElement('p');
    text.className = 'text-body-sm text-ink-secondary';
    text.textContent = message;
    wrapper.appendChild(text);

    if (typeof href === 'string' && href !== '') {
        const action = document.createElement('a');
        action.href = href;
        action.className = 'inline-flex min-h-11 items-center justify-center rounded-control bg-accent '
            + 'px-6 py-2.5 text-button text-accent-ink transition hover:bg-accent-hover '
            + 'focus-visible:outline-none focus-visible:shadow-focus-blue';
        action.textContent = actionLabel;
        wrapper.appendChild(action);
    }

    return wrapper;
}
