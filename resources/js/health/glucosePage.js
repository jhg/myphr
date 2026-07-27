/**
 * Componente Alpine de la pantalla de glucemia (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).
 *
 * El contrato del DOM lo fija `resources/views/phr/pages/glucose.blade.php`: nada de `wire:model`
 * (ADR 0002), los campos se leen por `x-ref` y el sobre cifrado sube como argumento de
 * `storeEvent`, nunca como propiedad de Livewire.
 *
 * **El servidor no puede filtrar por tipo** (ADR 0006, ver JSDoc de `Glucose::fetchEvents()`):
 * `fetchEvents` trae todos los eventos del usuario y aquí se descifra cada uno y se descarta el
 * que no sea `type === 'glucose'`. Un sobre que no abre no tumba la pantalla: se cuenta y se avisa,
 * porque un fallo de descifrado silencioso es justo lo que el ADR 0004 prohíbe.
 *
 * **El método de medición no se mezcla en silencio** (ADR 0008): la gráfica traza una serie por
 * método y el pie de la gráfica dice siempre cuáles incluye.
 *
 * **No se convierte entre mg/dL y mmol/L.** La unidad es una preferencia de presentación (ADR
 * 0006, "La unidad de medida es una preferencia del usuario"), no un requisito del evento: cada
 * registro lleva la suya. Convertir para mezclarlas en una sola serie exigiría fijar precisión y
 * redondeo (ADR 0007, "hay que fijar precisión y redondeo en lugar de dejarlo al azar"), que esta
 * versión no aborda; los eventos en otra unidad se dejan fuera de la gráfica y se cuentan en el pie.
 *
 * **Los cuatro campos comunes a todo evento** (origen manual/aparato, aparato, quién registra, nota
 * libre; ADR 0006) no se construyen aquí: viven en `eventCommonFields.js`, en una función pura
 * (`buildCommonEventFields`) reutilizable por cualquier pantalla de evento (tensión, comidas,
 * insulina), y `buildGlucoseContent` los recibe ya construidos para desplegarlos en el nivel
 * superior del contenido, junto a `v`, `type` y `tz`, nunca dentro de `data`.
 *
 * **La fecha del evento no se convierte aquí.** `datetimeLocalToCanonical` vive en
 * `datetimeLocal.js` porque lo que devuelve entra como dato asociado del AEAD (ADR 0004): si cada
 * pantalla llevara su copia y una se desviara, sus sobres dejarían de abrirse.
 *
 * Las funciones exportadas antes de `glucosePage()` son la lógica pura del componente, para poder
 * probarlas sin montar Alpine ni Chart.js (`tests/js/glucosePage.test.mjs`).
 */

import Chart from 'chart.js/auto';

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { settings } from '../auth/settings.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { formatChartDate, formatDateTime, joinList, t } from '../i18n/index.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, observeThemeChange } from './chartTheme.js';
import { dateRangeControl } from './dateRange.js';
import { datetimeLocalToCanonical } from './datetimeLocal.js';
import { buildCommonEventFields } from './eventCommonFields.js';
import { openEvent, sealEvent } from './eventEnvelope.js';
import { parseNumericValue } from './numericValue.js';
import { savedNotice } from './savedNotice.js';

/** Unidad por defecto cuando no hay preferencia guardada en los ajustes del usuario (ADR 0006). */
const DEFAULT_UNIT = 'mg/dL';

/**
 * Resuelve el código LOINC de (método, unidad) contra la tabla del catálogo del servidor (ADR
 * 0005, ADR 0008). Nunca inventa uno: si la combinación no está, falla de forma visible.
 *
 * @param {list<{method: string, unit: string, code: string}>} loincTable
 * @param {string} method
 * @param {string} unit
 * @returns {string}
 * @throws {Error} Si no existe código para esa combinación.
 */
export function resolveLoincCode(loincTable, method, unit) {
    const entry = loincTable.find((row) => row.method === method && row.unit === unit);

    if (entry === undefined) {
        throw new Error(t('common.noLoincCode', { method, unit }));
    }

    return entry.code;
}

/**
 * Construye el contenido en claro de un evento de glucemia, con la forma del ADR 0006 más el
 * método del ADR 0008. El valor viaja como cadena, nunca como número (ADR 0004: decimales como
 * cadena).
 *
 * `common` son los cuatro campos que comparte cualquier tipo de evento (origen, aparato, quién
 * registra, nota: ver `eventCommonFields.js`) y van en el nivel superior del contenido, no dentro de
 * `data`. `mealContext` es propio de la glucemia y es opcional: si no se indica (cadena vacía o
 * ausente), no entra en `data` en absoluto, en vez de guardarse como cadena vacía (ADR 0006, «un
 * desplegable que ya viene con "en ayunas" escrito convierte el descuido en un dato falso»).
 *
 * @param {object} params
 * @param {string} params.value Tal cual lo escribió la persona, ya como cadena.
 * @param {string} params.unit Código UCUM.
 * @param {string} params.method Token de `GlucoseMeasurementMethod`.
 * @param {string} [params.mealContext] Token de `MealContext`, o vacío/ausente para «sin especificar».
 * @param {string} params.tz Desfase `±HH:MM` del momento del registro.
 * @param {list<{method: string, unit: string, code: string}>} params.loincTable
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Ya construido por `buildCommonEventFields`.
 * @returns {{v: 1, type: 'glucose', tz: string, origin: string, recordedBy: string, device?: string,
 *           note?: string, data: {value: string, unit: string, loinc: string, method: string, mealContext?: string}}}
 * @throws {Error} Si falta el valor o no hay código LOINC para (método, unidad).
 */
export function buildGlucoseContent({ value, unit, method, mealContext, tz, loincTable, common }) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(t('glucose.missingValue'));
    }

    const loinc = resolveLoincCode(loincTable, method, unit);

    const data = { value, unit, loinc, method };

    if (typeof mealContext === 'string' && mealContext.trim() !== '') {
        data.mealContext = mealContext;
    }

    return {
        v: 1,
        type: 'glucose',
        tz,
        ...common,
        data,
    };
}

/**
 * Resuelve la etiqueta del contexto de comida de un evento ya descifrado, tolerando que el campo no
 * exista (ADR 0006: el contexto es opcional y se omite del contenido cuando no se indicó).
 *
 * @param {{mealContexts: list<{token: string, label: string}>}} catalog
 * @param {{mealContext?: string}} data
 * @returns {string|null} `null` cuando el evento no trae contexto.
 */
export function mealContextLabel(catalog, data) {
    if (typeof data.mealContext !== 'string' || data.mealContext === '') {
        return null;
    }

    return catalog.mealContexts.find((row) => row.token === data.mealContext)?.label ?? data.mealContext;
}

/**
 * Descarta los eventos descifrados que no son de tipo `glucose`. El servidor no puede hacer este
 * filtro porque el tipo va cifrado dentro del sobre (ADR 0006): es responsabilidad del cliente.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Ya descifrados.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterGlucoseEvents(events) {
    return events.filter((event) => event.content?.type === 'glucose');
}

/**
 * Agrupa eventos de glucemia por método de medición para la gráfica (ADR 0008: "las estadísticas
 * no mezclan métodos en silencio"), y deja fuera los que no están en la unidad de presentación
 * (no se convierte entre mg/dL y mmol/L, ver JSDoc del módulo).
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} glucoseEvents Ya filtrados por
 *        `filterGlucoseEvents`.
 * @param {string} presentationUnit Unidad que se está mostrando (código UCUM).
 * @returns {{seriesByMethod: Record<string, list<{x: number, y: number}>>, excludedByUnit: number}}
 */
export function groupGlucoseByMethod(glucoseEvents, presentationUnit) {
    /** @type {Record<string, list<{x: number, y: number}>>} */
    const seriesByMethod = {};
    let excludedByUnit = 0;

    for (const event of glucoseEvents) {
        const { data } = event.content;

        if (data.unit !== presentationUnit) {
            excludedByUnit += 1;

            continue;
        }

        if (seriesByMethod[data.method] === undefined) {
            seriesByMethod[data.method] = [];
        }

        seriesByMethod[data.method].push({ x: Date.parse(event.occurredAt), y: Number(data.value) });
    }

    for (const points of Object.values(seriesByMethod)) {
        points.sort((a, b) => a.x - b.x);
    }

    return { seriesByMethod, excludedByUnit };
}

/**
 * Texto del pie de la gráfica: qué métodos incluye (ADR 0008) y qué se ha quedado fuera por estar
 * en otra unidad (no se convierte, ver JSDoc del módulo).
 *
 * Sin ningún registro de glucemia —el caso de cualquier usuario nuevo— dice lo mismo que la lista
 * («Todavía no hay registros de glucemia.») en vez de «No hay datos que mostrar en esta unidad»,
 * que insinúa que hay registros guardados en otra unidad cuando no hay ninguno.
 *
 * @param {object} params
 * @param {list<string>} params.methodLabels Etiquetas de los métodos que sí entran en la gráfica.
 * @param {string} params.presentationUnit Unidad que se está mostrando (código UCUM).
 * @param {number} params.excludedByUnit Registros dejados fuera por estar en otra unidad.
 * @param {boolean} params.hasEvents Si hay algún registro de glucemia, en cualquier unidad.
 * @returns {string}
 */
export function chartCaptionText({ methodLabels, presentationUnit, excludedByUnit, hasEvents }) {
    if (!hasEvents) {
        return t('glucose.empty');
    }

    const methodsText = methodLabels.length > 0
        ? t('glucose.caption.includes', { methods: joinList(methodLabels) })
        : t('glucose.caption.noneInUnit', { unit: presentationUnit });

    const excludedText = excludedByUnit > 0
        ? t('glucose.caption.excluded', { count: excludedByUnit, unit: presentationUnit })
        : '';

    return `${methodsText}${excludedText}`;
}

/** @returns {string} Ahora mismo, en la forma que espera un `<input type="datetime-local" step="1">`. */
function nowAsDatetimeLocalValue() {
    return toDatetimeLocalValue(new Date());
}

/**
 * @param {Date} date
 * @returns {string}
 */
function toDatetimeLocalValue(date) {
    const pad = (value) => String(value).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Segunda codificación de cada serie, además del color: patrón de trazo y forma del punto. Quien
 * no distingue los colores —daltonismo, pantalla en blanco y negro, impresión— sigue pudiendo
 * decir qué línea es qué método por la forma (Do's #3). Los colores salen de `chartColors()`, que
 * los lee del tema en cada dibujado (ver `chartTheme.js`).
 */
const CHART_SERIES_SHAPES = Object.freeze([
    Object.freeze({ borderDash: [], pointStyle: 'circle' }),
    Object.freeze({ borderDash: [6, 4], pointStyle: 'triangle' }),
    Object.freeze({ borderDash: [2, 3], pointStyle: 'rect' }),
]);

/**
 * Familias de DESIGN.md § Typography. Mismo motivo que `CHART_COLORS`: en `<canvas>` la fuente se
 * declara por nombre, no por variable CSS.
 */
const CHART_FONTS = Object.freeze({
    body: "'Open Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
});

/**
 * Familia y tamaño por defecto de todo el lienzo, en el único sitio donde Chart.js los admite:
 * `Chart.defaults.font`. No existe una clave `font` en la raíz de `options` —Chart.js resuelve la
 * tipografía de cada elemento contra estos valores por defecto—, así que ponerla allí sería
 * configuración muerta que aparenta cubrir lo que no cubre: cualquier elemento que se añadiera
 * después (un subtítulo, etiquetas de dato) heredaría la fuente de fábrica de la librería en vez
 * de la de DESIGN.md.
 */
Chart.defaults.font.family = CHART_FONTS.body;
Chart.defaults.font.size = 13;

/**
 * Trazados de Heroicons v2 (outline, 24×24), la misma familia que usa el panel. El de la lista es
 * el matraz de `Glucose::$navigationIcon`, para que el icono guía de cada registro sea el mismo
 * que el de la sección.
 */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    beaker: 'M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 '
        + '24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 '
        + '15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 '
        + '3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5',
});

/**
 * Icono decorativo de 20px (DESIGN.md § Lists: «20px icon»). Va con `aria-hidden`: nunca lleva
 * información que no esté también en el texto (Do's #3, el color y el icono acompañan, no
 * sustituyen).
 *
 * @param {'warning'|'info'|'beaker'} name
 * @param {string} className
 * @returns {SVGSVGElement}
 */
function createIcon(name, className) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');

    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);

    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', ICON_PATHS[name]);
    svg.appendChild(path);

    return svg;
}

/**
 * Aviso en bloque con icono, del tipo que DESIGN.md § Chips (Status Chip) fija para los estados:
 * color + icono + texto, nunca color a secas (Do's #3).
 *
 * @param {object} params
 * @param {'error'|'info'} params.tone
 * @param {string} params.message
 * @returns {HTMLDivElement}
 */
function createCallout({ tone, message }) {
    const callout = document.createElement('div');

    /**
     * Los dos tonos salen de los tokens de aviso (`error-*` / `info-*`, ver `theme.css`), que ya
     * llevan dentro el par de § Chips corregido a AA —la tinta de error es #B91C1C y no el
     * #DC2626, que sobre #FEF2F2 da 4.41:1— y su equivalente de § Dark Mode. El error lleva además
     * la elevación Large, que DESIGN.md reserva a «modals, critical alerts»: un registro clínico
     * que no se puede mostrar lo es. El info va en Body Large porque es una instrucción accionable.
     */
    callout.className = tone === 'error'
        ? 'flex items-start gap-3 rounded-control border border-error-outline bg-error-surface p-pad-md '
            + 'text-body text-error-ink shadow-large'
        : 'flex items-start gap-3 rounded-control border border-info-outline bg-info-surface p-pad-md '
            + 'text-body-lg text-info-ink';

    if (tone === 'error') {
        callout.setAttribute('role', 'alert');
    }

    callout.appendChild(createIcon(tone === 'error' ? 'warning' : 'info', 'size-5 shrink-0'));

    const text = document.createElement('p');
    text.textContent = message;
    callout.appendChild(text);

    return callout;
}

/**
 * Chip de estado (DESIGN.md § Chips · Status Chip, variante info): 12px bold en mayúsculas, 4px de
 * radio, 4px/12px de relleno.
 *
 * El tamaño va en `text-status-chip` y no en `text-caption`: los dos son 12px, pero el segundo es
 * el papel de las marcas de tiempo y arrastra su tracking de 0.01em, que aquí no pinta nada.
 *
 * @param {string} label
 * @returns {HTMLSpanElement}
 */
function createStatusChip(label) {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center rounded-chip border border-info-outline bg-info-surface '
        + 'px-3 py-1 text-status-chip uppercase text-info-ink';
    chip.textContent = label;

    return chip;
}

/**
 * Chip de filtro (DESIGN.md § Chips · Filter Chip): píldora #F0F7FF con borde #CBD5E1 y texto
 * #475569 de 13px semibold, 6px/14px de relleno. Se usa para el contexto de comida, que no es un
 * estado clínico sino una circunstancia de la medida.
 *
 * @param {string} label
 * @returns {HTMLSpanElement}
 */
function createFilterChip(label) {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center rounded-full border border-chip-outline bg-chip-surface '
        + 'px-3.5 py-1.5 text-helper font-semibold text-chip-ink';
    chip.textContent = label;

    return chip;
}

/**
 * @param {unknown} failure
 * @returns {string}
 */
function describeError(failure) {
    if (failure instanceof EnvelopeError) {
        return t('common.undecryptable');
    }

    if (failure instanceof Error && failure.message !== '') {
        return failure.message;
    }

    return t('common.saveFailed');
}

/**
 * Tamaño de página del historial. Es el mismo valor que el `$limit` por defecto de
 * `HealthEventPage::fetchEvents()`: los argumentos son posicionales, así que pasar el rango obliga
 * a pasar también el cursor y el límite, y aquí se repite el valor de siempre para no cambiar de
 * paso la cantidad de eventos que baja cada carga.
 */
const HISTORY_FETCH_LIMIT = 100;

/**
 * Factoría del componente Alpine. Se registra como `phrGlucosePage`.
 *
 * @returns {object}
 */
export function glucosePage() {
    return {
        ...savedNotice(),
        ...dateRangeControl(),

        error: '',
        catalog: null,
        loading: false,

        /** Sobres descifrados que fallaron al abrir en la última carga (no tumban la pantalla). */
        failedToOpenCount: 0,

        /** Eventos de glucemia en otra unidad que la gráfica dejó fuera en la última carga. */
        excludedByUnitCount: 0,

        /** Instancia de Chart.js viva, para poder destruirla antes de repintar. */
        chart: null,

        /**
         * Últimos eventos que se pintaron. No es caché de datos: es lo que permite rehacer la
         * gráfica cuando cambia el tema sin volver a pedir ni a descifrar nada (ver `chartTheme.js`;
         * Chart.js congela los colores al construir el lienzo).
         */
        chartEvents: [],

        init() {
            this.catalog = JSON.parse(document.querySelector('[data-phr-glucose-catalog]').textContent);

            /**
             * DESIGN.md § Charts — Dark: «a chart must also re-read them and redraw when the `.dark`
             * class on `<html>` changes; otherwise the whole panel switches theme except the
             * charts». Solo se repinta si ya hay gráfica: con la sesión bloqueada no hay nada que
             * dibujar y `renderChart` pediría refs que no tocan.
             */
            observeThemeChange(() => {
                if (this.chart !== null) {
                    this.renderChart(this.chartEvents);
                }
            });

            /**
             * Las opciones de `unit`, `method` y `mealContext` las renderiza el servidor en Blade
             * (ADR 0002, ADR 0005): no se rellenan aquí. Ver el comentario al inicio de
             * `glucose.blade.php`.
             *
             * La unidad preseleccionada sí es cosa del cliente: es preferencia de presentación
             * (ADR 0006) que vive en los ajustes cifrados, así que el servidor no puede leerla.
             */
            this.$refs.unit.value = settings()?.glucoseUnit ?? DEFAULT_UNIT;

            this.$refs.occurredAt.value = nowAsDatetimeLocalValue();

            if (isUnlocked()) {
                void this.loadHistory();

                return;
            }

            this.renderLocked();
            document.addEventListener(SESSION_READY_EVENT, () => void this.loadHistory(), { once: true });
        },

        /**
         * Guarda el registro.
         *
         * `loading` cubre TODA la operación, no solo la descarga del historial: entre el clic y el
         * repintado hay derivación de clave, sellado AEAD e ida y vuelta a Livewire, y sin señal
         * alguna la persona vuelve a pulsar el botón. La plantilla lo usa para deshabilitarlo,
         * marcar `aria-busy` y cambiar el texto (Do's #3), igual que las pantallas de acceso.
         */
        async submit() {
            this.error = '';
            this.clearSaved();
            this.loading = true;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    throw new Error(t('common.noSession'));
                }

                const rawValue = this.$refs.value.value.trim();

                if (rawValue === '') {
                    throw new Error(t('glucose.missingValue'));
                }

                // Valida el formato numérico y normaliza la coma a punto (ver JSDoc de
                // `numericValue.js`). El resultado sigue siendo cadena: no se convierte a número
                // (ADR 0004).
                const value = parseNumericValue(rawValue, t('field.value'));

                const localDatetime = this.$refs.occurredAt.value;

                if (localDatetime === '') {
                    throw new Error(t('common.missingDate'));
                }

                const { occurredAt, tz } = datetimeLocalToCanonical(localDatetime);

                // `origin` no se pregunta: la inserción aquí siempre es manual (la persona lee el
                // valor en su glucómetro o sensor y lo teclea), así que `buildCommonEventFields`
                // lo fija a `manual` por defecto (ver JSDoc de `eventCommonFields.js`).
                const common = buildCommonEventFields({
                    device: this.$refs.device.value,
                    recordedBy: this.$refs.recordedBy.value,
                    note: this.$refs.note.value,
                });

                const content = buildGlucoseContent({
                    value,
                    unit: this.$refs.unit.value,
                    method: this.$refs.method.value,
                    mealContext: this.$refs.mealContext.value,
                    tz,
                    loincTable: this.catalog.loinc,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.value.value = '';

                /**
                 * La fecha vuelve a «ahora»: si se quedara con la del registro recién guardado, el
                 * siguiente valor se apuntaría en silencio a un instante pasado, y una glucemia con
                 * hora equivocada es un dato clínico falso que ya no se puede distinguir del bueno.
                 */
                this.$refs.occurredAt.value = nowAsDatetimeLocalValue();

                await this.loadHistory();

                /** Al final de todo: el aviso confirma la operación entera, no solo el POST. */
                this.confirmSaved();
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /** Descarga, descifra, filtra y pinta el historial (lista y gráfica). */
        async loadHistory() {
            this.loading = true;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    this.renderLocked();

                    return;
                }

                /**
                 * El rango sí lo aplica el servidor: `occurred_at` es columna en claro (ADR 0006) y
                 * acotarla ahorra descargar y descifrar meses de eventos de otros tipos que este
                 * módulo tiraría igualmente. El tipo se sigue descartando aquí, que es lo que el
                 * servidor no puede hacer.
                 */
                const range = this.historyRange();
                const rawEvents = await this.$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to);

                let failedToOpen = 0;
                const opened = [];

                for (const rawEvent of rawEvents) {
                    try {
                        const content = openEvent({
                            userId,
                            occurredAt: rawEvent.occurredAt,
                            envelope: rawEvent.payload,
                        });

                        opened.push({ id: rawEvent.id, occurredAt: rawEvent.occurredAt, content });
                    } catch {
                        /** Un sobre que no abre no tumba la pantalla (ADR 0004): se cuenta y se avisa. */
                        failedToOpen += 1;
                    }
                }

                this.failedToOpenCount = failedToOpen;

                const glucoseEvents = filterGlucoseEvents(opened);

                this.renderList(glucoseEvents);
                this.renderChart(glucoseEvents);
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /**
         * Sin clave no se puede descifrar nada: se dice, no se pinta una lista vacía.
         *
         * Perder la clave en mitad de la sesión es normal (ADR 0003), así que la gráfica también se
         * destruye: dejar en pantalla las líneas de la carga anterior mostraría valores descifrados
         * de una sesión que ya no está desbloqueada, y el pie seguiría diciendo qué métodos
         * «incluye» una gráfica que ya no se puede refrescar.
         */
        renderLocked() {
            this.$refs.list.replaceChildren(createCallout({ tone: 'info', message: t('common.locked.history') }));

            this.failedToOpenCount = 0;
            this.excludedByUnitCount = 0;
            this.chartEvents = [];

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            this.paintLegend([]);
            this.$refs.chartCaption.textContent = t('common.locked.history');
        },

        /** @param {list<{id: string, occurredAt: string, content: object}>} glucoseEvents */
        renderList(glucoseEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (glucoseEvents.length === 0) {
                const empty = document.createElement('p');
                /** #475569, el texto secundario de DESIGN.md; nunca un gris apagado (Don'ts #10). */
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('glucose.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                /** El borde va en cada item (DESIGN.md § Lists), no en un divisor del contenedor. */
                list.className = 'flex flex-col';

                for (const event of glucoseEvents) {
                    list.appendChild(this.renderListItem(event));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * Item de historial con la forma de DESIGN.md § Lists: borde inferior #E2E8F0, 14px/16px de
         * relleno, 48px de alto mínimo (objetivo táctil, Do's #2), icono guía de 20px en #0077B6 y
         * texto secundario #475569 de 13px.
         *
         * El valor, la unidad y el código LOINC van en IBM Plex Mono (`font-mono`) porque son
         * valor médico y código: Do's #7 lo exige para que no se lean mal. El método y el contexto
         * dejan de ser texto concatenado y pasan a ser chips.
         *
         * El `<li>` NO lleva `hover:` ni `active:`: DESIGN.md § Lists reserva esos dos estados a un
         * elemento de lista pulsable, y este no es enlace ni botón —no tiene destino, ni manejador,
         * ni foco—. Prometer una interacción que no ocurre es peor que no prometerla; el día que el
         * item lleve a un detalle, volverán junto con el `<a>`, su objetivo táctil (Do's #2) y su
         * indicador de foco (Do's #9).
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @returns {HTMLLIElement}
         */
        renderListItem(event) {
            const { data } = event.content;

            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('beaker', 'mt-0.5 size-5 shrink-0 text-accent'));

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-2';

            /** Primera línea: la medida. Va en monoespaciada y en el texto principal #0F172A. */
            const measurement = document.createElement('p');
            measurement.className = 'font-mono text-body text-ink';

            /**
             * Sin `font-semibold`: de IBM Plex Mono solo se empaqueta el peso 400 (§ Typography ·
             * Code la define «regular»), así que pedir 600 haría que el navegador sintetizara una
             * falsa negrita, engordando y deformando justo los glifos numéricos que Do's #7 quiere
             * inconfundibles. El valor destaca por ser lo primero de la línea y llevar la tinta
             * principal, frente al gris secundario de la unidad.
             */
            const value = document.createElement('span');
            value.textContent = data.value;
            measurement.appendChild(value);

            const unit = document.createElement('span');
            unit.className = 'ml-1 text-ink-secondary';
            unit.textContent = data.unit;
            measurement.appendChild(unit);

            body.appendChild(measurement);

            const methodLabel = this.catalog.methods.find((row) => row.token === data.method)?.label ?? data.method;
            const contextLabel = mealContextLabel(this.catalog, data);

            const chips = document.createElement('div');
            chips.className = 'flex flex-wrap items-center gap-2';
            chips.appendChild(createStatusChip(methodLabel));

            /** Sin contexto de comida (ADR 0006, opcional): no se muestra chip en su lugar. */
            if (contextLabel !== null) {
                chips.appendChild(createFilterChip(contextLabel));
            }

            body.appendChild(chips);

            /**
             * Texto secundario: marca de tiempo y código LOINC, ambos numéricos → monoespaciada, y
             * en el tamaño Code de § Typography (14px), que es el papel que DESIGN.md define para
             * «medical codes, IDs, data fields».
             */
            const meta = document.createElement('p');
            meta.className = 'font-mono text-code text-ink-secondary';
            meta.textContent = `${formatDateTime(event.occurredAt)} · LOINC ${data.loinc}`;
            body.appendChild(meta);

            item.appendChild(body);

            return item;
        },

        /**
         * Pinta la gráfica, o no pinta nada si no hay datos que mostrar (un lienzo con ejes vacíos
         * parece un fallo, no un estado vacío legítimo).
         *
         * El eje X es de categoría, no lineal sobre epoch: no hay adaptador de fechas de Chart.js
         * instalado, así que las etiquetas se formatean aquí mismo con `formatChartDate`, en el
         * idioma activo, y se comparten entre todos los métodos por posición, para que un mismo
         * instante quede en la misma columna aunque solo un método tenga dato ahí.
         *
         * @param {list<{id: string, occurredAt: string, content: object}>} glucoseEvents
         */
        renderChart(glucoseEvents) {
            /**
             * Se guardan para poder repintar cuando cambia el tema (ver `init()`): Chart.js congela
             * los colores al construir el lienzo, así que la única forma de conmutar es rehacer la
             * gráfica con los mismos datos.
             */
            this.chartEvents = glucoseEvents;

            /** Colores del tema activo, leídos ahora y no al cargar el módulo (`chartTheme.js`). */
            const colors = chartColors();

            const presentationUnit = this.$refs.unit.value;
            const { seriesByMethod, excludedByUnit } = groupGlucoseByMethod(glucoseEvents, presentationUnit);

            this.excludedByUnitCount = excludedByUnit;

            const methods = Object.keys(seriesByMethod);

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            const timestamps = [...new Set(methods.flatMap((method) => seriesByMethod[method].map((point) => point.x)))]
                .sort((a, b) => a - b);

            if (timestamps.length === 0) {
                this.paintLegend([]);
            } else {
                const labels = timestamps.map((timestamp) => formatChartDate(timestamp));

                /**
                 * Descriptores de serie, uno por método. Son a la vez lo que consume Chart.js y lo
                 * que pinta la leyenda en HTML (ver `chartLegend.js`): una sola fuente, para que la
                 * leyenda no pueda quedarse con un color o una forma distintos de los de la línea.
                 */
                const series = methods.map((method, index) => ({
                    label: this.catalog.methods.find((row) => row.token === method)?.label ?? method,
                    color: colors.series[index % colors.series.length],
                    ...CHART_SERIES_SHAPES[index % CHART_SERIES_SHAPES.length],
                }));

                const datasets = series.map((entry, index) => {
                    const byTimestamp = new Map(seriesByMethod[methods[index]].map((point) => [point.x, point.y]));

                    return {
                        label: entry.label,
                        data: timestamps.map((timestamp) => byTimestamp.get(timestamp) ?? null),
                        borderColor: entry.color,
                        backgroundColor: entry.color,
                        pointBackgroundColor: entry.color,
                        pointBorderColor: colors.surface,
                        pointBorderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        borderWidth: 2,
                        /** Segunda codificación, además del color (Do's #3): trazo y forma del punto. */
                        borderDash: [...entry.borderDash],
                        pointStyle: entry.pointStyle,
                        tension: 0.3,
                        spanGaps: true,
                    };
                });

                this.paintLegend(series);

                this.chart = new Chart(this.$refs.chart, {
                    type: 'line',
                    data: { labels, datasets },
                    options: {
                        maintainAspectRatio: false,
                        color: colors.tick,
                        scales: {
                            x: {
                                type: 'category',
                                /**
                                 * La rejilla puede ser tenue (`--chart-grid`, decorativa: 1.23:1 en
                                 * claro y 1.39:1 en oscuro), pero la LÍNEA DE EJE no: es la
                                 * referencia contra la que se lee un valor de glucemia, y a esa
                                 * ratio era casi invisible (Don'ts #10). Va en el mismo tono de los
                                 * rótulos (`--chart-tick`: 7.58:1 en claro, 8.35:1 en oscuro).
                                 */
                                grid: { color: colors.grid },
                                border: { color: colors.tick },
                                /** Las etiquetas del eje son fechas y horas: valores, no prosa. */
                                ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                            },
                            y: {
                                grid: { color: colors.grid },
                                border: { color: colors.tick },
                                /** Do's #7: los valores de medida, en IBM Plex Mono. */
                                ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                                title: {
                                    display: true,
                                    text: presentationUnit,
                                    color: colors.tick,
                                    /**
                                     * Peso 400: de IBM Plex Mono solo se empaqueta ese (§ Typography
                                     * · Code es «regular»), y pedir 600 obligaría al navegador a
                                     * sintetizar una falsa negrita sobre el código de la unidad.
                                     */
                                    font: { family: CHART_FONTS.mono, size: 13, weight: 400 },
                                },
                            },
                        },
                        plugins: {
                            /**
                             * La leyenda vive fuera del lienzo, en HTML (ver `chartLegend.js`).
                             * `display: false` en vez de `legend: false`: con `false` Chart.js
                             * descarta el plugin entero y `chart.legend` deja de existir; así el
                             * plugin sigue en pie, su `fit()` devuelve alto 0 y no roba nada de los
                             * 320px del contenedor, que es justo lo que desbordaba.
                             */
                            legend: { display: false },
                            /**
                             * DESIGN.md § Tooltips: 8px de radio, 13px, 8/14px de relleno. El par
                             * fondo/tinta sale del tema, porque el tooltip es el único componente
                             * que se invierte respecto de la interfaz: en claro #0F172A sobre
                             * #FFFFFF y en oscuro #E8EEF7 sobre #0B1220 (§ Charts — Dark).
                             */
                            tooltip: {
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

            this.renderChartCaption(methods, presentationUnit, excludedByUnit, glucoseEvents.length > 0);
        },

        /**
         * Pinta la leyenda en HTML, fuera del lienzo (ver el JSDoc de `chartLegend.js` para el
         * porqué). Con la lista vacía deja el nodo vacío, que es lo que corresponde cuando no hay
         * gráfica: una leyenda huérfana describiría líneas que no están.
         *
         * @param {list<{label: string, color: string, borderDash: list<number>, pointStyle: string}>} series
         */
        paintLegend(series) {
            renderLegend(
                legendElementFor(this.$refs.chart, 'glucose-chart-legend'),
                legendItems(series),
            );
        },

        /**
         * Pie de la gráfica: qué métodos incluye (ADR 0008) y cuántos registros quedaron fuera por
         * estar en otra unidad (no se convierte, ver JSDoc del módulo).
         *
         * El `<p>` lo pinta Blade, no este método: es el `aria-describedby` del `<canvas>` —la
         * única forma de que la tendencia llegue a quien no ve la gráfica— y necesita un `id`
         * estable. Además tiene que vivir FUERA del contenedor de altura fija: Chart.js exige que
         * el padre del lienzo sea suyo en exclusiva, y un hermano dentro habría desbordado por
         * debajo y podía disparar el bucle de redimensionado del lienzo.
         *
         * @param {list<string>} methods
         * @param {string} presentationUnit
         * @param {number} excludedByUnit
         * @param {boolean} hasEvents
         */
        renderChartCaption(methods, presentationUnit, excludedByUnit, hasEvents) {
            const methodLabels = methods
                .map((method) => this.catalog.methods.find((row) => row.token === method)?.label ?? method);

            this.$refs.chartCaption.textContent = chartCaptionText({
                methodLabels,
                presentationUnit,
                excludedByUnit,
                hasEvents,
            });
        },
    };
}
