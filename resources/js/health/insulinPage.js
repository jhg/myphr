/**
 * Componente Alpine de la pantalla de insulina inyectada (ADR 0002, ADR 0004, ADR 0005, ADR 0006).
 *
 * El contrato del DOM lo fija `resources/views/phr/pages/insulin.blade.php`: nada de `wire:model`
 * (ADR 0002), los campos se leen por `x-ref` y el sobre cifrado sube como argumento de
 * `storeEvent` (la acción de `HealthEventPage`, la misma que usa cualquier pantalla de evento),
 * nunca como propiedad de Livewire.
 *
 * **El servidor no puede filtrar por tipo** (ADR 0006, ver JSDoc de `HealthEventPage::fetchEvents()`):
 * `fetchEvents` trae todos los eventos del usuario y aquí se descifra cada uno y se descarta el que
 * no sea `type === 'insulin'`. Un sobre que no abre no tumba la pantalla: se cuenta y se avisa,
 * porque un fallo de descifrado silencioso es justo lo que el ADR 0004 prohíbe.
 *
 * **Riesgo real de esta pantalla**: una dosis mal leída es una dosis mal puesta. La dosis se
 * muestra siempre en monoespaciada, en el texto principal (nunca en gris claro) y con el mayor
 * tamaño de tipo disponible en la lista, siguiendo DESIGN.md al pie de la letra.
 *
 * **No lleva código LOINC** (ADR 0006): un evento de insulina es una administración de medicación,
 * no una observación de una magnitud, así que no hay tabla (tipo, unidad) → código que resolver
 * aquí, a diferencia de `glucosePage.js`.
 *
 * **La dosis viaja como cadena, nunca como número** (ADR 0004: «decimales como cadena»): media
 * unidad es una dosis real en pacientes pediátricos y `parseFloat` u operaciones aritméticas la
 * redondearían o la representarían con errores de coma flotante.
 *
 * **Los cuatro campos comunes a todo evento** (origen manual/aparato, aparato, quién registra, nota
 * libre; ADR 0006) no se construyen aquí: viven en `eventCommonFields.js`, en una función pura
 * (`buildCommonEventFields`) reutilizable por cualquier pantalla de evento, y `buildInsulinContent`
 * los recibe ya construidos para desplegarlos en el nivel superior del contenido, junto a `v`,
 * `type` y `tz`, nunca dentro de `data`.
 *
 * **El formulario no pregunta el origen del dato.** `origin` distingue cómo entró el dato en la
 * aplicación: tecleado por una persona (`manual`) frente a importado automáticamente desde un
 * aparato (`device`). Hoy no existe ninguna integración con un aparato en esta pantalla, así que
 * la entrada es siempre manual y preguntarlo no tiene una respuesta real; el campo sigue viajando
 * en el contenido cifrado porque el ADR 0006 lo exige y no se recupera después sobre datos ya
 * cifrados, pero aquí se fija a `manual` sin mostrar ningún `<select>` — es el valor por defecto de
 * `buildCommonEventFields` cuando no se le pasa `origin`. El día que exista una importación
 * automática desde un aparato (p. ej. un bolígrafo o una bomba conectados), será ella quien pase
 * `device` explícitamente. El campo de aparato (`device`), en cambio, sí se pregunta: es útil
 * incluso con entrada manual, para anotar con qué bolígrafo o bomba se puso la dosis.
 *
 * Las funciones exportadas antes de `insulinPage()` son la lógica pura del componente, para poder
 * probarlas sin montar Alpine ni Chart.js (`tests/js/insulinPage.test.mjs`).
 */

import Chart from 'chart.js/auto';

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { canonicalDate } from '../crypto/canonicalDate.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { formatChartDay, formatDateTime, t } from '../i18n/index.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, observeThemeChange } from './chartTheme.js';
import { buildCommonEventFields } from './eventCommonFields.js';
import { openEvent, sealEvent } from './eventEnvelope.js';
import { parseNumericValue } from './numericValue.js';

/** Código UCUM de la unidad internacional de insulina (ADR 0005): `Insulin::UNIT_INTERNATIONAL_UNIT`. */
export const INSULIN_UNIT = '[iU]';

/**
 * Patrón de un `<input type="datetime-local" step="1">`: sin desfase, porque es hora local del
 * dispositivo (`YYYY-MM-DDTHH:MM` o `YYYY-MM-DDTHH:MM:SS`).
 */
const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Descompone el valor de un `datetime-local` en sus campos de calendario, sin interpretarlo
 * todavía en ninguna zona horaria.
 *
 * @param {string} value
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number}}
 * @throws {Error} Si el valor no tiene la forma esperada.
 */
export function parseDatetimeLocalFields(value) {
    const match = DATETIME_LOCAL_PATTERN.exec(value);

    if (match === null) {
        throw new Error(t('common.badDatetime', { value }));
    }

    const [, year, month, day, hour, minute, second = '00'] = match;

    return {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
    };
}

/**
 * Da forma `±HH:MM` a un desfase, con el mismo convenio de signo que el campo `tz` del ADR 0006
 * (positivo cuando la hora local va por delante de UTC).
 *
 * @param {number} offsetMinutes Local menos UTC, en minutos.
 * @returns {string}
 */
export function formatTzOffset(offsetMinutes) {
    const sign = offsetMinutes < 0 ? '-' : '+';
    const absolute = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
    const minutes = String(absolute % 60).padStart(2, '0');

    return `${sign}${hours}:${minutes}`;
}

/**
 * Convierte un `datetime-local` (hora local sin desfase) al instante correcto y a su forma
 * canónica (ADR 0004), junto con el desfase para el campo `tz` del ADR 0006.
 *
 * @param {string} value Valor crudo del `<input type="datetime-local">`.
 * @param {object} [options]
 * @param {number} [options.timezoneOffsetMinutes] Desfase a usar en vez del de `Date` (convenio de
 *        `getTimezoneOffset`: UTC menos local), solo para poder probar esta función sin depender de
 *        la zona horaria de quien ejecuta los tests.
 * @returns {{occurredAt: string, tz: string}}
 */
export function datetimeLocalToCanonical(value, { timezoneOffsetMinutes } = {}) {
    const fields = parseDatetimeLocalFields(value);

    const offsetMinutes = timezoneOffsetMinutes
        ?? new Date(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second)
            .getTimezoneOffset();

    const utcMilliseconds = Date.UTC(
        fields.year,
        fields.month - 1,
        fields.day,
        fields.hour,
        fields.minute,
        fields.second
    ) + offsetMinutes * 60_000;

    return {
        occurredAt: canonicalDate(new Date(utcMilliseconds)),
        tz: formatTzOffset(-offsetMinutes),
    };
}

/**
 * Construye el contenido en claro de un evento de insulina, con la forma del ADR 0006. La dosis
 * viaja como cadena, nunca como número (ADR 0004: decimales como cadena), y el evento no lleva
 * código LOINC porque es una administración de medicación, no una observación.
 *
 * `common` son los cuatro campos que comparte cualquier tipo de evento (origen, aparato, quién
 * registra, nota: ver `eventCommonFields.js`) y van en el nivel superior del contenido, no dentro de
 * `data`. `product` (nombre comercial, texto libre) y `site` (zona de inyección) son propios de la
 * insulina y opcionales: si no se indican (cadena vacía o ausentes), no entran en `data` en
 * absoluto, en vez de guardarse como cadena vacía (mismo criterio que `mealContext` en
 * `glucosePage.js`).
 *
 * @param {object} params
 * @param {string} params.dose Tal cual la escribió la persona, ya como cadena (p. ej. "0.5").
 * @param {string} params.insulinType Token de `App\Catalog\InsulinType`.
 * @param {string} [params.product] Nombre comercial en texto libre, o vacío/ausente.
 * @param {string} [params.site] Token de `App\Catalog\InjectionSite`, o vacío/ausente.
 * @param {string} params.tz Desfase `±HH:MM` del momento del registro.
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Ya construido por `buildCommonEventFields`.
 * @returns {{v: 1, type: 'insulin', tz: string, origin: string, recordedBy: string, device?: string,
 *           note?: string, data: {insulinType: string, dose: string, unit: string, product?: string,
 *           site?: string}}}
 * @throws {Error} Si falta la dosis o el tipo de insulina.
 */
export function buildInsulinContent({ dose, insulinType, product, site, tz, common }) {
    if (typeof dose !== 'string' || dose.trim() === '') {
        throw new Error(t('insulin.missingDose'));
    }

    if (typeof insulinType !== 'string' || insulinType.trim() === '') {
        throw new Error(t('insulin.missingInsulinType'));
    }

    const data = { insulinType, dose, unit: INSULIN_UNIT };

    if (typeof product === 'string' && product.trim() !== '') {
        data.product = product.trim();
    }

    if (typeof site === 'string' && site.trim() !== '') {
        data.site = site;
    }

    return {
        v: 1,
        type: 'insulin',
        tz,
        ...common,
        data,
    };
}

/**
 * Resuelve la etiqueta de la zona de inyección de un evento ya descifrado, tolerando que el campo
 * no exista (opcional, se omite del contenido cuando no se indicó).
 *
 * @param {{injectionSites: list<{token: string, label: string}>}} catalog
 * @param {{site?: string}} data
 * @returns {string|null} `null` cuando el evento no trae zona.
 */
export function injectionSiteLabel(catalog, data) {
    if (typeof data.site !== 'string' || data.site === '') {
        return null;
    }

    return catalog.injectionSites.find((row) => row.token === data.site)?.label ?? data.site;
}

/**
 * Resuelve la etiqueta del producto de un evento ya descifrado, tolerando que el campo no exista
 * (texto libre opcional, ADR 0006).
 *
 * @param {{product?: string}} data
 * @returns {string|null} `null` cuando el evento no trae producto.
 */
export function productLabel(data) {
    if (typeof data.product !== 'string' || data.product === '') {
        return null;
    }

    return data.product;
}

/**
 * Descarta los eventos descifrados que no son de tipo `insulin`. El servidor no puede hacer este
 * filtro porque el tipo va cifrado dentro del sobre (ADR 0006): es responsabilidad del cliente.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Ya descifrados.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterInsulinEvents(events) {
    return events.filter((event) => event.content?.type === 'insulin');
}

/**
 * Agrupa eventos de insulina por día de calendario local y tipo, sumando la dosis del día (dosis
 * decimales sumadas con precisión de cadena, ver `sumDoses`), para la gráfica de barras.
 *
 * Una dosis no es una magnitud continua como la glucemia: no hay un valor "entre" dos inyecciones,
 * así que aquí no cabe una gráfica de líneas (sugeriría continuidad donde no la hay). Se agrupa por
 * día y tipo de insulina en vez de trazar cada inyección, porque lo clínicamente relevante es la
 * dosis total diaria de cada tipo, no la lectura aislada de una inyección concreta.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} insulinEvents Ya filtrados por
 *        `filterInsulinEvents`.
 * @returns {{days: list<string>, totalsByType: Record<string, list<number>>}} `days` son claves
 *          `YYYY-MM-DD` en orden ascendente; `totalsByType[insulinType][i]` es la dosis total de ese
 *          tipo en `days[i]` (0 si ese día no tuvo dosis de ese tipo).
 */
export function groupInsulinByDay(insulinEvents) {
    /** @type {Map<string, Map<string, number>>} */
    const byDay = new Map();

    for (const event of insulinEvents) {
        const { data } = event.content;
        const day = dayKey(event.occurredAt, event.content.tz);

        if (!byDay.has(day)) {
            byDay.set(day, new Map());
        }

        const byType = byDay.get(day);
        const previous = byType.get(data.insulinType) ?? 0;
        byType.set(data.insulinType, sumDoses(previous, data.dose));
    }

    const days = [...byDay.keys()].sort();
    const types = [...new Set(days.flatMap((day) => [...byDay.get(day).keys()]))].sort();

    /** @type {Record<string, list<number>>} */
    const totalsByType = {};

    for (const type of types) {
        totalsByType[type] = days.map((day) => byDay.get(day).get(type) ?? 0);
    }

    return { days, totalsByType };
}

/**
 * Texto del pie de la gráfica: qué tipos de insulina entran, cuántos días cubre y cuánta dosis
 * acumula cada tipo.
 *
 * No es decoración. La gráfica es un objeto gráfico sin texto, así que el color no puede ser el
 * único portador de la información (DESIGN.md § Do's #3): quien no distinga los tonos —o use un
 * lector de pantalla, o vea la pantalla en blanco y negro— lee
 * aquí lo mismo que dicen las barras. Y cuando todavía no hay ningún registro —el caso de cualquier
 * usuario nuevo— dice qué va a aparecer aquí, en vez de dejar una tarjeta con un lienzo en blanco
 * que parece un fallo.
 *
 * @param {list<string>} days Claves `YYYY-MM-DD`, tal como las devuelve `groupInsulinByDay`.
 * @param {Record<string, list<number>>} totalsByType Dosis por tipo y día.
 * @param {(type: string) => string} labelFor Etiqueta de un token de tipo de insulina, en el idioma
 *        activo (sale del catálogo del servidor).
 * @returns {string}
 */
export function summarizeDailyDoses(days, totalsByType, labelFor) {
    if (days.length === 0) {
        return t('insulin.chartEmpty');
    }

    const totals = Object.entries(totalsByType)
        .map(([type, doses]) => {
            const total = doses.reduce((accumulated, dose) => Math.round((accumulated + dose) * 1000) / 1000, 0);

            return `${labelFor(type)}: ${total} ${INSULIN_UNIT}`;
        })
        .join('; ');

    return t('insulin.caption', { count: days.length, totals });
}

/**
 * Suma dos dosis, tolerando que la representación decimal de JavaScript no sea exacta: redondea a
 * tres decimales, más que suficiente para dosis de insulina (media unidad es el caso más fino en la
 * práctica clínica) y evita que la suma acumule ruido de coma flotante visible en la gráfica.
 *
 * @param {number} accumulated
 * @param {string} dose
 * @returns {number}
 */
function sumDoses(accumulated, dose) {
    return Math.round((accumulated + Number(dose)) * 1000) / 1000;
}

/**
 * Día al que pertenece un evento, en la zona horaria en la que se registró.
 *
 * No se usa el calendario local de la máquina: una inyección de las 22:00 UTC cae en un día distinto
 * según dónde se abra la aplicación, y entonces la dosis diaria queda atribuida al día equivocado.
 * Tampoco vale UTC a secas, porque el día que le importa a la persona es el suyo. El desfase con el
 * que se registró viaja dentro del propio sobre, en `tz` (ADR 0006), así que es el que manda.
 *
 * Sin `tz` se cae a UTC de forma explícita, que es el único valor que no depende del dispositivo.
 *
 * @param {string} occurredAt Instante en forma canónica.
 * @param {string} [tz] Desfase con el que se registró, del tipo `+02:00`.
 * @returns {string} `YYYY-MM-DD`.
 */
function dayKey(occurredAt, tz) {
    const pad = (value) => String(value).padStart(2, '0');
    const shifted = new Date(new Date(occurredAt).getTime() + offsetMinutes(tz) * 60_000);

    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * @param {string} [tz] Desfase del tipo `+02:00`, `-05:30` o `Z`.
 * @returns {number} Minutos de desfase. Cero si no viene o no se entiende, nunca la zona local.
 */
function offsetMinutes(tz) {
    const match = /^([+-])(\d{2}):(\d{2})$/.exec(tz ?? '');

    if (match === null) {
        return 0;
    }

    const magnitude = Number(match[2]) * 60 + Number(match[3]);

    return match[1] === '-' ? -magnitude : magnitude;
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
 * Orden en que los tipos de insulina toman las series de `chartColors()` (§ Components · Charts,
 * «Series, in order»). El orden es fijo y no depende de qué tipos traiga el historial: así el mismo
 * tipo conserva su color aunque un día no haya registros de otro.
 */
const CHART_SERIES_BY_TYPE = Object.freeze({ rapid: 0, long: 1, mixed: 2 });

/**
 * Marca de cada entrada de la leyenda, en el orden en que aparecen los tipos de insulina. Es la
 * segunda codificación que Do's #3 exige cuando el color no basta: en una pantalla en blanco y
 * negro, o impresas, las series se distinguen por la forma.
 */
const CHART_LEGEND_SHAPES = Object.freeze(['rect', 'circle', 'triangle']);

const CHART_FONTS = Object.freeze({
    body: "'Open Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
});

/** Trazados de Heroicons v2 (outline, 24×24): el gotero de `Insulin::$navigationIcon`. */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    drop: 'M12 3.75a.75.75 0 0 1 .671.415l4.5 9a.75.75 0 0 1 .079.335 5.25 5.25 0 1 1-10.5 0 .75.75 0 0 1 '
        + '.08-.335l4.5-9A.75.75 0 0 1 12 3.75Z',
});

/**
 * Icono decorativo de 20px (DESIGN.md § Lists). Va con `aria-hidden`: nunca lleva información que
 * no esté también en el texto (Do's #3).
 *
 * @param {'warning'|'info'|'drop'} name
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
 * Aviso en bloque con icono (DESIGN.md § Chips): color + icono + texto, nunca color a secas.
 *
 * @param {object} params
 * @param {'error'|'info'} params.tone
 * @param {string} params.message
 * @returns {HTMLDivElement}
 */
function createCallout({ tone, message }) {
    const callout = document.createElement('div');

    /**
     * Los dos tonos salen de los tokens de aviso (`error-*` / `info-*`, ver `theme.css`), no de la
     * rampa `danger-*`/`primary-*`: los tokens ya llevan dentro el par de § Chips corregido a AA y
     * su equivalente de § Dark Mode, mientras que un `bg-danger-50` fijo queda como un rectángulo
     * casi blanco en tema oscuro. Mismos tokens que `glucosePage.js`.
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
 * Chip de estado (DESIGN.md § Chips · Status Chip), para el tipo de insulina: es lo más importante
 * a distinguir de un vistazo, igual que el método de medición en `glucosePage.js`.
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
 * Chip de filtro (DESIGN.md § Chips · Filter Chip), para la zona de inyección: no es un estado
 * clínico sino una circunstancia de la dosis.
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
 * Factoría del componente Alpine. Se registra como `phrInsulinPage`.
 *
 * @returns {object}
 */
export function insulinPage() {
    return {
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
            this.catalog = JSON.parse(document.querySelector('[data-phr-insulin-catalog]').textContent);

            /**
             * DESIGN.md § Charts — Dark: la gráfica tiene que releer los colores y repintarse cuando
             * `<html>` entra o sale del modo oscuro, o el panel entero conmuta menos las gráficas.
             */
            observeThemeChange(() => {
                if (this.chart !== null) {
                    this.renderChart(this.chartEvents);
                }
            });

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
         * alguna la persona vuelve a pulsar el botón —y en esta pantalla pulsar dos veces guarda
         * dos dosis—. La plantilla lo usa para deshabilitar el botón, marcar `aria-busy` y cambiar
         * el texto (Do's #3), igual que la pantalla de glucemia.
         *
         * @param {SubmitEvent} [event]
         */
        async submit() {
            this.error = '';
            this.loading = true;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    throw new Error(t('common.noSession'));
                }

                const rawDose = this.$refs.dose.value.trim();

                if (rawDose === '') {
                    throw new Error(t('insulin.missingDose'));
                }

                /**
                 * La dosis pasa por la misma validación que el resto de valores clínicos: como mucho
                 * dos decimales y separador normalizado a punto antes de cifrar. Es el campo donde un
                 * error de lectura hace más daño de toda la aplicación, porque una dosis mal escrita
                 * es una dosis mal puesta, y una vez sellado el sobre ya no se puede corregir.
                 */
                const dose = parseNumericValue(rawDose, t('field.dose'));

                const insulinType = this.$refs.insulinType.value;

                if (insulinType === '') {
                    throw new Error(t('insulin.missingInsulinType'));
                }

                const localDatetime = this.$refs.occurredAt.value;

                if (localDatetime === '') {
                    throw new Error(t('common.missingDate'));
                }

                const { occurredAt, tz } = datetimeLocalToCanonical(localDatetime);

                /**
                 * Sin `origin`: no hay `<select>` de origen del dato en el formulario (ver JSDoc
                 * del módulo), así que `buildCommonEventFields` aplica su valor por defecto,
                 * `manual`, que es la única entrada posible hoy.
                 */
                const common = buildCommonEventFields({
                    device: this.$refs.device.value,
                    recordedBy: this.$refs.recordedBy.value,
                    note: this.$refs.note.value,
                });

                const content = buildInsulinContent({
                    dose,
                    insulinType,
                    product: this.$refs.product.value,
                    site: this.$refs.site.value,
                    tz,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                /** Acción de `HealthEventPage`, común a cualquier pantalla de evento (ADR 0006). */
                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.dose.value = '';

                await this.loadHistory();
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

                const rawEvents = await this.$wire.fetchEvents();

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

                const insulinEvents = filterInsulinEvents(opened);

                this.renderList(insulinEvents);
                this.renderChart(insulinEvents);
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /**
         * Sin clave no se puede descifrar nada: se dice, no se pinta una lista vacía.
         *
         * Perder la clave en memoria es normal y frecuente (ADR 0003), así que este estado tiene
         * que dejar la pantalla entera coherente: además del aviso en la lista, se tira la gráfica
         * anterior (si la hubiera) y su pie lo explica. Una gráfica con las barras de la sesión
         * anterior junto a un «necesitas iniciar sesión» es una contradicción a la vista.
         */
        renderLocked() {
            this.failedToOpenCount = 0;
            this.chartEvents = [];
            this.$refs.list.replaceChildren(createCallout({ tone: 'info', message: t('common.locked.history') }));
            this.destroyChart();
            this.paintLegend([]);
            this.$refs.chartCaption.textContent = t('insulin.chartLocked');
        },

        /** Destruye la instancia viva de Chart.js, si la hay. Repintar sin destruir la duplica. */
        destroyChart() {
            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }
        },

        /** @param {list<{id: string, occurredAt: string, content: object}>} insulinEvents */
        renderList(insulinEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (insulinEvents.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('insulin.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                list.className = 'flex flex-col';

                /** Más reciente primero, como llega de `fetchEvents` (orden descendente por servidor). */
                for (const event of insulinEvents) {
                    list.appendChild(this.renderListItem(event));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * Item de historial con la forma de DESIGN.md § Lists. La dosis es el dato de mayor riesgo
         * de esta pantalla (una dosis mal leída es una dosis mal puesta): va en `font-mono`,
         * `text-body-lg` y el texto principal `#0F172A`, nunca en un gris apagado, para que sea lo
         * primero y lo más legible de la fila.
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @returns {HTMLLIElement}
         */
        renderListItem(event) {
            const { data } = event.content;

            /**
             * Sin `hover:` ni `active:`: DESIGN.md § Lists reserva esos dos estados a un elemento
             * de lista pulsable, y este no es enlace ni botón —no tiene destino, ni manejador, ni
             * foco—. Prometer una interacción que no ocurre es peor que no prometerla. Mismo
             * criterio que `glucosePage.js`.
             */
            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('drop', 'mt-0.5 size-5 shrink-0 text-accent'));

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-2';

            /** Primera línea: la dosis. Monoespaciada, grande y en el texto principal. */
            const dose = document.createElement('p');
            dose.className = 'font-mono text-body-lg text-ink';

            /**
             * Sin `font-bold`: de IBM Plex Mono solo se empaqueta el peso 400 (§ Typography · Code
             * la define «regular»), así que pedir 700 haría que el navegador sintetizara una falsa
             * negrita, engordando y deformando justo los glifos numéricos que Do's #7 quiere
             * inconfundibles —y aquí el glifo deformado sería una dosis—. La dosis destaca por ser
             * lo primero de la fila, ir en el tamaño mayor de la lista y llevar la tinta principal,
             * frente al gris secundario de la unidad.
             */
            const doseValue = document.createElement('span');
            doseValue.textContent = data.dose;
            dose.appendChild(doseValue);

            const doseUnit = document.createElement('span');
            doseUnit.className = 'ml-1 text-ink-secondary';
            doseUnit.textContent = data.unit;
            dose.appendChild(doseUnit);

            body.appendChild(dose);

            const typeLabel = this.catalog.insulinTypes.find((row) => row.token === data.insulinType)?.label
                ?? data.insulinType;
            const siteLabel = injectionSiteLabel(this.catalog, data);
            const product = productLabel(data);

            const chips = document.createElement('div');
            chips.className = 'flex flex-wrap items-center gap-2';
            chips.appendChild(createStatusChip(typeLabel));

            /** Sin zona de inyección (opcional): no se muestra chip en su lugar. */
            if (siteLabel !== null) {
                chips.appendChild(createFilterChip(siteLabel));
            }

            body.appendChild(chips);

            /** Texto secundario: marca de tiempo y, si lo hay, el producto en texto libre. */
            const meta = document.createElement('p');
            /** Tamaño Code de § Typography, el papel de «medical codes, IDs, data fields». */
            meta.className = 'font-mono text-code text-ink-secondary';
            meta.textContent = product !== null
                ? `${formatDateTime(event.occurredAt)} · ${product}`
                : formatDateTime(event.occurredAt);
            body.appendChild(meta);

            item.appendChild(body);

            return item;
        },

        /**
         * Pinta la gráfica de barras de dosis diaria por tipo de insulina, o no pinta nada si no
         * hay datos. Es de barras y no de líneas a propósito: una dosis no es una magnitud continua
         * como la glucemia, y una línea sugeriría que hay un valor entre dos inyecciones que no
         * existe (ver JSDoc de `groupInsulinByDay`).
         *
         * @param {list<{id: string, occurredAt: string, content: object}>} insulinEvents
         */
        renderChart(insulinEvents) {
            /** Se guardan para poder repintar al conmutar el tema (ver `init()` y `chartTheme.js`). */
            this.chartEvents = insulinEvents;

            /** Colores del tema activo, leídos ahora y no al cargar el módulo (`chartTheme.js`). */
            const colors = chartColors();

            const { days, totalsByType } = groupInsulinByDay(insulinEvents);

            this.destroyChart();
            this.renderChartCaption(days, totalsByType);

            if (days.length === 0) {
                this.paintLegend([]);

                return;
            }

            const labels = days.map((day) => formatChartDay(`${day}T00:00:00`));
            const types = Object.keys(totalsByType);

            /**
             * En la leyenda cada tipo lleva además su propia marca —cuadrado, círculo, triángulo—,
             * que es la segunda codificación que pide Do's #3. Las barras no pueden llevar esa marca
             * (una barra es un rectángulo), así que quien lea la gráfica sin distinguir los tonos
             * sigue apoyándose en el pie, que dice en texto la dosis acumulada de cada tipo.
             */
            const series = types.map((type, index) => ({
                label: this.catalog.insulinTypes.find((row) => row.token === type)?.label ?? type,
                color: colors.series[CHART_SERIES_BY_TYPE[type] ?? index % colors.series.length],
                pointStyle: CHART_LEGEND_SHAPES[index % CHART_LEGEND_SHAPES.length],
            }));

            this.paintLegend(series);

            const datasets = series.map((entry, index) => ({
                label: entry.label,
                data: totalsByType[types[index]],
                backgroundColor: entry.color,
                borderColor: entry.color,
                borderRadius: 4,
            }));

            this.chart = new Chart(this.$refs.chart, {
                type: 'bar',
                data: { labels, datasets },
                options: {
                    maintainAspectRatio: false,
                    color: colors.tick,
                    scales: {
                        x: {
                            stacked: false,
                            grid: { display: false },
                            border: { color: colors.grid },
                            ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: colors.grid },
                            border: { color: colors.grid },
                            ticks: { color: colors.tick, font: { family: CHART_FONTS.mono, size: 12 } },
                            title: {
                                display: true,
                                text: t('insulin.yAxisTitle', { unit: INSULIN_UNIT }),
                                color: colors.tick,
                                font: { family: CHART_FONTS.mono, size: 13, weight: 600 },
                            },
                        },
                    },
                    plugins: {
                        /**
                         * La leyenda vive fuera del lienzo, en HTML (ver `chartLegend.js`): dentro
                         * reservaba alto del contenedor de 320px y, con `pointStyle: 'circle'`
                         * fijo, sus tres entradas se distinguían solo por el color.
                         */
                        legend: { display: false },
                        /**
                         * El par fondo/tinta sale del tema: el tooltip es el único componente que
                         * se invierte respecto de la interfaz (§ Charts — Dark).
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
        },

        /**
         * Pinta la leyenda en HTML, fuera del lienzo (ver el JSDoc de `chartLegend.js`).
         *
         * @param {list<{label: string, color: string, pointStyle: string}>} series
         */
        paintLegend(series) {
            renderLegend(
                legendElementFor(this.$refs.chart, 'insulin-chart-legend'),
                legendItems(series),
            );
        },

        /**
         * Escribe el pie de la gráfica, que es el nombre accesible de lo que pintan las barras (ver
         * `summarizeDailyDoses`).
         *
         * @param {list<string>} days
         * @param {Record<string, list<number>>} totalsByType
         */
        renderChartCaption(days, totalsByType) {
            this.$refs.chartCaption.textContent = summarizeDailyDoses(
                days,
                totalsByType,
                (type) => this.catalog.insulinTypes.find((row) => row.token === type)?.label ?? type,
            );
        },
    };
}
