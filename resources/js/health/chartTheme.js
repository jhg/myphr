/**
 * Paleta de las gráficas, leída del tema en el momento de dibujar.
 *
 * **Por qué no son literales.** Una gráfica se pinta en un `<canvas>`: no hereda ninguna clase y no
 * resuelve `var(--color-…)`, así que cada color hay que dárselo a mano. Eso llevó durante un tiempo
 * a copiar los hexadecimales del tema claro dentro del módulo, y un literal no puede conmutar de
 * tema: en oscuro los rótulos de eje (#475569 sobre la superficie #152238) quedaban en 2.10:1, dos
 * de las tres series en 1.91:1 y 2.46:1 —por debajo del 3:1 de WCAG 1.4.11 para objetos gráficos, o
 * sea una línea clínica invisible, justo lo que DESIGN.md Don'ts #10 prohíbe—, la rejilla salía casi
 * blanca a todo volumen y el borde de punto en #FFFFFF ponía un halo a cada marcador, que
 * § Charts — Dark descarta con esas palabras.
 *
 * DESIGN.md § Charts — Dark lo exige literalmente: «the values must be read at draw time from the
 * CSS variables the theme publishes (`getComputedStyle(document.documentElement)`), never copied
 * into the module as literals», y «a chart must also re-read them and redraw when the `.dark` class
 * on `<html>` changes». Este módulo es esas dos cosas: `chartColors()` y `observeThemeChange()`.
 *
 * Las variables ya las publica `resources/css/filament/phr/theme.css` con sus dos valores
 * (`:root` y `:root.dark`); aquí no se inventa ni se deriva ningún color.
 */

/**
 * Valores de respaldo, y **solo** de respaldo: son los del tema claro, los mismos que declara
 * `theme.css`. Se usan cuando no hay hoja de estilo de la que leer —los tests de `tests/js` corren
 * en Node sin CSS— para que el módulo se pueda importar y probar sin navegador. En el navegador
 * nunca se alcanzan: la variable siempre está definida.
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
 * @param {CSSStyleDeclaration|null} styles
 * @param {string} name Nombre de la propiedad personalizada, con los dos guiones.
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
 * Colores de la gráfica **en este instante**, resueltos contra el tema activo.
 *
 * Hay que llamarla dentro de cada dibujado, no una vez al cargar el módulo: Chart.js congela los
 * colores cuando se construye el lienzo, así que un valor leído al arrancar la página se quedaría
 * con el tema que hubiera entonces.
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
         * Las cuatro series de § Components · Charts, en ese orden y con su equivalente oscuro.
         * A partir de la tercera la leyenda es obligatoria (Do's #3), porque la 3 y la 4
         * reutilizan los matices de Success y Warning; las tres pantallas ya la pintan.
         */
        series: Object.freeze([1, 2, 3, 4].map(
            (position) => readVariable(styles, `--chart-series-${position}`, FALLBACK.series[position - 1]),
        )),
    });
}

/**
 * Avisa cuando `<html>` entra o sale del modo oscuro, para volver a dibujar.
 *
 * Filament conmuta el tema añadiendo y quitando la clase `dark` en `<html>`, sin recargar: sin este
 * observador el panel entero cambiaría de tema menos las gráficas, que es exactamente lo que
 * § Charts — Dark advierte.
 *
 * Solo notifica cuando el modo **cambia**, no en cualquier retoque de `class`: Alpine y Livewire
 * escriben clases en la raíz por otros motivos, y repintar en cada uno destruiría y reconstruiría
 * el lienzo sin necesidad.
 *
 * @param {() => void} redraw
 * @returns {() => void} Función para dejar de observar.
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
 * Lo mismo que {@see observeThemeChange}, pero para las pantallas donde el tema **no lo elige
 * nadie**: la del lector de un recorte compartido (ADR 0011).
 *
 * Allí no hay cuenta y no puede haber preferencia guardada —guardar una sería escribir en el
 * dispositivo del profesional, que es justo lo que esa ruta evita: ni cookie, ni preferencia, ni
 * nada—, así que manda el sistema operativo y el tema se lee con `prefers-color-scheme`, igual que
 * hace `resources/css/reader.css`. Sin esto, la página conmutaría de tema entera menos las gráficas,
 * que es exactamente lo que DESIGN.md § Charts — Dark advierte.
 *
 * @param {() => void} redraw
 * @returns {() => void} Función para dejar de escuchar.
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
