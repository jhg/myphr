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
 * Un valor con su etiqueta y su unidad, siempre juntos (Do's #2 y #7 de DESIGN.md: un número suelto
 * es un número que se malinterpreta). El valor va en IBM Plex Mono con contraste alto, nunca en gris
 * claro.
 *
 * @param {object} params
 * @param {string} params.label
 * @param {string} params.value Ya formateado (`formatNumber` o la fecha).
 * @param {string} [params.unit]
 * @param {'neutral'|'good'|'warning'} [params.tone]
 * @returns {HTMLDivElement}
 */
export function createStatTile({ label, value, unit, tone = 'neutral' }) {
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
