/**
 * Chart palette, read from the theme at draw time.
 *
 * **Why they are not literals.** A chart is painted on a `<canvas>`: it inherits no class and does
 * not resolve `var(--color-…)`, so every colour has to be handed to it. For a while that led to
 * copying the light theme hex values into the module, and a literal cannot switch theme: in dark,
 * the axis labels (#475569 over the #152238 surface) came out at 2.10:1, two of the three series
 * at 1.91:1 and 2.46:1 —below the 3:1 of WCAG 1.4.11 for graphical objects, that is an invisible
 * clinical line, exactly what DESIGN.md Don'ts #10 forbids—, the grid came out almost white at
 * full strength and the #FFFFFF point border put a halo around every marker, which
 * § Charts — Dark rules out in those words.
 *
 * DESIGN.md § Charts — Dark demands it literally: "the values must be read at draw time from the
 * CSS variables the theme publishes (`getComputedStyle(document.documentElement)`), never copied
 * into the module as literals», y «a chart must also re-read them and redraw when the `.dark` class
 * on `<html>` changes". This module is those two things: `chartColors()` and `observeThemeChange()`.
 *
 * The variables are already published by `resources/css/filament/phr/theme.css` with their two
 * values (`:root` and `:root.dark`); no colour is invented or derived here.
 */

/**
 * Fallback values, and **only** fallback: they are the light theme ones, the same `theme.css`
 * declares. They are used when there is no stylesheet to read from —the `tests/js` tests run in
 * Node without CSS— so the module can be imported and tested without a browser. In the browser
 * they are never reached: the variable is always defined.
 */
const FALLBACK = Object.freeze({
    surface: '#ffffff',
    grid: '#e2e8f0',
    tick: '#475569',
    tooltipSurface: '#0f172a',
    tooltipInk: '#ffffff',
    series: Object.freeze(['#0077b6', '#005280', '#059669', '#d97706']),
});

/**
 * Families of DESIGN.md § Typography.
 *
 * They live here, next to the colours, for the same reason as them: in a `<canvas>` the font is
 * declared by name and is inherited from no class, so if each chart writes its own they end up
 * diverging. The three panel charts share this one.
 */
export const CHART_FONTS = Object.freeze({
    body: "'Open Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
});

/**
 * @param {CSSStyleDeclaration|null} styles
 * @param {string} name Name of the custom property, with the two dashes.
 * @param {string} fallback
 * @returns {string}
 */
function readVariable(styles, name, fallback) {
    if (styles === null) {
        return fallback;
    }

    const value = styles.getPropertyValue(name).trim();

    return value === '' ? fallback : value;
}

/**
 * Chart colours **at this instant**, resolved against the active theme.
 *
 * It has to be called inside every draw, not once when the module loads: Chart.js freezes the
 * colours when the canvas is built, so a value read at page start would keep whatever theme was
 * in place then.
 *
 * @returns {{surface: string, grid: string, tick: string, tooltipSurface: string, tooltipInk: string, series: list<string>}}
 */
export function chartColors() {
    const styles = typeof document === 'undefined' || typeof getComputedStyle !== 'function'
        ? null
        : getComputedStyle(document.documentElement);

    return Object.freeze({
        surface: readVariable(styles, '--chart-surface', FALLBACK.surface),
        grid: readVariable(styles, '--chart-grid', FALLBACK.grid),
        tick: readVariable(styles, '--chart-tick', FALLBACK.tick),
        tooltipSurface: readVariable(styles, '--chart-tooltip-surface', FALLBACK.tooltipSurface),
        tooltipInk: readVariable(styles, '--chart-tooltip-ink', FALLBACK.tooltipInk),
        /**
         * The four series of § Components · Charts, in that order and with their dark equivalent.
         * From the third on the legend is mandatory (Do's #3), because 3 and 4 reuse the shades of
         * Success and Warning; the three screens already paint it.
         */
        series: Object.freeze([1, 2, 3, 4].map(
            (position) => readVariable(styles, `--chart-series-${position}`, FALLBACK.series[position - 1]),
        )),
    });
}

/**
 * Reports when `<html>` enters or leaves dark mode, so it can be redrawn.
 *
 * Filament switches the theme by adding and removing the `dark` class on `<html>`, without
 * reloading: without this observer the whole panel would change theme except the charts, which is
 * exactly what § Charts — Dark warns about.
 *
 * It only notifies when the mode **changes**, not on any `class` tweak: Alpine and Livewire write
 * classes on the root for other reasons, and repainting on each one would destroy and rebuild the
 * canvas for nothing.
 *
 * @param {() => void} redraw
 * @returns {() => void} Function to stop observing.
 */
export function observeThemeChange(redraw) {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') {
        return () => {};
    }

    const root = document.documentElement;
    let wasDark = root.classList.contains('dark');

    const observer = new MutationObserver(() => {
        const isDark = root.classList.contains('dark');

        if (isDark === wasDark) {
            return;
        }

        wasDark = isDark;
        redraw();
    });

    observer.observe(root, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
}

/**
 * The same as {@see observeThemeChange}, but for the screens where **nobody chooses** the theme:
 * the reader of a shared clipping (ADR 0011).
 *
 * There is no account there and there can be no stored preference —storing one would be writing on
 * the professional's device, which is exactly what that route avoids: no cookie, no preference,
 * nothing—, so the operating system decides and the theme is read with `prefers-color-scheme`,
 * just as `resources/css/reader.css` does. Without this, the whole page would switch theme except
 * the charts, which is exactly what DESIGN.md § Charts — Dark warns about.
 *
 * @param {() => void} redraw
 * @returns {() => void} Function to stop listening.
 */
export function observeColorSchemeChange(redraw) {
    if (typeof globalThis.matchMedia !== 'function') {
        return () => {};
    }

    const query = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => redraw();

    query.addEventListener('change', listener);

    return () => query.removeEventListener('change', listener);
}
