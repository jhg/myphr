/**
 * Componente Alpine de la pantalla de tensión arterial (ADR 0002, ADR 0004, ADR 0005, ADR 0006,
 * ADR 0008).
 *
 * El contrato del DOM lo fija `resources/views/phr/pages/blood-pressure.blade.php`: nada de
 * `wire:model` (ADR 0002), los campos se leen por `x-ref` y el sobre cifrado sube como argumento de
 * `storeEvent`, nunca como propiedad de Livewire.
 *
 * **Un evento, tres valores** (ADR 0006): sistólica, diastólica y pulso viajan juntos en el mismo
 * sobre, porque es lo que da el aparato y lo que vive el paciente. El pulso es opcional: no todos
 * los tensiómetros lo miden.
 *
 * **El método lo forman el brazo y la postura** (ADR 0008): los dos cambian el valor de forma
 * conocida y solo se saben al medir. Aquí viajan como dos campos propios (`data.arm`,
 * `data.posture`) en vez de un único token compuesto, para que la lista y los selectores los
 * traten por separado, pero **nunca se agrupan por separado**: cualquier serie o promedio agrupa
 * siempre por la pareja (brazo, postura) junta, tal como exige el ADR — mezclar brazos o posturas
 * distintos en una misma serie sin decirlo sería un promedio que no significa nada.
 *
 * **El código LOINC no depende del método** (ver JSDoc de `App\Catalog\BloodPressureLoincCode`):
 * los tres códigos son constantes y llegan ya resueltos en `catalog.loinc`, así que, a diferencia
 * de la glucemia, no hace falta resolver una tabla (método, unidad) → código.
 *
 * **El servidor no puede filtrar por tipo** (ADR 0006): `fetchEvents` trae todos los eventos del
 * usuario y aquí se descifra cada uno y se descarta el que no sea `type === 'bloodPressure'`. Un
 * sobre que no abre no tumba la pantalla: se cuenta y se avisa (ADR 0004).
 *
 * **Los cuatro campos comunes a todo evento** (origen, aparato, quién registra, nota; ADR 0006) no
 * se construyen aquí: viven en `eventCommonFields.js` y `buildBloodPressureContent` los recibe ya
 * construidos, para desplegarlos en el nivel superior del contenido, nunca dentro de `data`.
 *
 * **El origen no se pregunta en el formulario.** `origin` distingue cómo entró el dato en la
 * aplicación —tecleado por una persona frente a importado automáticamente desde un aparato—, y en
 * esta pantalla la inserción es siempre manual: se lee un valor en un tensiómetro y se teclea, así
 * que preguntarlo no tiene una respuesta real y solo invita a contestar mal. `submit()` lo fija a
 * `'manual'` sin leer ningún campo del DOM; el aparato (`device`) sí es útil (con qué se midió) y
 * conserva su campo. El día que exista una importación automática desde un aparato, será ese flujo
 * quien ponga `origin: 'device'`, no este formulario.
 *
 * Las funciones exportadas antes de `bloodPressurePage()` son la lógica pura del componente, para
 * poder probarlas sin montar Alpine ni Chart.js (`tests/js/bloodPressurePage.test.mjs`).
 */

import Chart from 'chart.js/auto';

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { canonicalDate } from '../crypto/canonicalDate.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { formatChartDate, formatDateTime, joinList, t } from '../i18n/index.js';
import { legendElementFor, legendItems, renderLegend } from './chartLegend.js';
import { chartColors, observeThemeChange } from './chartTheme.js';
import { buildCommonEventFields } from './eventCommonFields.js';
import { openEvent, sealEvent } from './eventEnvelope.js';
import { parseNumericValue } from './numericValue.js';

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
 * @param {number} [options.timezoneOffsetMinutes] Desfase a usar en vez del de `Date` (mismo
 *        convenio que `Date.prototype.getTimezoneOffset()`), solo para poder probar esta función
 *        sin depender de la zona horaria de quien ejecuta los tests.
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

/** Separador de {@see methodKey}. Ningún token de brazo lo lleva, por eso el corte es por el primero. */
const METHOD_KEY_SEPARATOR = '_';

/**
 * Token estable que agrupa una lectura por método (ADR 0008): la pareja (brazo, postura) junta,
 * nunca por separado. No se guarda en el sobre bajo esta forma —`data.arm` y `data.posture` viajan
 * como campos propios— pero es la clave con la que la gráfica y cualquier estadística agrupan.
 *
 * @param {string} arm Token de `App\Catalog\BloodPressureArm`.
 * @param {string} posture Token de `App\Catalog\BloodPressurePosture`.
 * @returns {string}
 */
export function methodKey(arm, posture) {
    return `${arm}${METHOD_KEY_SEPARATOR}${posture}`;
}

/**
 * Deshace {@see methodKey}. Corta por el **primer** separador, no por todos: si algún día un token
 * de postura fuera compuesto (`semi_recumbent`), un `split('_')` a secas devolvería tres trozos y
 * la etiqueta del método saldría mal, en silencio. Los tokens no pueden cambiar una vez publicados
 * (ver `App\Catalog\BloodPressureArm`), pero sí pueden aparecer casos nuevos.
 *
 * @param {string} key
 * @returns {[string, string]} `[arm, posture]`.
 */
export function splitMethodKey(key) {
    const separatorIndex = key.indexOf(METHOD_KEY_SEPARATOR);

    if (separatorIndex === -1) {
        return [key, ''];
    }

    return [key.slice(0, separatorIndex), key.slice(separatorIndex + 1)];
}

/**
 * Etiqueta legible de un método (brazo + postura), a partir del catálogo del servidor.
 *
 * @param {{arms: list<{token: string, label: string}>, postures: list<{token: string, label: string}>}} catalog
 * @param {string} arm
 * @param {string} posture
 * @returns {string}
 */
export function methodLabel(catalog, arm, posture) {
    const armLabel = catalog.arms.find((row) => row.token === arm)?.label ?? arm;
    const postureLabel = catalog.postures.find((row) => row.token === posture)?.label ?? posture;

    return `${armLabel}, ${postureLabel}`;
}

/**
 * Construye el contenido en claro de un evento de tensión arterial, con la forma del ADR 0006 más
 * el método del ADR 0008. Los tres valores viajan como cadena, nunca como número (ADR 0004:
 * decimales como cadena).
 *
 * `common` son los cuatro campos que comparte cualquier tipo de evento (ver `eventCommonFields.js`)
 * y van en el nivel superior del contenido, no dentro de `data`. El pulso es opcional: si no se
 * indica (cadena vacía o ausente), ni `data.pulse` ni `data.pulseUnit` ni `data.loinc.pulse` entran
 * en el contenido, en vez de guardarse como cadena vacía.
 *
 * `data.loinc` trae los tres códigos LOINC ya resueltos por el servidor (`catalog.loinc`), porque
 * no dependen del método (ver JSDoc de `bloodPressurePage.js`).
 *
 * @param {object} params
 * @param {string} params.systolic Tal cual lo escribió la persona, ya como cadena.
 * @param {string} params.diastolic Tal cual lo escribió la persona, ya como cadena.
 * @param {string} [params.pulse] Tal cual lo escribió la persona, ya como cadena, o vacío/ausente.
 * @param {string} params.arm Token de `App\Catalog\BloodPressureArm`.
 * @param {string} params.posture Token de `App\Catalog\BloodPressurePosture`.
 * @param {string} params.tz Desfase `±HH:MM` del momento del registro.
 * @param {{units: {pressure: string, pulse: string}, loinc: {systolic: string, diastolic: string, pulse: string}}} params.catalog
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Ya construido por `buildCommonEventFields`.
 * @returns {{v: 1, type: 'bloodPressure', tz: string, origin: string, recordedBy: string,
 *           device?: string, note?: string, data: {systolic: string, diastolic: string,
 *           pulse?: string, unit: string, pulseUnit?: string,
 *           loinc: {systolic: string, diastolic: string, pulse?: string},
 *           arm: string, posture: string}}}
 * @throws {Error} Si falta la sistólica, la diastólica, el brazo o la postura.
 */
export function buildBloodPressureContent({ systolic, diastolic, pulse, arm, posture, tz, catalog, common }) {
    if (typeof systolic !== 'string' || systolic.trim() === '') {
        throw new Error(t('bloodPressure.missingSystolic'));
    }

    if (typeof diastolic !== 'string' || diastolic.trim() === '') {
        throw new Error(t('bloodPressure.missingDiastolic'));
    }

    if (typeof arm !== 'string' || arm.trim() === '') {
        throw new Error(t('bloodPressure.missingArm'));
    }

    if (typeof posture !== 'string' || posture.trim() === '') {
        throw new Error(t('bloodPressure.missingPosture'));
    }

    const data = {
        systolic,
        diastolic,
        unit: catalog.units.pressure,
        loinc: {
            systolic: catalog.loinc.systolic,
            diastolic: catalog.loinc.diastolic,
        },
        arm,
        posture,
    };

    const trimmedPulse = typeof pulse === 'string' ? pulse.trim() : '';

    if (trimmedPulse !== '') {
        data.pulse = trimmedPulse;
        data.pulseUnit = catalog.units.pulse;
        data.loinc.pulse = catalog.loinc.pulse;
    }

    return {
        v: 1,
        type: 'bloodPressure',
        tz,
        ...common,
        data,
    };
}

/**
 * Descarta los eventos descifrados que no son de tipo `bloodPressure`. El servidor no puede hacer
 * este filtro porque el tipo va cifrado dentro del sobre (ADR 0006): es responsabilidad del
 * cliente.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Ya descifrados.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterBloodPressureEvents(events) {
    return events.filter((event) => event.content?.type === 'bloodPressure');
}

/**
 * Agrupa las lecturas de sistólica y diastólica por método —brazo y postura juntos (ADR 0008)—
 * para la gráfica principal. Nunca se agrupa por brazo o postura por separado.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} bpEvents Ya filtrados por
 *        `filterBloodPressureEvents`.
 * @returns {Record<string, {systolic: list<{x: number, y: number}>, diastolic: list<{x: number, y: number}>}>}
 */
export function groupBloodPressureByMethod(bpEvents) {
    /** @type {Record<string, {systolic: list<{x: number, y: number}>, diastolic: list<{x: number, y: number}>}>} */
    const seriesByMethod = {};

    for (const event of bpEvents) {
        const { data } = event.content;
        const key = methodKey(data.arm, data.posture);

        if (seriesByMethod[key] === undefined) {
            seriesByMethod[key] = { systolic: [], diastolic: [] };
        }

        const x = Date.parse(event.occurredAt);
        seriesByMethod[key].systolic.push({ x, y: Number(data.systolic) });
        seriesByMethod[key].diastolic.push({ x, y: Number(data.diastolic) });
    }

    for (const group of Object.values(seriesByMethod)) {
        group.systolic.sort((a, b) => a.x - b.x);
        group.diastolic.sort((a, b) => a.x - b.x);
    }

    return seriesByMethod;
}

/**
 * Agrupa el pulso por método —brazo y postura juntos, mismo criterio que
 * `groupBloodPressureByMethod`— para la gráfica de pulso, aparte de la de tensión. El pulso es
 * opcional (no todos los aparatos lo dan), así que las lecturas sin pulso se cuentan y se dejan
 * fuera en vez de entrar como cero.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} bpEvents Ya filtrados por
 *        `filterBloodPressureEvents`.
 * @returns {{seriesByMethod: Record<string, list<{x: number, y: number}>>, missingPulseCount: number}}
 */
export function groupPulseByMethod(bpEvents) {
    /** @type {Record<string, list<{x: number, y: number}>>} */
    const seriesByMethod = {};
    let missingPulseCount = 0;

    for (const event of bpEvents) {
        const { data } = event.content;

        if (typeof data.pulse !== 'string' || data.pulse === '') {
            missingPulseCount += 1;

            continue;
        }

        const key = methodKey(data.arm, data.posture);

        if (seriesByMethod[key] === undefined) {
            seriesByMethod[key] = [];
        }

        seriesByMethod[key].push({ x: Date.parse(event.occurredAt), y: Number(data.pulse) });
    }

    for (const points of Object.values(seriesByMethod)) {
        points.sort((a, b) => a.x - b.x);
    }

    return { seriesByMethod, missingPulseCount };
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
 * Segunda codificación del método, además del color (Do's #3): el patrón de trazo. Quien no
 * distingue los colores —daltonismo, pantalla en blanco y negro, impresión— sigue pudiendo decir
 * qué línea es qué método, y el ADR 0008 prohíbe mezclar métodos en silencio.
 *
 * Un color por método (ADR 0008), no por magnitud, y salen de `chartColors()`, que los lee del tema
 * en cada dibujado (ver `chartTheme.js`).
 */
const CHART_METHOD_DASHES = Object.freeze([
    Object.freeze([]),
    Object.freeze([6, 4]),
    Object.freeze([2, 3]),
]);

/**
 * Tercera codificación, esta para la magnitud dentro de un mismo método: la sistólica va en
 * círculo y la diastólica en triángulo. Así, en la gráfica de tensión, ni el método ni la magnitud
 * dependen solo del color.
 */
const CHART_POINT_STYLES = Object.freeze({ systolic: 'circle', diastolic: 'triangle', pulse: 'circle' });

/** Familias de DESIGN.md § Typography, declaradas por nombre porque `<canvas>` no lee variables CSS. */
const CHART_FONTS = Object.freeze({
    body: "'Open Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
});

/**
 * Familia y tamaño por defecto de todo el lienzo, en el único sitio donde Chart.js los admite:
 * `Chart.defaults.font`. No existe una clave `font` en la raíz de `options` —antes había una aquí
 * y era configuración muerta que aparentaba cubrir lo que no cubría—, porque Chart.js resuelve la
 * tipografía de cada elemento contra estos valores por defecto.
 */
Chart.defaults.font.family = CHART_FONTS.body;
Chart.defaults.font.size = 13;

/**
 * Trazados de Heroicons v2 (outline, 24×24), la misma familia que usa el panel. El del historial es
 * el corazón de `BloodPressure::$navigationIcon`, para que el icono guía de cada registro sea el
 * mismo que el de la sección.
 */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    heart: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 '
        + '3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z',
});

/**
 * Icono decorativo de 20px (DESIGN.md § Lists: «20px icon»). Va con `aria-hidden`: nunca lleva
 * información que no esté también en el texto (Do's #3).
 *
 * @param {'warning'|'info'|'heart'} name
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
 * Aviso en bloque con icono (DESIGN.md § Chips (Status Chip)): color + icono + texto, nunca color a
 * secas (Do's #3).
 *
 * @param {object} params
 * @param {'error'|'info'} params.tone
 * @param {string} params.message
 * @returns {HTMLDivElement}
 */
function createCallout({ tone, message }) {
    const callout = document.createElement('div');

    /**
     * Los dos tonos salen de los tokens de aviso (`error-*` / `info-*`, ver `theme.css`), no de
     * las rampas `danger`/`primary`: esas rampas no se reasignan en oscuro, así que el aviso salía
     * en tema oscuro como un rectángulo rosa claro con tinta rosa. Además la tinta de error de los
     * tokens es #B91C1C y no el #DC2626 de § Chips, que sobre #FEF2F2 da 4.41:1 y no llega al
     * 4.5:1 de Do's #1. Mismos tokens y mismas clases que `glucosePage.js`.
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
 * radio. Es el chip del **método de medición**, igual que en `glucosePage.js`: brazo y postura son
 * lo que el ADR 0008 llama método, así que llevan el mismo tratamiento visual que el método de la
 * glucemia y no el de un filtro secundario.
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
 * Factoría del componente Alpine. Se registra como `phrBloodPressurePage`.
 *
 * @returns {object}
 */
export function bloodPressurePage() {
    return {
        error: '',
        catalog: null,
        loading: false,

        /** Sobres descifrados que fallaron al abrir en la última carga (no tumban la pantalla). */
        failedToOpenCount: 0,

        /** Instancias de Chart.js vivas, para poder destruirlas antes de repintar. */
        chart: null,
        pulseChart: null,

        /**
         * Últimos eventos que se pintaron. No es caché de datos: es lo que permite rehacer las dos
         * gráficas cuando cambia el tema sin volver a pedir ni a descifrar nada (`chartTheme.js`).
         */
        chartEvents: [],

        init() {
            this.catalog = JSON.parse(document.querySelector('[data-phr-blood-pressure-catalog]').textContent);

            /**
             * DESIGN.md § Charts — Dark: la gráfica tiene que releer los colores y repintarse cuando
             * `<html>` entra o sale del modo oscuro, o el panel entero conmuta menos las gráficas.
             */
            observeThemeChange(() => {
                if (this.chart !== null || this.pulseChart !== null) {
                    this.renderCharts(this.chartEvents);
                }
            });

            /**
             * Las opciones de `arm` y `posture` las renderiza el servidor en Blade (ADR 0002,
             * ADR 0005): no se rellenan aquí. Ver el comentario al inicio de
             * `blood-pressure.blade.php`.
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
         * significa una lectura duplicada en el historial. La plantilla lo usa para deshabilitar el
         * botón, marcar `aria-busy` y cambiar el texto (Do's #3), igual que la glucemia.
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

                // Valida el formato numérico y normaliza la coma a punto (ver JSDoc de
                // `numericValue.js`); la cadena vacía pasa intacta y la detecta como "falta el
                // dato" `buildBloodPressureContent` más abajo. El resultado sigue siendo cadena:
                // no se convierte a número (ADR 0004).
                const systolic = parseNumericValue(this.$refs.systolic.value.trim(), t('field.systolic'));
                const diastolic = parseNumericValue(this.$refs.diastolic.value.trim(), t('field.diastolic'));
                const pulse = parseNumericValue(this.$refs.pulse.value.trim(), t('field.pulse'));

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

                const content = buildBloodPressureContent({
                    systolic,
                    diastolic,
                    pulse,
                    arm: this.$refs.arm.value,
                    posture: this.$refs.posture.value,
                    tz,
                    catalog: this.catalog,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.systolic.value = '';
                this.$refs.diastolic.value = '';
                this.$refs.pulse.value = '';

                await this.loadHistory();
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /** Descarga, descifra, filtra y pinta el historial (lista y gráficas). */
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

                const bpEvents = filterBloodPressureEvents(opened);

                this.renderList(bpEvents);
                this.renderCharts(bpEvents);
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /** Sin clave no se puede descifrar nada: se dice, no se pinta una lista vacía. */
        renderLocked() {
            this.$refs.list.replaceChildren(createCallout({ tone: 'info', message: t('common.locked.history') }));
        },

        /** @param {list<{id: string, occurredAt: string, content: object}>} bpEvents */
        renderList(bpEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (bpEvents.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('bloodPressure.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                list.className = 'flex flex-col';

                for (const event of bpEvents) {
                    list.appendChild(this.renderListItem(event));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * Item de historial con la forma de DESIGN.md § Lists, la misma que la glucemia. El valor
         * va en IBM Plex Mono (Do's #7); el método (brazo + postura) pasa a ser un chip de estado,
         * para no perderse en texto concatenado.
         *
         * El `<li>` NO lleva `hover:` ni `active:`: DESIGN.md § Lists reserva esos dos estados a un
         * elemento de lista pulsable, y este no es enlace ni botón —no tiene destino, ni manejador,
         * ni foco—. Prometer una interacción que no ocurre es peor que no prometerla; mismo
         * criterio que en `glucosePage.js`.
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @returns {HTMLLIElement}
         */
        renderListItem(event) {
            const { data } = event.content;

            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('heart', 'mt-0.5 size-5 shrink-0 text-accent'));

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-2';

            /** Primera línea: la medida. Va en monoespaciada y en el texto principal #0F172A. */
            const measurement = document.createElement('p');
            measurement.className = 'font-mono text-body text-ink';

            /**
             * Sin `font-semibold`: de IBM Plex Mono solo se empaqueta el peso 400 (§ Typography ·
             * Code la define «regular»), así que pedir 600 haría que el navegador sintetizara una
             * falsa negrita, engordando justo los glifos numéricos que Do's #7 quiere
             * inconfundibles. Mismo motivo que en `glucosePage.js`.
             */
            const values = document.createElement('span');
            values.textContent = `${data.systolic}/${data.diastolic}`;
            measurement.appendChild(values);

            const unit = document.createElement('span');
            unit.className = 'ml-1 text-ink-secondary';
            unit.textContent = data.unit;
            measurement.appendChild(unit);

            /**
             * El pulso llevaba un `♥` delante. Un símbolo no es una etiqueta: un lector de pantalla
             * lo lee «corazón negro» y quien no lo reconoce no sabe qué es ese tercer número
             * (Do's #3, el significado nunca viaja solo en un adorno). Va con su palabra.
             */
            if (typeof data.pulse === 'string' && data.pulse !== '') {
                const pulse = document.createElement('span');
                pulse.className = 'ml-3 text-ink-secondary';
                pulse.textContent = t('bloodPressure.pulseInline', {
                    value: data.pulse,
                    unit: data.pulseUnit ?? '',
                }).trim();
                measurement.appendChild(pulse);
            }

            body.appendChild(measurement);

            const chips = document.createElement('div');
            chips.className = 'flex flex-wrap items-center gap-2';
            chips.appendChild(createStatusChip(methodLabel(this.catalog, data.arm, data.posture)));
            body.appendChild(chips);

            /**
             * Texto secundario: marca de tiempo y códigos LOINC, ambos numéricos → monoespaciada, y
             * en el tamaño Code de § Typography (14px), que es el papel que DESIGN.md define para
             * «medical codes, IDs, data fields». Mismo formato de fecha que las demás pantallas:
             * `formatDateTime`, en el idioma activo.
             */
            const loincCodes = [data.loinc?.systolic, data.loinc?.diastolic, data.loinc?.pulse]
                .filter((code) => typeof code === 'string' && code !== '')
                .join(', ');

            const meta = document.createElement('p');
            meta.className = 'font-mono text-code text-ink-secondary';
            meta.textContent = `${formatDateTime(event.occurredAt)} · LOINC ${loincCodes}`;
            body.appendChild(meta);

            item.appendChild(body);

            return item;
        },

        /**
         * Pinta las dos gráficas: tensión (sistólica y diastólica) y pulso, aparte una de otra
         * (el pulso no comparte escala con la presión). Ninguna mezcla brazos o posturas
         * distintos en una misma serie sin decirlo (ADR 0008): cada método tiene su propio par de
         * series de color y su etiqueta lo dice en la leyenda.
         *
         * El eje X es de categoría, no lineal sobre epoch: no hay adaptador de fechas de Chart.js
         * instalado, así que las etiquetas se formatean aquí con `Intl.DateTimeFormat('es')`.
         *
         * @param {list<{id: string, occurredAt: string, content: object}>} bpEvents
         */
        renderCharts(bpEvents) {
            /** Se guardan para poder repintar al conmutar el tema (ver `init()` y `chartTheme.js`). */
            this.chartEvents = bpEvents;

            /** Colores del tema activo, leídos ahora y no al cargar el módulo (`chartTheme.js`). */
            const colors = chartColors();

            const seriesByMethod = groupBloodPressureByMethod(bpEvents);
            const { seriesByMethod: pulseSeriesByMethod, missingPulseCount } = groupPulseByMethod(bpEvents);

            const methods = Object.keys(seriesByMethod);
            const pulseMethods = Object.keys(pulseSeriesByMethod);

            if (this.chart !== null) {
                this.chart.destroy();
                this.chart = null;
            }

            if (this.pulseChart !== null) {
                this.pulseChart.destroy();
                this.pulseChart = null;
            }

            this.chart = this.buildLineChart({
                canvas: this.$refs.chart,
                legendElement: legendElementFor(this.$refs.chart, 'blood-pressure-chart-legend'),
                methods,
                labelFor: (method, index) => {
                    const label = methodLabel(this.catalog, ...splitMethodKey(method));
                    const color = colors.series[index % colors.series.length];
                    const borderDash = CHART_METHOD_DASHES[index % CHART_METHOD_DASHES.length];

                    return [
                        {
                            label: t('bloodPressure.series.systolic', { method: label }),
                            points: seriesByMethod[method].systolic,
                            color,
                            borderDash,
                            pointStyle: CHART_POINT_STYLES.systolic,
                        },
                        {
                            label: t('bloodPressure.series.diastolic', { method: label }),
                            points: seriesByMethod[method].diastolic,
                            color,
                            borderDash,
                            pointStyle: CHART_POINT_STYLES.diastolic,
                        },
                    ];
                },
                yTitle: this.catalog.units.pressure,
            });

            this.pulseChart = this.buildLineChart({
                canvas: this.$refs.pulseChart,
                legendElement: legendElementFor(this.$refs.pulseChart, 'blood-pressure-pulse-chart-legend'),
                methods: pulseMethods,
                labelFor: (method, index) => [
                    {
                        label: methodLabel(this.catalog, ...splitMethodKey(method)),
                        points: pulseSeriesByMethod[method],
                        color: colors.series[index % colors.series.length],
                        borderDash: CHART_METHOD_DASHES[index % CHART_METHOD_DASHES.length],
                        pointStyle: CHART_POINT_STYLES.pulse,
                    },
                ],
                yTitle: this.catalog.units.pulse,
            });

            this.renderChartCaption({ methods, pulseMethods, missingPulseCount });
        },

        /**
         * Construye una gráfica de líneas por categorías de tiempo compartidas entre todas las
         * series que le pasen, o no pinta nada si no hay puntos (un lienzo con ejes vacíos parece
         * un fallo, no un estado vacío legítimo).
         *
         * @param {object} params
         * @param {HTMLCanvasElement} params.canvas
         * @param {HTMLElement|null} params.legendElement Nodo de la leyenda en HTML, fuera del
         *        lienzo (ver `chartLegend.js`). Se repinta siempre, también cuando no hay datos:
         *        una leyenda que sobreviviera a una gráfica vacía describiría líneas que no están.
         * @param {list<string>} params.methods
         * @param {(method: string, index: number) => list<{label: string, points: list<{x: number, y: number}>, color: string, borderDash: list<number>, pointStyle: string}>} params.labelFor
         * @param {string} params.yTitle
         * @returns {Chart|null}
         */
        buildLineChart({ canvas, legendElement, methods, labelFor, yTitle }) {
            /** Colores del tema activo, leídos ahora y no al cargar el módulo (`chartTheme.js`). */
            const colors = chartColors();

            const allSeries = methods.flatMap((method, index) => labelFor(method, index));
            const timestamps = [...new Set(allSeries.flatMap((series) => series.points.map((point) => point.x)))]
                .sort((a, b) => a - b);

            if (timestamps.length === 0) {
                renderLegend(legendElement, []);

                return null;
            }

            /**
             * `allSeries` es a la vez lo que consume Chart.js y lo que rotula la leyenda: una sola
             * fuente, así que ninguna de las dos puede quedarse con un color, un trazo o una forma
             * distintos de los de la otra.
             */
            renderLegend(legendElement, legendItems(allSeries));

            const labels = timestamps.map((timestamp) => formatChartDate(timestamp));

            const datasets = allSeries.map((series) => {
                const byTimestamp = new Map(series.points.map((point) => [point.x, point.y]));

                return {
                    label: series.label,
                    data: timestamps.map((timestamp) => byTimestamp.get(timestamp) ?? null),
                    borderColor: series.color,
                    backgroundColor: series.color,
                    pointBackgroundColor: series.color,
                    pointBorderColor: colors.surface,
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    borderWidth: 2,
                    /** Segunda y tercera codificación, además del color (Do's #3). */
                    borderDash: [...series.borderDash],
                    pointStyle: series.pointStyle,
                    tension: 0.3,
                    spanGaps: true,
                };
            });

            return new Chart(canvas, {
                type: 'line',
                data: { labels, datasets },
                options: {
                    maintainAspectRatio: false,
                    color: colors.tick,
                    scales: {
                        x: {
                            type: 'category',
                            /**
                             * La rejilla puede ser tenue (#E2E8F0), pero la LÍNEA DE EJE no: es la
                             * referencia contra la que se lee una tensión, y en #E2E8F0 sobre
                             * blanco daba 1.23:1, casi invisible (Don'ts #10). Va en el mismo
                             * #475569 de los rótulos, 7.58:1.
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
                                text: yTitle,
                                color: colors.tick,
                                /**
                                 * Peso 400: de IBM Plex Mono solo se empaqueta ese, y pedir 600
                                 * obligaría al navegador a sintetizar una falsa negrita sobre el
                                 * código UCUM de la unidad.
                                 */
                                font: { family: CHART_FONTS.mono, size: 13, weight: 400 },
                            },
                        },
                    },
                    plugins: {
                        /**
                         * La leyenda vive fuera del lienzo, en HTML (ver `chartLegend.js`). Esta es
                         * la pantalla que peor lo llevaba: cada método genera DOS series
                         * («Sistólica · Izquierdo, sentado» y su diastólica), así que tres métodos
                         * son seis entradas largas y su alto —que Chart.js resta del área de datos—
                         * dependía del ancho de la ventana.
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
         * Pies de las dos gráficas: qué métodos incluye cada una (ADR 0008) y cuántos registros no
         * tenían pulso y quedaron fuera de la de pulso.
         *
         * Los dos `<p>` los pinta Blade, no este método. Antes se creaban aquí y se insertaban
         * `afterend` del `<canvas>`, es decir DENTRO del contenedor de altura fija: Chart.js exige
         * que el padre del lienzo sea suyo en exclusiva cuando corre con `maintainAspectRatio:
         * false`, y un hermano dentro puede disparar el bucle de redimensionado. Además, al
         * pintarlos Blade tienen un `id` estable y pueden ser el `aria-describedby` del lienzo, que
         * es la única forma de que la tendencia llegue a quien no ve la gráfica (Do's #3).
         *
         * @param {object} params
         * @param {list<string>} params.methods Métodos con datos en la gráfica de tensión.
         * @param {list<string>} params.pulseMethods Métodos con datos en la gráfica de pulso.
         * @param {number} params.missingPulseCount
         */
        renderChartCaption({ methods, pulseMethods, missingPulseCount }) {
            const labelsOf = (keys) => keys.map((key) => methodLabel(this.catalog, ...splitMethodKey(key)));

            const methodLabels = labelsOf(methods);

            this.$refs.chartCaption.textContent = methodLabels.length > 0
                ? t('bloodPressure.caption.includes', { methods: joinList(methodLabels) })
                : t('bloodPressure.caption.empty');

            const pulseMethodLabels = labelsOf(pulseMethods);

            /**
             * Sin ningún pulso registrado el pie decía «Todos los registros con pulso se
             * muestran», que sobre una gráfica vacía se lee como que no hay nada que ver cuando en
             * realidad puede haber tensiones registradas sin pulso. Se dicen las dos cosas.
             */
            const includedText = pulseMethodLabels.length > 0
                ? t('bloodPressure.pulseCaption.includes', { methods: joinList(pulseMethodLabels) })
                : t('bloodPressure.pulseCaption.empty');

            const missingText = missingPulseCount > 0
                ? t('bloodPressure.pulseCaption.missing', { count: missingPulseCount })
                : '';

            this.$refs.pulseChartCaption.textContent = `${includedText}${missingText}`;
        },
    };
}
