/**
 * Chart legend, in HTML and outside the `<canvas>`.
 *
 * **Why it is taken out of the canvas.** In Chart.js 4 the legend is not a DOM node: it is an
 * `Element` registered as a layout box (`layouts.addBox(chart, legend)`), and its `fit()` computes
 * the height by stacking one row per batch of entries that fits, measuring the text with
 * `ctx.measureText()`. With `maintainAspectRatio: false` inside a container of a fixed 320px, that
 * height is **subtracted** from the data area and depends on the number of series, on how long
 * their labels are and on the window width; if the rows go over `maxHeight`, `Math.min` clips it
 * and the leftover entries disappear. The blood pressure screen is the worst case: it generates
 * two series per method (systolic and diastolic of each arm×posture combination), so two short
 * entries become eight long ones without anything in the layout changing.
 *
 * **What is gained besides the height.** On the canvas, `usePointStyle: true` draws only the point
 * shape and loses the dash pattern, so the three series of one same blue were told apart by colour
 * alone — exactly what DESIGN.md Do's #3 forbids for a clinical datum. Here each entry carries its
 * line with `stroke-dasharray` **and** its marker (circle, triangle, square), which is the same
 * thing that tells the chart apart. And being HTML, the text uses the ink tokens and switches with
 * dark mode on its own, something a colour written inside the `<canvas>` cannot do.
 *
 * **It is not interactive, and that is on purpose.** The defect being fixed is one of layout, not
 * of missing interaction. The chart caption is the `aria-describedby` of the canvas and the only
 * textual source of what it contains (ADR 0008, "Includes: …"); a per-series toggle would put them
 * out of sync —the chart would show three of eight series and the accessible text would keep
 * saying it includes them all— and hiding a clinical series without a trace in the text is exactly
 * what Don'ts #10 wants to avoid. If real filtering is ever needed, the place is a group of
 * checkboxes above the chart filtering **the input data**, and therefore the caption too.
 */

/**
 * Geometry of the marker of each entry, in the coordinate system of the 24×12 `<svg>`.
 */
const SWATCH = Object.freeze({ width: 24, height: 12, middle: 6 });

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Turns the series descriptors each screen already builds (the same ones that feed Chart.js) into
 * the legend entries.
 *
 * It does not go through `chart.legend.options.labels.generateLabels()`: the three screens already
 * have the array with label, colour, dash and shape before creating the `Chart`, so reading it
 * from there touches no library internal and keeps this function pure and testable without
 * mounting Chart.js, like the rest of `tests/js`.
 *
 * @param {list<{label: string, color: string, borderDash?: list<number>, pointStyle?: string}>} series
 * @returns {list<{text: string, color: string, dash: list<number>, shape: string}>}
 */
export function legendItems(series) {
    return series.map((entry) => ({
        text: entry.label,
        color: entry.color,
        dash: [...(entry.borderDash ?? [])],
        shape: entry.pointStyle ?? 'circle',
        /**
         * A series that in the chart **is not a line** —the meal and insulin markers of the glucose
         * curve, which are loose points on the time axis— does not carry one in the legend either:
         * drawing it a stroke would say there is a continuous series where there are only events.
         */
        line: entry.lineless !== true,
    }));
}

/**
 * Marker of the entry: the same shape Chart.js paints on the points of that series.
 *
 * @param {string} shape
 * @param {string} color
 * @returns {SVGElement}
 */
function createShape(shape, color) {
    const { middle } = SWATCH;
    const center = SWATCH.width / 2;

    if (shape === 'triangle') {
        const triangle = document.createElementNS(SVG_NAMESPACE, 'polygon');
        triangle.setAttribute(
            'points',
            `${center},${middle - 4.5} ${center + 4.5},${middle + 3.5} ${center - 4.5},${middle + 3.5}`
        );
        triangle.setAttribute('fill', color);

        return triangle;
    }

    if (shape === 'rect' || shape === 'rectRounded') {
        const rect = document.createElementNS(SVG_NAMESPACE, 'rect');
        rect.setAttribute('x', String(center - 4));
        rect.setAttribute('y', String(middle - 4));
        rect.setAttribute('width', '8');
        rect.setAttribute('height', '8');
        rect.setAttribute('fill', color);

        return rect;
    }

    const circle = document.createElementNS(SVG_NAMESPACE, 'circle');
    circle.setAttribute('cx', String(center));
    circle.setAttribute('cy', String(middle));
    circle.setAttribute('r', '4');
    circle.setAttribute('fill', color);

    return circle;
}

/**
 * Sample of an entry: the line with its dash pattern plus the marker on top.
 *
 * `aria-hidden`: it carries no information that is not already in the text next to it (Do's #3,
 * the colour and the shape accompany the series name, they do not replace it).
 *
 * @param {{color: string, dash: list<number>, shape: string}} item
 * @returns {SVGSVGElement}
 */
function createSwatch(item) {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', `0 0 ${SWATCH.width} ${SWATCH.height}`);
    svg.setAttribute('width', String(SWATCH.width));
    svg.setAttribute('height', String(SWATCH.height));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'shrink-0');

    if (item.line !== false) {
        const line = document.createElementNS(SVG_NAMESPACE, 'line');
        line.setAttribute('x1', '0');
        line.setAttribute('y1', String(SWATCH.middle));
        line.setAttribute('x2', String(SWATCH.width));
        line.setAttribute('y2', String(SWATCH.middle));
        line.setAttribute('stroke', item.color);
        line.setAttribute('stroke-width', '2');

        if (item.dash.length > 0) {
            line.setAttribute('stroke-dasharray', item.dash.join(' '));
        }

        svg.appendChild(line);
    }

    svg.appendChild(createShape(item.shape, item.color));

    return svg;
}

/**
 * Paints the legend inside `element`, replacing whatever was there.
 *
 * Always emptying before painting is not cosmetic: the history is repainted whole after saving a
 * record, and a legend that only appended would stack the same series once per save. With an empty
 * list it leaves the node empty, which is what fits when the chart is not painted.
 *
 * @param {HTMLElement|null|undefined} element `<ul>` container; if it does not exist, nothing happens.
 * @param {list<{text: string, color: string, dash: list<number>, shape: string}>} items
 */
export function renderLegend(element, items) {
    if (element === null || element === undefined) {
        return;
    }

    element.setAttribute('role', 'list');
    element.replaceChildren(...items.map((item) => {
        const entry = document.createElement('li');
        /**
         * Main ink by its role (`text-ink`), not a shade of the ramp: in dark mode `gray-900`
         * becomes the surface and the text would disappear. 13px is the Helper size of
         * § Typography, the same the canvas legend had.
         */
        entry.className = 'inline-flex items-center gap-2 text-helper text-ink';
        entry.appendChild(createSwatch(item));

        const text = document.createElement('span');
        text.textContent = item.text;
        entry.appendChild(text);

        return entry;
    }));
}

/**
 * Resolves the node the legend of a canvas goes in, creating it if the template does not bring it.
 *
 * It is looked up **by `id`, never by `x-ref`**, and that is deliberate: `GlucosePageTest`,
 * `DashboardPageTest` and the DOM contract of `tests/js` demand that the `$refs` of the module and
 * the `x-ref` of the template match exactly, so a `$refs.chartLegend` would force touching the
 * five templates at once or would break those tests. By `id` the module works with the template as
 * it is today, and keeps working the day Blade paints the `<ul>` with that same `id`.
 *
 * The node goes as a sibling **of the container** of the canvas, not inside it: with
 * `maintainAspectRatio: false` Chart.js demands that the parent of the `<canvas>` be exclusively
 * its own, and a sibling inside can trigger the resize loop. It is also added to the
 * `aria-describedby` of the canvas, next to the caption, which accepts several identifiers.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} id Stable identifier, so the canvas can be described with it.
 * @returns {HTMLElement|null}
 */
export function legendElementFor(canvas, id) {
    const existing = document.getElementById(id);

    if (existing !== null) {
        return existing;
    }

    if (canvas === null || canvas === undefined || canvas.parentElement === null) {
        return null;
    }

    const list = document.createElement('ul');
    list.id = id;
    list.className = 'mt-3 flex flex-wrap gap-x-4 gap-y-1';
    canvas.parentElement.after(list);

    const described = (canvas.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((token) => token !== '');

    if (!described.includes(id)) {
        canvas.setAttribute('aria-describedby', [...described, id].join(' '));
    }

    return list;
}
