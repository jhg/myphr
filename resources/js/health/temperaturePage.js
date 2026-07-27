/**
 * Componente Alpine de la pantalla de temperatura corporal (ADR 0002, ADR 0004, ADR 0005, ADR 0006,
 * ADR 0008).
 *
 * El contrato del DOM lo fija `resources/views/phr/pages/temperature.blade.php`: nada de
 * `wire:model` (ADR 0002), los campos se leen por `x-ref` y el sobre cifrado sube como argumento de
 * `storeEvent`, nunca como propiedad de Livewire.
 *
 * **El sitio de medida es el método** (ADR 0008): la axilar y la rectal de la misma persona en el
 * mismo momento no dan el mismo número, así que el sitio se pregunta, viaja como campo propio
 * (`data.site`) y **nunca se mezcla en silencio** con otro: cada sitio es una serie aparte y el pie
 * de la gráfica dice cuáles incluye.
 *
 * **Aquí el sitio además decide el código LOINC**, al contrario que el brazo y la postura de la
 * tensión: LOINC publica un código por sitio de medida, así que esta pantalla resuelve el código
 * contra la tabla `catalog.loinc` que emite el servidor, al estilo de la glucemia (ver
 * `App\Catalog\TemperatureLoincCode`).
 *
 * **No se convierte entre Celsius y Fahrenheit.** Cada registro conserva la unidad con la que se
 * anotó (ADR 0006) y la serie se agrupa por la pareja (sitio, unidad): una sola línea con 36,8 y
 * 98,2 seguidos no sería una tendencia, sería un salto de escala disfrazado de fiebre. Convertir
 * exigiría además fijar precisión y redondeo, que esta versión no aborda.
 *
 * **El servidor no puede filtrar por tipo** (ADR 0006): `fetchEvents` trae todos los eventos del
 * usuario y aquí se descifra cada uno y se descarta el que no sea `type === 'temperature'`. Un sobre
 * que no abre no tumba la pantalla: se cuenta y se avisa (ADR 0004).
 *
 * **Los cuatro campos comunes a todo evento** (origen, aparato, quién registra, nota; ADR 0006) no
 * se construyen aquí: viven en `eventCommonFields.js` y `buildTemperatureContent` los recibe ya
 * construidos, para desplegarlos en el nivel superior del contenido, nunca dentro de `data`.
 *
 * **El origen no se pregunta en el formulario.** `origin` distingue cómo entró el dato —tecleado
 * frente a importado de un aparato—, y aquí la inserción es siempre manual: se lee el número en el
 * termómetro y se teclea. `submit()` lo fija a `'manual'` sin leer ningún campo del DOM; el aparato
 * (`device`) sí es útil (con qué se midió) y conserva su campo.
 *
 * **La fecha del evento no se convierte aquí.** `datetimeLocalToCanonical` vive en
 * `datetimeLocal.js` porque lo que devuelve entra como dato asociado del AEAD (ADR 0004): si cada
 * pantalla llevara su copia y una se desviara, sus sobres dejarían de abrirse.
 *
 * Las funciones exportadas antes de `temperaturePage()` son la lógica pura del componente, para
 * poder probarlas sin montar Alpine ni Chart.js (`tests/js/temperaturePage.test.mjs`).
 */

import Chart from 'chart.js/auto';

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
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
import { unitLabel } from './unitLabel.js';

/**
 * Resuelve el código LOINC de un sitio de medida contra la tabla del catálogo del servidor (ADR
 * 0005, ADR 0008). Nunca inventa uno ni cae al código genérico de «temperatura corporal»: si el
 * sitio no está en la tabla, falla de forma visible, porque un código LOINC equivocado es un dato
 * clínico equivocado y, una vez cifrado, ya no se corrige.
 *
 * @param {list<{site: string, code: string}>} loincTable
 * @param {string} site
 * @returns {string}
 * @throws {Error} Si no existe código para ese sitio.
 */
export function resolveLoincCode(loincTable, site) {
    const entry = loincTable.find((row) => row.site === site);

    if (entry === undefined) {
        throw new Error(t('temperature.noLoincCode', { site }));
    }

    return entry.code;
}

/**
 * Etiqueta legible de un sitio de medida a partir del catálogo del servidor.
 *
 * @param {{sites: list<{token: string, label: string}>}} catalog
 * @param {string} site
 * @returns {string}
 */
export function siteLabel(catalog, site) {
    return catalog.sites.find((row) => row.token === site)?.label ?? site;
}

/**
 * Separador de {@see seriesKey}. Se corta por el primero, igual que en la tensión: ningún token de
 * sitio lleva una barra vertical, pero los códigos UCUM sí llevan corchetes y barras (`[degF]`), así
 * que el separador tiene que ser un carácter que no aparezca en el primer trozo.
 */
const SERIES_KEY_SEPARATOR = '|';

/**
 * Token estable que agrupa una lectura por sitio de medida **y** unidad. No se guarda en el sobre
 * bajo esta forma —`data.site` y `data.unit` viajan como campos propios— pero es la clave con la que
 * la gráfica agrupa: el sitio porque lo exige el ADR 0008, y la unidad porque Celsius y Fahrenheit
 * no comparten escala y no se convierten (ver JSDoc del módulo).
 *
 * @param {string} site Token de `App\Catalog\TemperatureMeasurementSite`.
 * @param {string} unit Código UCUM.
 * @returns {string}
 */
export function seriesKey(site, unit) {
    return `${site}${SERIES_KEY_SEPARATOR}${unit}`;
}

/**
 * Deshace {@see seriesKey}. Corta por el **primer** separador, no por todos.
 *
 * @param {string} key
 * @returns {[string, string]} `[site, unit]`.
 */
export function splitSeriesKey(key) {
    const separatorIndex = key.indexOf(SERIES_KEY_SEPARATOR);

    if (separatorIndex === -1) {
        return [key, ''];
    }

    return [key.slice(0, separatorIndex), key.slice(separatorIndex + 1)];
}

/**
 * Rótulo de una serie: sitio de medida y unidad, en ese orden. Los dos, y no solo el sitio, porque
 * dos series del mismo sitio en unidades distintas serían indistinguibles.
 *
 * @param {{sites: list<{token: string, label: string}>, units: list<{code: string, label: string}>}} catalog
 * @param {string} key Clave de {@see seriesKey}.
 * @returns {string}
 */
export function seriesLabel(catalog, key) {
    const [site, unit] = splitSeriesKey(key);

    return t('temperature.series', {
        site: siteLabel(catalog, site),
        unit: unitLabel(catalog, unit),
    });
}

/**
 * Construye el contenido en claro de un evento de temperatura, con la forma del ADR 0006 más el
 * método del ADR 0008. El valor viaja como cadena, nunca como número (ADR 0004: decimales como
 * cadena).
 *
 * `common` son los cuatro campos que comparte cualquier tipo de evento (ver `eventCommonFields.js`) y
 * van en el nivel superior del contenido, no dentro de `data`.
 *
 * @param {object} params
 * @param {string} params.value Tal cual lo escribió la persona, ya como cadena.
 * @param {string} params.unit Código UCUM.
 * @param {string} params.site Token de `App\Catalog\TemperatureMeasurementSite`.
 * @param {string} params.tz Desfase `±HH:MM` del momento del registro.
 * @param {{loinc: list<{site: string, code: string}>}} params.catalog
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Ya construido por `buildCommonEventFields`.
 * @returns {{v: 1, type: 'temperature', tz: string, origin: string, recordedBy: string,
 *           device?: string, note?: string,
 *           data: {value: string, unit: string, loinc: string, site: string}}}
 * @throws {Error} Si falta el valor, la unidad o el sitio, o si el sitio no tiene código LOINC.
 */
export function buildTemperatureContent({ value, unit, site, tz, catalog, common }) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(t('temperature.missingValue'));
    }

    if (typeof unit !== 'string' || unit.trim() === '') {
        throw new Error(t('temperature.missingUnit'));
    }

    if (typeof site !== 'string' || site.trim() === '') {
        throw new Error(t('temperature.missingSite'));
    }

    return {
        v: 1,
        type: 'temperature',
        tz,
        ...common,
        data: {
            value,
            unit,
            loinc: resolveLoincCode(catalog.loinc, site),
            site,
        },
    };
}

/**
 * Descarta los eventos descifrados que no son de tipo `temperature`. El servidor no puede hacer este
 * filtro porque el tipo va cifrado dentro del sobre (ADR 0006): es responsabilidad del cliente.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Ya descifrados.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterTemperatureEvents(events) {
    return events.filter((event) => event.content?.type === 'temperature');
}

/**
 * Agrupa las lecturas por la pareja (sitio, unidad) para la gráfica. Nunca por sitio a secas —dos
 * escalas en una línea no son una tendencia— ni por unidad a secas, que mezclaría sitios en silencio
 * y es justo lo que prohíbe el ADR 0008.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} temperatureEvents Ya filtrados
 *        por `filterTemperatureEvents`.
 * @returns {Record<string, list<{x: number, y: number}>>} Indexado por {@see seriesKey}.
 */
export function groupTemperatureBySiteAndUnit(temperatureEvents) {
    /** @type {Record<string, list<{x: number, y: number}>>} */
    const seriesByKey = {};

    for (const event of temperatureEvents) {
        const { data } = event.content;
        const key = seriesKey(data.site, data.unit);

        if (seriesByKey[key] === undefined) {
            seriesByKey[key] = [];
        }

        seriesByKey[key].push({ x: Date.parse(event.occurredAt), y: Number(data.value) });
    }

    for (const points of Object.values(seriesByKey)) {
        points.sort((a, b) => a.x - b.x);
    }

    return seriesByKey;
}

/**
 * Texto del pie de la gráfica: qué series incluye, sitio y unidad, porque no son comparables entre
 * sí (ADR 0008).
 *
 * @param {list<string>} labels Rótulos de las series con datos.
 * @returns {string}
 */
export function chartCaptionText(labels) {
    return labels.length > 0
        ? t('temperature.caption.includes', { series: joinList(labels) })
        : t('temperature.caption.empty');
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
 * Quien no distingue los colores sigue pudiendo decir qué línea es qué sitio de medida. Los colores
 * salen de `chartColors()`, que los lee del tema en cada dibujado (ver `chartTheme.js`).
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
 * la llama de `Temperature::$navigationIcon`, para que el icono guía de cada registro sea el mismo
 * que el de la sección. Del icono se toma solo el contorno exterior: `createIcon` dibuja un único
 * `<path>` y a 20px la llama interior no se distingue, así que añadir un segundo trazo complicaría
 * el ayudante sin cambiar nada de lo que se ve.
 */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    fire: 'M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 '
        + '9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z',
});

/**
 * Icono decorativo de 20px (DESIGN.md § Lists: «20px icon»). Va con `aria-hidden`: nunca lleva
 * información que no esté también en el texto (Do's #3).
 *
 * @param {'warning'|'info'|'fire'} name
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
 * Chip de estado (DESIGN.md § Chips · Status Chip, variante info): 12px bold en mayúsculas, 4px de
 * radio. Es el chip del **sitio de medida**, que es el método de esta magnitud (ADR 0008), así que
 * lleva el mismo tratamiento visual que el método de la glucemia o el brazo y la postura de la
 * tensión.
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
 * Factoría del componente Alpine. Se registra como `phrTemperaturePage`.
 *
 * @returns {object}
 */
export function temperaturePage() {
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
            this.catalog = JSON.parse(document.querySelector('[data-phr-temperature-catalog]').textContent);

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
             * Las opciones de `unit` y `site` las renderiza el servidor en Blade (ADR 0002, ADR
             * 0005): no se rellenan aquí. Ver el comentario al inicio de `temperature.blade.php`.
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
         * significa una lectura duplicada en el historial.
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
                // `buildTemperatureContent`. El resultado sigue siendo cadena: no se convierte a
                // número (ADR 0004).
                const value = parseNumericValue(this.$refs.value.value.trim(), t('field.temperature'));

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

                const content = buildTemperatureContent({
                    value,
                    unit: this.$refs.unit.value,
                    site: this.$refs.site.value,
                    tz,
                    catalog: this.catalog,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.value.value = '';

                /**
                 * La fecha vuelve a «ahora»: si se quedara con la del registro recién guardado, la
                 * siguiente lectura se apuntaría en silencio a un instante pasado, y una fiebre con
                 * hora equivocada ya no se distingue de la buena.
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

                const temperatureEvents = filterTemperatureEvents(opened);

                this.renderList(temperatureEvents);
                this.renderChart(temperatureEvents);
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

        /** @param {list<{id: string, occurredAt: string, content: object}>} temperatureEvents */
        renderList(temperatureEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (temperatureEvents.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('temperature.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                list.className = 'flex flex-col';

                for (const event of temperatureEvents) {
                    list.appendChild(this.renderListItem(event));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * Item de historial con la forma de DESIGN.md § Lists, la misma que las demás pantallas. El
         * valor va en IBM Plex Mono (Do's #7) y el sitio de medida es un chip de estado, para no
         * perderse en texto concatenado.
         *
         * El `<li>` NO lleva `hover:` ni `active:`: DESIGN.md § Lists reserva esos dos estados a un
         * elemento de lista pulsable, y este no es enlace ni botón.
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @returns {HTMLLIElement}
         */
        renderListItem(event) {
            const { data } = event.content;

            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('fire', 'mt-0.5 size-5 shrink-0 text-accent'));

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

            body.appendChild(measurement);

            const chips = document.createElement('div');
            chips.className = 'flex flex-wrap items-center gap-2';
            chips.appendChild(createStatusChip(siteLabel(this.catalog, data.site)));
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
         * Pinta la gráfica, o no pinta nada si no hay datos (un lienzo con ejes vacíos parece un
         * fallo, no un estado vacío legítimo). Una serie por pareja (sitio, unidad), nunca dos sitios
         * ni dos escalas en la misma línea (ver JSDoc del módulo).
         *
         * El eje X es de categoría, no lineal sobre epoch: no hay adaptador de fechas de Chart.js
         * instalado, así que las etiquetas se formatean aquí con `formatChartDate`, en el idioma
         * activo, y se comparten por posición entre todas las series.
         *
         * @param {list<{id: string, occurredAt: string, content: object}>} temperatureEvents
         */
        renderChart(temperatureEvents) {
            /** Se guardan para poder repintar al conmutar el tema (ver `init()` y `chartTheme.js`). */
            this.chartEvents = temperatureEvents;

            /** Colores del tema activo, leídos ahora y no al cargar el módulo (`chartTheme.js`). */
            const colors = chartColors();

            const seriesByKey = groupTemperatureBySiteAndUnit(temperatureEvents);
            const keys = Object.keys(seriesByKey);
            const labels = keys.map((key) => seriesLabel(this.catalog, key));

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            const timestamps = [...new Set(keys.flatMap((key) => seriesByKey[key].map((point) => point.x)))]
                .sort((a, b) => a - b);

            if (timestamps.length === 0) {
                this.paintLegend([]);
            } else {
                /**
                 * Descriptores de serie: son a la vez lo que consume Chart.js y lo que rotula la
                 * leyenda en HTML (ver `chartLegend.js`), así que ninguna de las dos puede quedarse
                 * con un color o una forma distintos de los de la otra.
                 */
                const series = keys.map((key, index) => ({
                    label: labels[index],
                    color: colors.series[index % colors.series.length],
                    ...CHART_SERIES_SHAPES[index % CHART_SERIES_SHAPES.length],
                }));

                const datasets = series.map((entry, index) => {
                    const byTimestamp = new Map(seriesByKey[keys[index]].map((point) => [point.x, point.y]));

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

                /**
                 * Unidades presentes, sin repetir: el rótulo del eje las nombra a todas, porque con
                 * dos escalas a la vez escribir solo una diría que la gráfica entera está en ella.
                 */
                const unitLabels = [...new Set(keys.map((key) => unitLabel(this.catalog, splitSeriesKey(key)[1])))];

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
                                 * referencia contra la que se lee una temperatura, y en el tono de
                                 * la rejilla era casi invisible (Don'ts #10). Va en el mismo tono de
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
                                    text: joinList(unitLabels),
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
                legendElementFor(this.$refs.chart, 'temperature-chart-legend'),
                legendItems(series),
            );
        },
    };
}
