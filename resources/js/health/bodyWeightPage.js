/**
 * Componente Alpine de la pantalla de peso y estatura (ADR 0002, ADR 0004, ADR 0005, ADR 0006,
 * ADR 0008).
 *
 * El contrato del DOM lo fija `resources/views/phr/pages/body-weight.blade.php`: nada de
 * `wire:model` (ADR 0002), los campos se leen por `x-ref` y el sobre cifrado sube como argumento de
 * `storeEvent`, nunca como propiedad de Livewire.
 *
 * **El nombre del componente sigue siendo `phrBodyWeightPage`** aunque la pantalla registre ya dos
 * magnitudes: ese nombre vive en `resources/js/app.js`, y renombrarlo es una tarea aparte (ver el
 * PHPDoc de `App\Filament\Pages\BodyWeight`). El cambio de nombre de ahora es solo de etiqueta
 * visible.
 *
 * **Ningún método de medición** (ADR 0008): una báscula no ofrece variantes que cambien el valor de
 * forma conocida, al revés que el brazo y la postura de la tensión o el sitio de medida de la
 * temperatura, así que aquí no se pregunta método y los códigos LOINC son constantes (ver
 * `App\Catalog\BodyWeightLoincCode` y `App\Catalog\BodyHeightLoincCode`). Llegan ya resueltos en
 * `catalog.loinc` y `catalog.heightLoinc`.
 *
 * **La estatura es opcional en cada registro y se arrastra.** Quien se pesa cada semana la escribe
 * una vez y la deja en blanco después, así que un registro sin estatura no es un registro
 * incompleto: el IMC se calcula con la última estatura conocida que no sea posterior a esa pesada
 * (ver `bodyMassIndex.js`). Sin ninguna estatura registrada no hay IMC y no se enseña nada en su
 * lugar.
 *
 * **No se convierte entre kilogramos y libras.** Cada registro conserva la unidad con la que se
 * anotó (ADR 0006) y la gráfica traza **una serie por unidad** en vez de mezclarlas. Es la misma
 * decisión que en glucemia, pero resuelta al revés que allí: la glucemia deja fuera de la gráfica lo
 * que no está en la unidad de presentación porque entre mg/dL y mmol/L no hay una equivalencia
 * exacta y sí una preferencia guardada en los ajustes; el peso no tiene esa preferencia, así que
 * esconder registros exigiría inventarse cuál es la unidad «buena». Dos series dicen la verdad
 * entera y no ocultan nada.
 *
 * **El servidor no puede filtrar por tipo** (ADR 0006): `fetchEvents` trae todos los eventos del
 * usuario y aquí se descifra cada uno y se descarta el que no sea `type === 'bodyWeight'`. Un sobre
 * que no abre no tumba la pantalla: se cuenta y se avisa (ADR 0004).
 *
 * **Los cuatro campos comunes a todo evento** (origen, aparato, quién registra, nota; ADR 0006) no
 * se construyen aquí: viven en `eventCommonFields.js` y `buildBodyWeightContent` los recibe ya
 * construidos, para desplegarlos en el nivel superior del contenido, nunca dentro de `data`.
 *
 * **El origen no se pregunta en el formulario.** `origin` distingue cómo entró el dato —tecleado
 * frente a importado de un aparato—, y aquí la inserción es siempre manual: se lee el número en la
 * báscula y se teclea. `submit()` lo fija a `'manual'` sin leer ningún campo del DOM; el aparato
 * (`device`) sí es útil (con qué se pesó) y conserva su campo.
 *
 * **La fecha del evento no se convierte aquí.** `datetimeLocalToCanonical` vive en
 * `datetimeLocal.js` porque lo que devuelve entra como dato asociado del AEAD (ADR 0004): si cada
 * pantalla llevara su copia y una se desviara, sus sobres dejarían de abrirse.
 *
 * Las funciones exportadas antes de `bodyWeightPage()` son la lógica pura del componente, para poder
 * probarlas sin montar Alpine ni Chart.js (`tests/js/bodyWeightPage.test.mjs`).
 */

import Chart from 'chart.js/auto';

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { formatChartDate, formatDateTime, formatNumber, joinList, t } from '../i18n/index.js';
import { bodyMassIndex, heightKnownAt } from './bodyMassIndex.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, observeThemeChange } from './chartTheme.js';
import { dateRangeControl } from './dateRange.js';
import { datetimeLocalToCanonical } from './datetimeLocal.js';
import { buildCommonEventFields } from './eventCommonFields.js';
import { openEvent, sealEvent } from './eventEnvelope.js';
import { parseNumericValue } from './numericValue.js';
import { savedNotice } from './savedNotice.js';
import { unitLabel } from './unitLabel.js';

/**
 * Lo mismo que `unitLabel` (ver `unitLabel.js`), pero para las unidades de estatura, que son otra
 * lista del catálogo: la pulgada se guarda como `[in_i]` (UCUM distingue la internacional de la US
 * survey) y se enseña como `in`. Se queda aquí porque solo la usa esta pantalla.
 *
 * @param {{heightUnits: list<{code: string, label: string}>}} catalog
 * @param {string} code
 * @returns {string}
 */
export function heightUnitLabel(catalog, code) {
    return catalog.heightUnits.find((row) => row.code === code)?.label ?? code;
}

/**
 * Construye el contenido en claro de un evento de peso, con la forma del ADR 0006. Los valores
 * viajan como cadena, nunca como número (ADR 0004: decimales como cadena).
 *
 * `common` son los cuatro campos que comparte cualquier tipo de evento (ver `eventCommonFields.js`) y
 * van en el nivel superior del contenido, no dentro de `data`.
 *
 * **La estatura es opcional y, cuando falta, la clave `height` no se escribe.** Ni `null`, ni cadena
 * vacía, ni la estatura del registro anterior copiada: un sobre solo afirma lo que se midió ese día.
 * Copiarla convertiría en medición cada pesada, y entonces la fecha de la estatura —lo único que
 * permite seguir a quien crece— dejaría de significar nada.
 *
 * @param {object} params
 * @param {string} params.value Peso, tal cual lo escribió la persona, ya como cadena.
 * @param {string} params.unit Código UCUM del peso.
 * @param {string} [params.height] Estatura; cadena vacía o ausente cuando no se rellena.
 * @param {string} [params.heightUnit] Código UCUM de la estatura; solo importa si hay estatura.
 * @param {string} params.tz Desfase `±HH:MM` del momento del registro.
 * @param {{loinc: string, heightLoinc: string}} params.catalog
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Ya construido por `buildCommonEventFields`.
 * @returns {{v: 1, type: 'bodyWeight', tz: string, origin: string, recordedBy: string,
 *           device?: string, note?: string, data: {value: string, unit: string, loinc: string,
 *           height?: {value: string, unit: string, loinc: string}}}}
 * @throws {Error} Si falta el peso, su unidad, o la unidad de una estatura que sí se escribió.
 */
export function buildBodyWeightContent({ value, unit, height, heightUnit, tz, catalog, common }) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(t('bodyWeight.missingValue'));
    }

    if (typeof unit !== 'string' || unit.trim() === '') {
        throw new Error(t('bodyWeight.missingUnit'));
    }

    const data = {
        value,
        unit,
        loinc: catalog.loinc,
    };

    if (typeof height === 'string' && height.trim() !== '') {
        if (typeof heightUnit !== 'string' || heightUnit.trim() === '') {
            throw new Error(t('bodyWeight.missingHeightUnit'));
        }

        data.height = {
            value: height,
            unit: heightUnit,
            loinc: catalog.heightLoinc,
        };
    }

    return {
        v: 1,
        type: 'bodyWeight',
        tz,
        ...common,
        data,
    };
}

/**
 * Descarta los eventos descifrados que no son de tipo `bodyWeight`. El servidor no puede hacer este
 * filtro porque el tipo va cifrado dentro del sobre (ADR 0006): es responsabilidad del cliente.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Ya descifrados.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterBodyWeightEvents(events) {
    return events.filter((event) => event.content?.type === 'bodyWeight');
}

/**
 * Agrupa las pesadas por unidad para la gráfica: una serie por unidad, nunca una sola serie con
 * kilogramos y libras mezclados (ver JSDoc del módulo). Cada serie sale ordenada por fecha.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} weightEvents Ya filtrados por
 *        `filterBodyWeightEvents`.
 * @returns {Record<string, list<{x: number, y: number}>>} Indexado por código UCUM.
 */
export function groupBodyWeightByUnit(weightEvents) {
    /** @type {Record<string, list<{x: number, y: number}>>} */
    const seriesByUnit = {};

    for (const event of weightEvents) {
        const { data } = event.content;

        if (seriesByUnit[data.unit] === undefined) {
            seriesByUnit[data.unit] = [];
        }

        seriesByUnit[data.unit].push({ x: Date.parse(event.occurredAt), y: Number(data.value) });
    }

    for (const points of Object.values(seriesByUnit)) {
        points.sort((a, b) => a.x - b.x);
    }

    return seriesByUnit;
}

/**
 * Texto del pie de la gráfica: qué unidades incluye, porque son series distintas y no comparables
 * entre sí.
 *
 * @param {list<string>} unitLabels Etiquetas de las unidades con datos en la gráfica.
 * @returns {string}
 */
export function chartCaptionText(unitLabels) {
    return unitLabels.length > 0
        ? t('bodyWeight.caption.includes', { units: joinList(unitLabels) })
        : t('bodyWeight.caption.empty');
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
 * Segunda codificación de cada serie, además del color (Do's #3): patrón de trazo y forma del punto.
 * Quien no distingue los colores —daltonismo, pantalla en blanco y negro, impresión— sigue pudiendo
 * decir qué línea es qué unidad. Los colores salen de `chartColors()`, que los lee del tema en cada
 * dibujado (ver `chartTheme.js`).
 */
const CHART_SERIES_SHAPES = Object.freeze([
    Object.freeze({ borderDash: [], pointStyle: 'circle' }),
    Object.freeze({ borderDash: [6, 4], pointStyle: 'triangle' }),
    Object.freeze({ borderDash: [2, 3], pointStyle: 'rect' }),
]);

/** Familias de DESIGN.md § Typography, declaradas por nombre porque `<canvas>` no lee variables CSS. */
const CHART_FONTS = Object.freeze({
    body: "'Open Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
});

/**
 * Familia y tamaño por defecto de todo el lienzo, en el único sitio donde Chart.js los admite:
 * `Chart.defaults.font`. Chart.js resuelve la tipografía de cada elemento contra estos valores, así
 * que una clave `font` en la raíz de `options` sería configuración muerta.
 */
Chart.defaults.font.family = CHART_FONTS.body;
Chart.defaults.font.size = 13;

/**
 * Trazados de Heroicons v2 (outline, 24×24), la misma familia que usa el panel. El del historial es
 * la balanza de `BodyWeight::$navigationIcon`, para que el icono guía de cada registro sea el mismo
 * que el de la sección.
 */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    scale: 'M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 '
        + '4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 '
        + '2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 '
        + '1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 '
        + '2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 '
        + '1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z',
});

/**
 * Icono decorativo de 20px (DESIGN.md § Lists: «20px icon»). Va con `aria-hidden`: nunca lleva
 * información que no esté también en el texto (Do's #3).
 *
 * @param {'warning'|'info'|'scale'} name
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
 * Aviso en bloque con icono (DESIGN.md § Chips · Status Chip): color + icono + texto, nunca color a
 * secas (Do's #3). Mismos tokens de aviso (`error-*` / `info-*`) que el resto de pantallas de
 * eventos, que conmutan solos con el tema.
 *
 * @param {object} params
 * @param {'error'|'info'} params.tone
 * @param {string} params.message
 * @returns {HTMLDivElement}
 */
function createCallout({ tone, message }) {
    const callout = document.createElement('div');

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
 * `HealthEventPage::fetchEvents()`: los argumentos son posicionales, así que pasar el rango obliga a
 * pasar también el cursor y el límite, y aquí se repite el valor de siempre.
 */
const HISTORY_FETCH_LIMIT = 100;

/**
 * Factoría del componente Alpine. Se registra como `phrBodyWeightPage`.
 *
 * @returns {object}
 */
export function bodyWeightPage() {
    return {
        ...savedNotice(),
        ...dateRangeControl(),

        error: '',
        catalog: null,
        loading: false,

        /** Sobres descifrados que fallaron al abrir en la última carga (no tumban la pantalla). */
        failedToOpenCount: 0,

        /** Instancia de Chart.js viva, para poder destruirla antes de repintar. */
        chart: null,

        /**
         * Últimos eventos que se pintaron. No es caché de datos: es lo que permite rehacer la
         * gráfica cuando cambia el tema sin volver a pedir ni a descifrar nada (`chartTheme.js`).
         */
        chartEvents: [],

        init() {
            this.catalog = JSON.parse(document.querySelector('[data-phr-body-weight-catalog]').textContent);

            /**
             * DESIGN.md § Charts — Dark: la gráfica tiene que releer los colores y repintarse cuando
             * `<html>` entra o sale del modo oscuro, o el panel entero conmuta menos las gráficas.
             */
            observeThemeChange(() => {
                if (this.chart !== null) {
                    this.renderChart(this.chartEvents);
                }
            });

            /**
             * Las opciones de `unit` las renderiza el servidor en Blade (ADR 0002, ADR 0005): no se
             * rellenan aquí. Ver el comentario al inicio de `body-weight.blade.php`.
             */
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
         * alguna la persona vuelve a pulsar el botón, que en una pantalla de registro clínico
         * significa una pesada duplicada en el historial.
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

                // Valida el formato numérico y normaliza la coma a punto (ver JSDoc de
                // `numericValue.js`); la cadena vacía pasa intacta y la detecta como "falta el dato"
                // `buildBodyWeightContent`. El resultado sigue siendo cadena: no se convierte a
                // número (ADR 0004).
                const value = parseNumericValue(this.$refs.value.value.trim(), t('field.weight'));

                /**
                 * La estatura pasa por la misma validación, y su cadena vacía pasa intacta: dejarla
                 * en blanco es el caso normal, no un error (ver el JSDoc del módulo).
                 */
                const height = parseNumericValue(this.$refs.height.value.trim(), t('field.height'));

                const localDatetime = this.$refs.occurredAt.value;

                if (localDatetime === '') {
                    throw new Error(t('common.missingDate'));
                }

                const { occurredAt, tz } = datetimeLocalToCanonical(localDatetime);

                const common = buildCommonEventFields({
                    /** Siempre manual: ver el JSDoc del módulo, "El origen no se pregunta...". */
                    origin: 'manual',
                    device: this.$refs.device.value,
                    recordedBy: this.$refs.recordedBy.value,
                    note: this.$refs.note.value,
                });

                const content = buildBodyWeightContent({
                    value,
                    unit: this.$refs.unit.value,
                    height,
                    heightUnit: this.$refs.heightUnit.value,
                    tz,
                    catalog: this.catalog,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.value.value = '';

                /**
                 * La estatura también se vacía. No se deja puesta «por comodidad»: el siguiente
                 * registro la guardaría como si se hubiera vuelto a medir, y una estatura repetida
                 * sin haberla medido es un dato inventado con fecha de hoy.
                 */
                this.$refs.height.value = '';

                /**
                 * La fecha vuelve a «ahora»: si se quedara con la del registro recién guardado, la
                 * siguiente pesada se apuntaría en silencio a un instante pasado, y un peso con hora
                 * equivocada ya no se distingue del bueno.
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

                const weightEvents = filterBodyWeightEvents(opened);

                this.renderList(weightEvents);
                this.renderChart(weightEvents);
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
         * destruye: dejar las líneas de la carga anterior mostraría valores descifrados de una sesión
         * que ya no está desbloqueada.
         */
        renderLocked() {
            this.$refs.list.replaceChildren(createCallout({ tone: 'info', message: t('common.locked.history') }));

            this.failedToOpenCount = 0;
            this.chartEvents = [];

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            this.paintLegend([]);
            this.$refs.chartCaption.textContent = t('common.locked.history');
        },

        /** @param {list<{id: string, occurredAt: string, content: object}>} weightEvents */
        renderList(weightEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (weightEvents.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('bodyWeight.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                list.className = 'flex flex-col';

                for (const event of weightEvents) {
                    /**
                     * La estatura que aplica a esta pesada: la del propio registro si la trae y,
                     * si no, la última conocida que no sea posterior (`bodyMassIndex.js`). Se
                     * resuelve aquí y no dentro del `<li>` porque hace falta la lista entera.
                     */
                    const ownHeight = event.content?.data?.height ?? null;
                    const height = ownHeight ?? heightKnownAt(weightEvents, event.occurredAt);

                    list.appendChild(this.renderListItem(event, { height, isOwnHeight: ownHeight !== null }));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * Item de historial con la forma de DESIGN.md § Lists, la misma que las demás pantallas. El
         * valor va en IBM Plex Mono (Do's #7).
         *
         * El `<li>` NO lleva `hover:` ni `active:`: DESIGN.md § Lists reserva esos dos estados a un
         * elemento de lista pulsable, y este no es enlace ni botón. Prometer una interacción que no
         * ocurre es peor que no prometerla.
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @param {object} applicableHeight
         * @param {{value: string, unit: string, occurredAt?: string}|null} applicableHeight.height
         *        Estatura con la que se calcula el IMC de esta fila, ya resuelta por `renderList`.
         * @param {boolean} applicableHeight.isOwnHeight Si esa estatura se midió en este registro.
         * @returns {HTMLLIElement}
         */
        renderListItem(event, { height, isOwnHeight }) {
            const { data } = event.content;

            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('scale', 'mt-0.5 size-5 shrink-0 text-accent'));

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-2';

            const measurement = document.createElement('p');
            measurement.className = 'font-mono text-body text-ink';

            /**
             * Sin `font-semibold`: de IBM Plex Mono solo se empaqueta el peso 400 (§ Typography ·
             * Code la define «regular»), así que pedir 600 haría que el navegador sintetizara una
             * falsa negrita, engordando justo los glifos numéricos que Do's #7 quiere
             * inconfundibles.
             */
            const value = document.createElement('span');
            value.textContent = data.value;
            measurement.appendChild(value);

            const unit = document.createElement('span');
            unit.className = 'ml-1 text-ink-secondary';
            unit.textContent = unitLabel(this.catalog, data.unit);
            measurement.appendChild(unit);

            /**
             * La estatura, solo cuando se midió en este registro. La arrastrada NO se repite aquí:
             * escribirla en una fila donde no se midió haría creer que ese día se tomó la talla.
             * Dónde sale sí se dice, pero junto al IMC, que es lo que la usa.
             */
            if (isOwnHeight && height !== null) {
                const heightLine = document.createElement('span');
                heightLine.className = 'ml-3 text-ink-secondary';
                heightLine.textContent = t('bodyWeight.heightInline', {
                    value: height.value,
                    unit: heightUnitLabel(this.catalog, height.unit),
                });
                measurement.appendChild(heightLine);
            }

            body.appendChild(measurement);

            /**
             * IMC, como cifra y nada más: sin categoría («sobrepeso»...) ni color de juicio. El
             * porqué, largo, está en el JSDoc de `bodyMassIndex.js`; el resumen es que en niños se
             * lee por percentiles de edad y sexo, que esta aplicación no tiene, y que un umbral
             * pintado de rojo se lee como un diagnóstico que aquí nadie ha hecho.
             *
             * Sin estatura no se pinta nada. No hay «IMC —» ni «sin calcular»: un hueco callado dice
             * menos que una línea que insinúa que falta algo obligatorio, y la estatura no lo es.
             */
            const bmi = bodyMassIndex({ weight: { value: data.value, unit: data.unit }, height });

            if (bmi !== null) {
                const bmiLine = document.createElement('p');
                bmiLine.className = 'font-mono text-code text-ink-secondary';
                bmiLine.textContent = isOwnHeight
                    ? t('bodyWeight.bmi', { value: formatNumber(bmi) })
                    : t('bodyWeight.bmiWithHeightFrom', {
                        value: formatNumber(bmi),
                        date: formatDateTime(height.occurredAt),
                    });
                body.appendChild(bmiLine);
            }

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
         * Pinta la gráfica, o no pinta nada si no hay datos (un lienzo con ejes vacíos parece un
         * fallo, no un estado vacío legítimo). Una serie por unidad, nunca kilogramos y libras en la
         * misma línea (ver JSDoc del módulo).
         *
         * El eje X es de categoría, no lineal sobre epoch: no hay adaptador de fechas de Chart.js
         * instalado, así que las etiquetas se formatean aquí con `formatChartDate`, en el idioma
         * activo, y se comparten por posición entre todas las series.
         *
         * @param {list<{id: string, occurredAt: string, content: object}>} weightEvents
         */
        renderChart(weightEvents) {
            /** Se guardan para poder repintar al conmutar el tema (ver `init()` y `chartTheme.js`). */
            this.chartEvents = weightEvents;

            /** Colores del tema activo, leídos ahora y no al cargar el módulo (`chartTheme.js`). */
            const colors = chartColors();

            const seriesByUnit = groupBodyWeightByUnit(weightEvents);
            const units = Object.keys(seriesByUnit);
            const labels = units.map((code) => unitLabel(this.catalog, code));

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            const timestamps = [...new Set(units.flatMap((code) => seriesByUnit[code].map((point) => point.x)))]
                .sort((a, b) => a - b);

            if (timestamps.length === 0) {
                this.paintLegend([]);
            } else {
                /**
                 * Descriptores de serie: son a la vez lo que consume Chart.js y lo que rotula la
                 * leyenda en HTML (ver `chartLegend.js`), así que ninguna de las dos puede quedarse
                 * con un color o una forma distintos de los de la otra.
                 */
                const series = units.map((code, index) => ({
                    label: labels[index],
                    color: colors.series[index % colors.series.length],
                    ...CHART_SERIES_SHAPES[index % CHART_SERIES_SHAPES.length],
                }));

                const datasets = series.map((entry, index) => {
                    const byTimestamp = new Map(seriesByUnit[units[index]].map((point) => [point.x, point.y]));

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
                    data: { labels: timestamps.map((timestamp) => formatChartDate(timestamp)), datasets },
                    options: {
                        maintainAspectRatio: false,
                        color: colors.tick,
                        scales: {
                            x: {
                                type: 'category',
                                /**
                                 * La rejilla puede ser tenue, pero la LÍNEA DE EJE no: es la
                                 * referencia contra la que se lee un peso, y en el tono de la
                                 * rejilla era casi invisible (Don'ts #10). Va en el mismo tono de
                                 * los rótulos.
                                 */
                                grid: { color: colors.grid },
                                border: { color: colors.tick },
                                ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                            },
                            y: {
                                grid: { color: colors.grid },
                                border: { color: colors.tick },
                                ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                                title: {
                                    display: true,
                                    /**
                                     * Con las dos unidades a la vez el rótulo las nombra a las dos:
                                     * escribir solo una diría que toda la gráfica está en ella, que
                                     * es justo lo que no ocurre.
                                     */
                                    text: joinList(labels),
                                    color: colors.tick,
                                    /**
                                     * Peso 400: de IBM Plex Mono solo se empaqueta ese, y pedir 600
                                     * obligaría al navegador a sintetizar una falsa negrita sobre la
                                     * unidad.
                                     */
                                    font: { family: CHART_FONTS.mono, size: 13, weight: 400 },
                                },
                            },
                        },
                        plugins: {
                            /** La leyenda vive fuera del lienzo, en HTML (ver `chartLegend.js`). */
                            legend: { display: false },
                            /**
                             * El par fondo/tinta sale del tema: el tooltip es el único componente
                             * que se invierte respecto de la interfaz (§ Charts — Dark).
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

            this.$refs.chartCaption.textContent = chartCaptionText(labels);
        },

        /**
         * Pinta la leyenda en HTML, fuera del lienzo (ver el JSDoc de `chartLegend.js` para el
         * porqué). Con la lista vacía deja el nodo vacío: una leyenda huérfana describiría líneas
         * que no están.
         *
         * @param {list<{label: string, color: string, borderDash: list<number>, pointStyle: string}>} series
         */
        paintLegend(series) {
            renderLegend(
                legendElementFor(this.$refs.chart, 'body-weight-chart-legend'),
                legendItems(series),
            );
        },
    };
}
