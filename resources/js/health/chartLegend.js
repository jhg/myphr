/**
 * Leyenda de las gráficas, en HTML y fuera del `<canvas>`.
 *
 * **Por qué se saca del lienzo.** En Chart.js 4 la leyenda no es un nodo del DOM: es un `Element`
 * dado de alta como caja de maquetación (`layouts.addBox(chart, legend)`), y su `fit()` calcula el
 * alto acumulando una fila por cada tanda de entradas que quepa, midiendo el texto con
 * `ctx.measureText()`. Con `maintainAspectRatio: false` dentro de un contenedor de 320px fijos, ese
 * alto se **resta** del área de datos y depende del número de series, de lo largas que sean sus
 * etiquetas y del ancho de la ventana; si las filas superan `maxHeight`, `Math.min` la recorta y
 * las entradas sobrantes desaparecen. La pantalla de tensión es el caso peor: genera dos series
 * por método (sistólica y diastólica de cada combinación brazo×postura), así que dos entradas
 * cortas se convierten en ocho largas sin que cambie nada del maquetado.
 *
 * **Qué se gana además del alto.** En el lienzo, `usePointStyle: true` dibuja solo la forma del
 * punto y pierde el patrón de trazo, así que las tres series de un mismo azul se distinguían
 * únicamente por el color — justo lo que DESIGN.md Do's #3 prohíbe para un dato clínico. Aquí cada
 * entrada lleva su línea con `stroke-dasharray` **y** su marca (círculo, triángulo, cuadrado), que
 * es lo mismo que distingue la gráfica. Y al ser HTML, el texto usa los tokens de tinta y conmuta
 * solo con el modo oscuro, cosa que un color escrito dentro del `<canvas>` no puede hacer.
 *
 * **No es interactiva, y es a propósito.** El defecto que se arregla es de maquetación, no de falta
 * de interacción. El pie de la gráfica es el `aria-describedby` del lienzo y la única fuente
 * textual de qué contiene (ADR 0008, «Incluye: …»); un conmutador por serie lo desincronizaría —la
 * gráfica mostraría tres de ocho series y el texto accesible seguiría diciendo que las incluye
 * todas— y ocultar una serie clínica sin dejar rastro en el texto es exactamente lo que Don'ts #10
 * quiere evitar. Si algún día hace falta filtrar de verdad, el sitio es un grupo de casillas sobre
 * la gráfica que filtre **los datos de entrada**, y por tanto también el pie.
 */

/**
 * Geometría de la marca de cada entrada, en el sistema de coordenadas del `<svg>` de 24×12.
 */
const SWATCH = Object.freeze({ width: 24, height: 12, middle: 6 });

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Convierte los descriptores de serie que ya construye cada pantalla (los mismos que alimentan a
 * Chart.js) en las entradas de la leyenda.
 *
 * No se pasa por `chart.legend.options.labels.generateLabels()`: las tres pantallas ya tienen el
 * array con etiqueta, color, trazo y forma antes de crear el `Chart`, así que leerlo de ahí no toca
 * ningún interno de la librería y deja esta función pura y probable sin montar Chart.js, como el
 * resto de `tests/js`.
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
    }));
}

/**
 * Marca de la entrada: la misma forma que Chart.js pinta en los puntos de esa serie.
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
 * Muestra de una entrada: la línea con su patrón de trazo más la marca encima.
 *
 * `aria-hidden`: no lleva información que no esté ya en el texto de al lado (Do's #3, el color y la
 * forma acompañan al nombre de la serie, no lo sustituyen).
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
    svg.appendChild(createShape(item.shape, item.color));

    return svg;
}

/**
 * Pinta la leyenda dentro de `element`, sustituyendo lo que hubiera.
 *
 * Vaciar siempre antes de pintar no es cosmética: el historial se repinta entero después de guardar
 * un registro, y una leyenda que solo añadiera iría acumulando la misma serie una vez por guardado.
 * Con la lista vacía deja el nodo vacío, que es lo que corresponde cuando la gráfica no se pinta.
 *
 * @param {HTMLElement|null|undefined} element Contenedor `<ul>`; si no existe, no se hace nada.
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
         * Tinta principal por su papel (`text-ink`), no un tono de la rampa: en modo oscuro
         * `gray-900` pasa a ser la superficie y el texto desaparecería. 13px es el tamaño Helper de
         * § Typography, el mismo que tenía la leyenda del lienzo.
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
 * Resuelve el nodo donde va la leyenda de un lienzo, creándolo si la plantilla no lo trae.
 *
 * Se busca **por `id`, nunca por `x-ref`**, y es deliberado: `GlucosePageTest`, `DashboardPageTest`
 * y el contrato de DOM de `tests/js` exigen que los `$refs` del módulo y los `x-ref` de la
 * plantilla coincidan exactamente, así que un `$refs.chartLegend` obligaría a tocar las cinco
 * plantillas a la vez o rompería esos tests. Por `id` el módulo funciona con la plantilla tal como
 * está hoy, y sigue funcionando el día que Blade pinte el `<ul>` con ese mismo `id`.
 *
 * El nodo va como hermano **del contenedor** del lienzo, no dentro: con
 * `maintainAspectRatio: false` Chart.js exige que el padre del `<canvas>` sea suyo en exclusiva, y
 * un hermano dentro puede disparar el bucle de redimensionado. Además se añade al
 * `aria-describedby` del lienzo, junto al pie, que admite varios identificadores.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} id Identificador estable, para poder describir el lienzo con él.
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
