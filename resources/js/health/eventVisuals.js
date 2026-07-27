/**
 * Piezas de DOM compartidas por todas las vistas de eventos: el aviso, la baldosa de estadística y
 * el estado vacío (DESIGN.md).
 *
 * **Reciben datos y devuelven nodos.** No leen el documento, no conocen ningún `x-ref`, no saben
 * qué pantalla las llama y no hablan con Livewire. Esa es la condición para que el mismo aviso y la
 * misma baldosa aparezcan en el panel del paciente, en el lector del profesional (sin sesión) y en
 * la vista previa de la pantalla de compartir: si una de las tres pintara sus cifras de otra forma,
 * el paciente y el médico estarían mirando dos documentos distintos del mismo dato.
 *
 * Todos los colores van por su **papel** (`error-*`, `info-*`, `bg-surface`, `text-ink`) y nunca por
 * la rampa: los papeles conmutan solos con el tema oscuro y las rampas de acento no se reasignan
 * (ver `theme.css`, § Ramp Mapping — Dark y § Avisos y chips).
 */

/**
 * @param {'warning'|'info'} tone
 * @param {string} message
 * @returns {HTMLDivElement}
 */
export function createCallout(tone, message) {
    const callout = document.createElement('div');

    /**
     * Los tres papeles del aviso —relleno, línea y tinta— por su nombre (`error-*` / `info-*`),
     * igual que en `glucosePage.js`. Escrito con la rampa (`bg-danger-50`, `text-primary-600`) el
     * aviso saldría en modo oscuro con fondo casi blanco y tinta clara encima.
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
 * Tinta de cada lectura clínica de una cifra.
 *
 * Son los papeles semánticos de DESIGN.md, que conmutan solos con el tema oscuro. `neutral` es el
 * caso normal: la mayoría de las cifras (recuento, media, mínimo) no significan nada por sí solas y
 * teñirlas sería decorar, no informar.
 *
 * @type {Record<string, string>}
 */
const TONE_INK = Object.freeze({
    neutral: 'text-ink',
    good: 'text-success-ink',
    warning: 'text-warning-ink',
});

/**
 * Relleno de cada papel semántico cuando lo que se pinta es una **superficie** y no texto: el tramo
 * de una barra, el cuadradito de una leyenda.
 *
 * Se usa la tinta (`success-ink`, `warning-ink`) y no el relleno suave (`*-surface`) porque un tramo
 * de barra es un objeto gráfico y necesita 3:1 contra la tarjeta (WCAG 1.4.11): los rellenos suaves
 * están pensados para llevar texto encima, no para leerse solos. Los dos papeles conmutan con el
 * tema por sí mismos.
 *
 * @type {Record<string, string>}
 */
const TONE_FILL = Object.freeze({
    neutral: 'bg-ink-secondary',
    good: 'bg-success-ink',
    warning: 'bg-warning-ink',
});

/** Alto y ancho del lienzo lógico de la minigráfica, en unidades de su `viewBox`. */
const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 24;

/** Margen vertical del trazo, para que un máximo o un mínimo no se corte contra el borde. */
const SPARKLINE_PADDING = 2;

/**
 * Puntos mínimos para que una minigráfica se pinte.
 *
 * Dos puntos siempre forman una recta perfecta: dibujarla es afirmar una tendencia que no se ha
 * observado. Con menos de tres no se pinta nada, y la tarjeta se queda con sus cifras, que sí son
 * dato.
 */
export const SPARKLINE_MIN_POINTS = 3;

/**
 * Minigráfica de tendencia: una polilínea sin ejes, sin etiquetas y sin leyenda.
 *
 * **Por qué SVG a mano y no Chart.js.** Una tarjeta de estadísticas no lleva una gráfica, lleva un
 * gesto. Chart.js pide un `<canvas>` con su ciclo de vida (instancia que hay que destruir al
 * repintar, colores que hay que releer del tema al cambiar de modo, redibujado al redimensionar), y
 * eso multiplicado por cada baldosa de cada método de cada tipo es un coste real por un trazo de
 * cuatro líneas. Un SVG es un nodo más del fragmento: se tira con el resto cuando la vista se
 * repinta, hereda el color del tema por `currentColor` sin releer nada, y escala solo.
 *
 * **Los huecos son huecos** (misma regla que `dailyBands.js`): un día sin lecturas no aporta punto y
 * **parte el trazo**. Unir por encima del hueco dibujaría una pendiente que nadie ha medido, y
 * rellenarlo con un cero dibujaría una caída que no ocurrió. Un tramo suelto entre dos huecos se
 * marca con un punto, que es exactamente lo que se sabe de él.
 *
 * La posición horizontal es la del día dentro del periodo, no la del punto dentro de la lista: así
 * un hueco de una semana se ve ancho y uno de un día, estrecho.
 *
 * Es decorativa (`aria-hidden`): todo lo que dice está también en las cifras de la baldosa, así que
 * no hay nada que anunciar dos veces (DESIGN.md, Do's #3).
 *
 * @param {list<number|null>} points Un valor por día del periodo, `null` en los días sin lecturas.
 * @returns {SVGElement|null} `null` si no hay tendencia que enseñar.
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
    /** Una serie plana se dibuja centrada: no hay recorrido que escalar, y dividir por cero tampoco. */
    const y = (value) => (span === 0
        ? SPARKLINE_HEIGHT / 2
        : SPARKLINE_PADDING + ((max - value) / span) * usableHeight);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`);
    /**
     * El trazo se estira con la baldosa, así que la relación de aspecto no se conserva; el grosor de
     * la línea sí, con `vector-effect`, o saldría más gruesa en horizontal que en vertical.
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
 * Parte una lista de puntos en tramos de días **consecutivos**: cada salto de índice es un día sin
 * lecturas y abre un tramo nuevo.
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
 * Coordenada con dos decimales: más precisión solo engorda el atributo sin mover ningún píxel.
 *
 * @param {number} value
 * @returns {number}
 */
function round(value) {
    return Math.round(value * 100) / 100;
}

/**
 * Barra horizontal por tramos, con su leyenda debajo.
 *
 * Es la forma estándar de leer un reparto en tres partes —por debajo, dentro, por encima— sin hacer
 * ninguna cuenta. La proporción de cada tramo es su porcentaje, repartido con `flex-grow` para que
 * la barra llene el ancho exacto sin costuras aunque los tres redondeos no sumen 100 clavado.
 *
 * **El color nunca va solo** (DESIGN.md, Do's #3): la barra es decorativa y quien informa es la
 * leyenda, donde cada tramo lleva su etiqueta escrita y su porcentaje como número. En escala de
 * grises, con el tema oscuro o con un lector de pantalla se lee igual.
 *
 * El estilo va por atributo y no por la propiedad `style` a propósito: estos módulos se prueban con
 * un `document` mínimo (ver `tests/js`), y `setAttribute` es lo único que ese documento necesita
 * saber hacer.
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
     * Un tramo vacío se queda en la leyenda con su «0 %». Es información: saber que no hubo ninguna
     * lectura por debajo del rango no es lo mismo que no saber nada de ese tramo.
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
 * Un valor con su etiqueta y su unidad, siempre juntos (Do's #2 y #7 de DESIGN.md: un número suelto
 * es un número que se malinterpreta). El valor va en IBM Plex Mono con contraste alto, nunca en gris
 * claro.
 *
 * @param {object} params
 * @param {string} params.label
 * @param {string} params.value Ya formateado (`formatNumber` o la fecha).
 * @param {string} [params.unit]
 * @param {'neutral'|'good'|'warning'} [params.tone]
 * @param {list<number|null>} [params.trend] Serie diaria para la minigráfica ({@see createSparkline}).
 *        Opcional y sin efecto si no hay tendencia que enseñar: quien ya llamaba a esta función sin
 *        ella sigue obteniendo exactamente la misma baldosa.
 * @returns {HTMLDivElement}
 */
export function createStatTile({ label, value, unit, tone = 'neutral', trend }) {
    const tile = document.createElement('div');
    /**
     * `bg-background` y `border-border`: papeles de § Colors, que conmutan solos con el tema. Con
     * `bg-gray-50` / `border-gray-200` la baldosa saldría en oscuro como un rectángulo casi blanco
     * con marco del color de la tinta.
     */
    tile.className = 'rounded-card border border-border bg-background px-4 py-3';

    const caption = document.createElement('p');
    caption.className = 'text-caption text-ink-secondary';
    caption.textContent = label;
    tile.appendChild(caption);

    /**
     * La cifra en tamaño Headline y la unidad pequeña al lado: la jerarquía la da el tamaño, no el
     * color, así que sigue leyéndose igual en escala de grises y con el tema oscuro.
     *
     * `tone` tiñe la cifra cuando el dato tiene una lectura clínica —dentro o fuera del rango
     * objetivo— y se queda en la tinta normal cuando no la tiene. El color nunca va solo: la cifra y
     * su etiqueta siguen ahí, que es lo que exige DESIGN.md (Do's #3).
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
     * La minigráfica va debajo de la cifra y nunca en su lugar: es contexto («¿va subiendo?»), no
     * dato. Si no hay tendencia que enseñar, la baldosa se queda como estaba.
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
 * Estado vacío con salida.
 *
 * Una frase gris y nada más deja a quien acaba de registrarse sin nada que hacer; con el botón, la
 * única acción posible en ese momento está a un clic. El destino llega **como argumento**, nunca
 * leído del documento: la ruta del panel la decide el servidor de Filament y el lector del
 * profesional no tiene ninguna a la que enviar a nadie, así que `null` es un caso normal y entonces
 * se pinta solo la frase, que es lo que informa.
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
