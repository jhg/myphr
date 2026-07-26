/**
 * Componente Alpine del panel de inicio (ADR 0002, ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * Resume glucemia y tensión arterial de la última semana y del último mes. Todo el cálculo lo hace
 * `health/statistics.js` (`summarizeGlucose`, `summarizeBloodPressure`): este módulo no reimplementa
 * ninguna media ni mediana, solo descifra los eventos, se los pasa tal cual espera esa API y da
 * forma al resultado para pintarlo. Igual que `glucosePage.js`, nada de `wire:model` (ADR 0002): el
 * único dato que sube al servidor es la petición de lectura `fetchEvents`, y el descifrado ocurre
 * aquí, en el navegador.
 *
 * **El servidor no puede filtrar por tipo** (ADR 0006): `fetchEvents` trae todos los eventos del
 * usuario y aquí se descifra cada uno; los que no son de tipo `glucose` o `bloodPressure` los
 * descarta la propia `statistics.js` al agrupar. Un sobre que no abre no tumba el panel: se cuenta y
 * se avisa (ADR 0004).
 *
 * **Por eso se pagina**: como bajan todos los tipos de evento mezclados, una sola página de
 * `fetchEvents` no cubre necesariamente los 30 días que resume el panel. Se piden páginas con cursor
 * hasta llegar al inicio de la ventana ({@see needsAnotherPage}); si aun así no se llega, el panel lo
 * dice en vez de presentar un resumen recortado como si fuera completo.
 *
 * **El método de medición no se mezcla en silencio** (ADR 0008): cada tarjeta de estadística es de
 * un único método, con su etiqueta siempre visible. `formatMethodLabel` traduce el token del evento
 * a una etiqueta legible; es una duplicación deliberada de las etiquetas que ya definen
 * `App\Catalog\GlucoseMeasurementMethod`, `App\Catalog\BloodPressureArm` y
 * `App\Catalog\BloodPressurePosture` (no se pueden tocar esos ficheros desde aquí), así que un
 * token nuevo que no esté en el mapa cae al humanizado genérico en vez de romper el panel.
 *
 * **El rango objetivo de glucemia no trae valor por defecto** (ADR 0007): `resolveGlucoseTargetRange`
 * solo lo pasa a `summarizeGlucose` cuando los ajustes cifrados traen un rango válido y en la misma unidad
 * de presentación (el rango guarda la suya y no se convierte entre unidades); si no lo hay,
 * `summarizeGlucose` no calcula `inRangePercent` en absoluto y la vista no dibuja esa estadística en
 * ningún hueco, solo una invitación discreta a configurarlo. Quien escribe `glucoseTargetRange` es
 * la pantalla de perfil (`resources/js/auth/profilePage.js`), así que el nombre del ajuste es un
 * contrato entre esos dos módulos: cambiarlo en uno sin el otro deja la estadística muda.
 */

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { settings } from '../auth/settings.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { formatDateTime, formatNumber as formatLocalizedNumber, t } from '../i18n/index.js';
import { openEvent } from './eventEnvelope.js';
import { summarizeBloodPressure, summarizeGlucose, WINDOW_DAYS } from './statistics.js';

/** Unidad de presentación de glucemia por defecto, igual que en `glucosePage.js` (ADR 0006). */
const DEFAULT_UNIT = 'mg/dL';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Tamaño de página de `fetchEvents`: el techo duro de `HealthEventPage::MAX_FETCH_LIMIT`, que
 * recorta cualquier valor mayor. Pedir menos solo multiplicaría las idas y vueltas.
 */
const FETCH_PAGE_SIZE = 500;

/**
 * Tope de páginas por carga. Con 500 eventos por página son 5.000 eventos, muy por encima de lo
 * que cabe en 30 días de registro humano; existe solo para que un cursor que no avanzara no
 * dejara al navegador pidiendo páginas sin fin.
 */
const MAX_FETCH_PAGES = 10;

/**
 * Claves de catálogo de los métodos de glucemia (`App\Catalog\GlucoseMeasurementMethod`, ADR 0008).
 *
 * El panel de inicio es la única pantalla que no recibe el catálogo del servidor, así que traduce
 * estos tokens por su cuenta. La lista de tokens sí es la del servidor y no puede cambiar: son los
 * que viajan dentro del sobre cifrado.
 */
const GLUCOSE_METHOD_KEYS = Object.freeze({
    capillary: 'dashboard.method.capillary',
    interstitial: 'dashboard.method.interstitial',
});

/** Claves de brazo de tensión (`App\Catalog\BloodPressureArm`, ADR 0008). */
const BLOOD_PRESSURE_ARM_KEYS = Object.freeze({
    left: 'dashboard.arm.left',
    right: 'dashboard.arm.right',
});

/** Claves de postura de tensión (`App\Catalog\BloodPressurePosture`, ADR 0008). */
const BLOOD_PRESSURE_POSTURE_KEYS = Object.freeze({
    sitting: 'dashboard.posture.sitting',
    lying: 'dashboard.posture.lying',
    standing: 'dashboard.posture.standing',
});

/**
 * Etiqueta legible de un token de método (ADR 0008): glucemia (`capillary`, `interstitial`) o
 * tensión (`${brazo}_${postura}`, p. ej. `left_sitting`).
 *
 * Un token que no reconoce (una magnitud o combinación futura) no rompe el panel: se humaniza
 * capitalizando cada palabra separada por `_`, para que la vista siga diciendo qué incluye aunque
 * no sepa traducirlo con precisión clínica.
 *
 * @param {string} token
 * @returns {string}
 */
export function formatMethodLabel(token) {
    if (GLUCOSE_METHOD_KEYS[token] !== undefined) {
        return t(GLUCOSE_METHOD_KEYS[token]);
    }

    const [arm, posture] = token.split('_');

    if (BLOOD_PRESSURE_ARM_KEYS[arm] !== undefined && BLOOD_PRESSURE_POSTURE_KEYS[posture] !== undefined) {
        return t('dashboard.method.combined', {
            arm: t(BLOOD_PRESSURE_ARM_KEYS[arm]),
            posture: t(BLOOD_PRESSURE_POSTURE_KEYS[posture]),
        });
    }

    return token
        .split('_')
        .filter((word) => word !== '')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Da forma de número localizado a un valor ya calculado por `statistics.js`. Los valores que llegan
 * aquí son siempre números JavaScript (media, mediana, mínimo, máximo, porcentaje), nunca la cadena
 * en reposo del ADR 0004: ver el JSDoc de `statistics.js` sobre precisión de presentación.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatNumber(value) {
    return formatLocalizedNumber(value);
}

/**
 * Aplana un evento descifrado a la forma que espera `statistics.js`: el contenido en claro
 * (`{v, type, tz, data, ...}`) más `occurredAt` en el mismo nivel (ver JSDoc del módulo
 * `statistics.js`, «Forma de entrada»).
 *
 * @param {{occurredAt: string}} rawEvent Tal cual lo devuelve `fetchEvents` (sin descifrar).
 * @param {object} content Contenido ya descifrado con `openEvent`.
 * @returns {object}
 */
export function flattenDecryptedEvent(rawEvent, content) {
    return { ...content, occurredAt: rawEvent.occurredAt };
}

/**
 * Resuelve el rango objetivo de glucemia de los ajustes cifrados del usuario (ADR 0007).
 *
 * El ajuste **no trae valor por defecto**: si los ajustes no existen, o no traen
 * `glucoseTargetRange`, o lo traen con `low`/`high` que no son números finitos y ordenados, esta
 * función devuelve `undefined` y `summarizeGlucose` no calculará `inRangePercent` en absoluto (ni
 * `null` ni `0`: la clave no está). Solo un rango bien formado se pasa adelante.
 *
 * **El rango lleva su propia unidad y hay que compararla con la de presentación** (ADR 0007: no se
 * convierte entre mg/dL y mmol/L). El perfil deja elegir las dos por separado, así que un rango de
 * 3,9-10 mmol/L con lecturas en mg/dL es un estado alcanzable: comparar unos números contra los
 * otros publicaría un «tiempo en rango: 0 %» que parece un dato clínico y no lo es. Un rango en otra
 * unidad se descarta igual que uno mal formado, y quien lo lea puede avisar con
 * {@see targetRangeUnitMismatch}.
 *
 * @param {object|null} userSettings Lo que devuelve `settings()`.
 * @param {string} unit Unidad de presentación vigente.
 * @returns {{low: number, high: number, unit: string}|undefined}
 */
export function resolveGlucoseTargetRange(userSettings, unit) {
    const raw = userSettings?.glucoseTargetRange;

    if (raw === undefined || raw === null) {
        return undefined;
    }

    const low = Number(raw.low);
    const high = Number(raw.high);

    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) {
        return undefined;
    }

    if (raw.unit !== unit) {
        return undefined;
    }

    return { low, high, unit: raw.unit };
}

/**
 * ¿Hay un rango objetivo guardado que no se puede aplicar porque está en otra unidad?
 *
 * Distingue «no hay rango» de «hay rango y no sirve aquí»: el primero se resuelve configurándolo, el
 * segundo cambiando una de las dos unidades, y ofrecer el mensaje equivocado manda a la persona al
 * sitio equivocado.
 *
 * @param {object|null} userSettings
 * @param {string} unit Unidad de presentación vigente.
 * @returns {boolean}
 */
export function targetRangeUnitMismatch(userSettings, unit) {
    const raw = userSettings?.glucoseTargetRange;

    if (raw === undefined || raw === null) {
        return false;
    }

    return Number.isFinite(Number(raw.low)) && Number.isFinite(Number(raw.high)) && raw.unit !== unit;
}

/**
 * Instante en que empieza la ventana más larga del panel (el mes), en milisegundos desde epoch.
 * Es el punto hasta el que hay que retroceder pidiendo páginas de eventos: nada anterior entra en
 * ningún cálculo (`isWithinWindow` de `statistics.js`).
 *
 * @param {Date|string|number} referenceInstant
 * @returns {number}
 */
export function monthWindowStartMs(referenceInstant) {
    return new Date(referenceInstant).getTime() - (WINDOW_DAYS.month * MS_PER_DAY);
}

/**
 * ¿Hace falta pedir otra página de eventos?
 *
 * `fetchEvents` devuelve **todos** los tipos de evento del usuario (el servidor no puede filtrar
 * por tipo, ADR 0006) ordenados de más reciente a más antiguo y con un límite. Con una sola página
 * de 100 —el valor por defecto del servidor— quien registra glucemia, tensión, comidas e insulina
 * varias veces al día no llega ni a diez días atrás, y el resumen del mes saldría recortado sin
 * decirlo: justo el "cero que parece una medición real" que hay que evitar. Así que se pagina con
 * cursor hasta cubrir la ventana del mes.
 *
 * Se para cuando la página viene incompleta (ya no hay más eventos) o cuando el más antiguo de la
 * página ya cae antes del inicio de la ventana. Una fecha ilegible también para el bucle, en vez
 * de dejarlo pidiendo páginas a ciegas.
 *
 * @param {list<{occurredAt: string}>} page Tal cual la devuelve `fetchEvents` (sin descifrar).
 * @param {number} pageSize Límite pedido al servidor.
 * @param {number} windowStartMs Ver {@see monthWindowStartMs}.
 * @returns {boolean}
 */
export function needsAnotherPage(page, pageSize, windowStartMs) {
    if (page.length < pageSize) {
        return false;
    }

    const oldestMs = Date.parse(page[page.length - 1].occurredAt);

    return Number.isNaN(oldestMs) ? false : oldestMs >= windowStartMs;
}

/**
 * ¿Tiene esta ventana (semana o mes) algún método con datos de glucemia?
 *
 * @param {{byMethod: Record<string, object>}} periodSummary Una de las dos ventanas de
 *        `summarizeGlucose`.
 * @returns {boolean}
 */
export function hasGlucoseData(periodSummary) {
    return Object.keys(periodSummary.byMethod).length > 0;
}

/**
 * ¿Hay glucemia en alguna de las dos ventanas?
 *
 * Gobierna la invitación a configurar el rango objetivo (ADR 0007): a quien todavía no ha
 * registrado ninguna glucemia se le pide un ajuste que no tendría sobre qué aplicarse, y el estado
 * sin datos de un usuario nuevo se llena de ruido.
 *
 * @param {{week: {byMethod: object}, month: {byMethod: object}}} glucoseSummary
 * @returns {boolean}
 */
export function hasAnyGlucoseData(glucoseSummary) {
    return hasGlucoseData(glucoseSummary.week) || hasGlucoseData(glucoseSummary.month);
}

/**
 * ¿Hay glucemia registrada, aunque toda esté en otra unidad de presentación?
 *
 * `hasAnyGlucoseData` mira solo lo que entró en el cálculo, así que da falso para quien tiene
 * treinta lecturas en mg/dL y presenta en mmol/L. Para decidir si esa persona ya es usuaria de
 * glucemia (y por tanto si tiene sentido hablarle del rango objetivo) cuentan también las
 * excluidas por unidad.
 *
 * @param {{week: {byMethod: object, excludedByUnit: number}, month: {byMethod: object, excludedByUnit: number}}} glucoseSummary
 * @returns {boolean}
 */
export function hasAnyGlucoseSignal(glucoseSummary) {
    return hasAnyGlucoseData(glucoseSummary)
        || glucoseSummary.week.excludedByUnit > 0
        || glucoseSummary.month.excludedByUnit > 0;
}

/**
 * ¿Tiene esta ventana (semana o mes) algún método con datos de tensión?
 *
 * @param {{byMethod: Record<string, object>}} periodSummary Una de las dos ventanas de
 *        `summarizeBloodPressure`.
 * @returns {boolean}
 */
export function hasBloodPressureData(periodSummary) {
    return Object.keys(periodSummary.byMethod).length > 0;
}

/**
 * Entradas de `byMethod` en un orden estable (alfabético por token), para que la vista no reordene
 * las tarjetas entre una carga y la siguiente.
 *
 * @param {Record<string, object>} byMethod
 * @returns {list<[string, object]>}
 */
export function sortedMethodEntries(byMethod) {
    return Object.entries(byMethod).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Frase sobre los eventos que quedaron fuera por estar en otra unidad de presentación (ADR 0007:
 * no se convierte entre unidades), o `null` si no hubo ninguno.
 *
 * @param {number} excludedByUnit
 * @param {string} unit Unidad de presentación actual.
 * @returns {string|null}
 */
export function describeExcludedByUnit(excludedByUnit, unit) {
    if (excludedByUnit <= 0) {
        return null;
    }

    return t('dashboard.excludedByUnit', { count: excludedByUnit, unit });
}

// --- Construcción de DOM ------------------------------------------------------------------------

/**
 * @param {'warning'|'info'} tone
 * @param {string} message
 * @returns {HTMLDivElement}
 */
function createCallout(tone, message) {
    const callout = document.createElement('div');

    /**
     * Los tres papeles del aviso —relleno, línea y tinta— por su nombre (`error-*` / `info-*`),
     * igual que en `glucosePage.js`. Escrito con la rampa (`bg-danger-50`, `text-primary-600`) el
     * aviso saldría en modo oscuro con fondo casi blanco y tinta clara encima: las rampas de
     * acento no se reasignan por tema, solo estos tokens (ver `theme.css`, § Avisos y chips).
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
 * Un valor con su etiqueta y su unidad, siempre juntos (Do's #2 y #7 de DESIGN.md: un número suelto
 * es un número que se malinterpreta). El valor va en IBM Plex Mono con contraste alto, nunca en gris
 * claro.
 *
 * @param {object} params
 * @param {string} params.label
 * @param {string} params.value Ya formateado (`formatNumber` o la fecha).
 * @param {string} [params.unit]
 * @returns {HTMLDivElement}
 */
/**
 * Tinta de cada lectura clínica de una cifra del panel.
 *
 * Son los papeles semánticos de DESIGN.md, que conmutan solos con el tema oscuro. `neutral` es el
 * caso normal: la mayoría de las cifras (recuento, media, mínimo) no significan nada por sí solas y
 * teñirlas sería decorar, no informar.
 *
 * @type {Record<string, string>}
 */
/** Referencia clínica habitual de tiempo en rango, en porcentaje. */
const TIME_IN_RANGE_TARGET = 70;

const TONE_INK = Object.freeze({
    neutral: 'text-ink',
    good: 'text-success-ink',
    warning: 'text-warning-ink',
});

function createStatTile({ label, value, unit, tone = 'neutral' }) {
    const tile = document.createElement('div');
    /**
     * `bg-background` y `border-border`: papeles de § Colors, que conmutan solos con el tema. Con
     * `bg-gray-50` / `border-gray-200` la baldosa saldría en oscuro como un rectángulo casi blanco
     * con marco del color de la tinta (ver `theme.css`, § Ramp Mapping — Dark).
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
 * Distintivo textual de la ventana (semana/mes), para distinguirlas de un vistazo sin depender solo
 * del color (Do's/Don'ts #3 de DESIGN.md).
 *
 * @param {'week'|'month'} window
 * @returns {HTMLSpanElement}
 */
function createWindowChip(window) {
    const chip = document.createElement('span');
    const isWeek = window === 'week';

    /**
     * DESIGN.md § Chips: 12px bold en mayúsculas, radio 4px, 4px/12px de relleno. Los colores van
     * por su papel (`info-*` el de la semana, los del chip de filtro el del mes) y no por tonos de
     * la rampa, que no conmutan con el tema. El texto del chip ya dice cuántos días son, así que el
     * color no es el único portador del significado (Do's #3).
     */
    chip.className = 'inline-flex items-center rounded-chip border px-3 py-1 text-status-chip '
        + 'uppercase '
        + (isWeek
            ? 'border-info-outline bg-info-surface text-info-ink'
            : 'border-chip-outline bg-chip-surface text-chip-ink');
    chip.textContent = t('dashboard.window.lastDays', { days: isWeek ? WINDOW_DAYS.week : WINDOW_DAYS.month });

    return chip;
}

/**
 * @param {'week'|'month'} window
 * @returns {HTMLHeadingElement}
 */
function createWindowHeading(window) {
    const heading = document.createElement('h3');
    heading.className = 'flex items-center gap-2 font-display text-body-lg font-semibold text-ink';

    const label = document.createElement('span');
    label.textContent = window === 'week' ? t('dashboard.window.week') : t('dashboard.window.month');
    heading.appendChild(label);
    heading.appendChild(createWindowChip(window));

    return heading;
}

/**
 * Tarjeta de una ventana de glucemia: una subtarjeta por método (ADR 0008), o el estado sin datos.
 *
 * @param {'week'|'month'} window
 * @param {{byMethod: Record<string, object>, excludedByUnit: number}} periodSummary
 * @param {string} unit
 * @returns {HTMLDivElement}
 */
/**
 * Estado vacío con salida.
 *
 * Antes era una frase gris y nada más: la primera pantalla que ve alguien recién registrado le decía
 * que no hay datos y ahí se acababa. Ahora lleva un icono, la misma frase y un botón que lleva a
 * crear el primer registro, que es lo único que esa persona puede hacer en ese momento.
 *
 * El destino llega en un `data-*` del contenedor, puesto por Blade: la ruta del panel la decide el
 * servidor y no se duplica aquí.
 *
 * @param {string} message
 * @param {string|null} href
 * @param {string} actionLabel
 * @returns {HTMLElement}
 */
function renderEmptyState(message, href, actionLabel) {
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

/**
 * Destino de una pantalla, leído del contenedor que pinta Blade.
 *
 * Devuelve `null` si no hay documento con `querySelector` —los tests montan un `document` mínimo— o
 * si el atributo falta. En ese caso el estado vacío se pinta igual, solo que sin botón: la frase, que
 * es lo que informa, no depende de encontrar la ruta.
 *
 * @param {string} name
 * @returns {string|null}
 */
function pageUrl(name) {
    if (typeof document?.querySelector !== 'function') {
        return null;
    }

    return document.querySelector('[data-glucose-url]')?.dataset?.[name] ?? null;
}

export function renderGlucosePeriod(window, periodSummary, unit) {
    const section = document.createElement('div');
    section.className = 'space-y-3';
    section.appendChild(createWindowHeading(window));

    /**
     * El aviso de registros excluidos por unidad se pinta también cuando no queda ningún método con
     * datos, que es justo cuando más falta hace: sin él, quien tiene treinta glucemias en mg/dL y
     * cambia su unidad a mmol/L lee «todavía no hay registros» y no tiene ninguna pista de que sus
     * datos existen y solo están en otra unidad.
     */
    if (!hasGlucoseData(periodSummary)) {
        section.appendChild(renderEmptyState(
            t('dashboard.emptyGlucose'),
            pageUrl('glucoseUrl'),
            t('dashboard.addFirstGlucose'),
        ));
    }

    for (const [method, methodSummary] of sortedMethodEntries(periodSummary.byMethod)) {
        section.appendChild(renderGlucoseMethodCard(method, methodSummary, unit));
    }

    const excludedText = describeExcludedByUnit(periodSummary.excludedByUnit, unit);

    if (excludedText !== null) {
        const note = document.createElement('p');
        note.className = 'text-caption text-ink-secondary';
        note.textContent = excludedText;
        section.appendChild(note);
    }

    return section;
}

/**
 * @param {string} method
 * @param {object} methodSummary Una entrada de `byMethod` de `summarizeGlucosePeriod`.
 * @param {string} unit
 * @returns {HTMLDivElement}
 */
function renderGlucoseMethodCard(method, methodSummary, unit) {
    const card = document.createElement('div');
    card.className = 'rounded-card border border-border bg-surface p-pad-md';

    const heading = document.createElement('p');
    heading.className = 'text-body-sm font-semibold text-ink';
    heading.textContent = formatMethodLabel(method);
    card.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3';

    grid.appendChild(createStatTile({ label: t('dashboard.stat.count'), value: String(methodSummary.count) }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.mean'), value: formatNumber(methodSummary.mean), unit }));
    grid.appendChild(createStatTile({
        label: t('dashboard.stat.median'),
        value: formatNumber(methodSummary.median),
        unit,
    }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.min'), value: formatNumber(methodSummary.min), unit }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.max'), value: formatNumber(methodSummary.max), unit }));
    grid.appendChild(createStatTile({
        label: t('dashboard.stat.lastReading'),
        value: formatNumber(methodSummary.last.value),
        unit: `${unit} · ${formatDateTime(methodSummary.last.occurredAt)}`,
    }));

    if (methodSummary.inRangePercent !== undefined) {
        /**
         * El único dato del panel que se puede leer como bueno o mejorable sin interpretar nada: el
         * rango objetivo lo eligió la propia persona en su perfil, así que el umbral no lo pone la
         * aplicación.
         *
         * El 70 % es la referencia clínica habitual para tiempo en rango. Por debajo se marca en
         * ámbar, no en rojo: esto es un resumen personal, no un diagnóstico, y teñir de rojo la
         * glucemia de alguien es un mensaje que esta aplicación no está en posición de dar.
         */
        grid.appendChild(createStatTile({
            label: t('dashboard.stat.timeInRange'),
            value: formatNumber(methodSummary.inRangePercent),
            unit: '%',
            tone: methodSummary.inRangePercent >= TIME_IN_RANGE_TARGET ? 'good' : 'warning',
        }));
    }

    card.appendChild(grid);

    return card;
}

/**
 * Sección completa de glucemia: el aviso del rango (falta, o está en otra unidad) y las dos
 * ventanas.
 *
 * @param {{week: object, month: object}} glucoseSummary
 * @param {string} unit
 * @param {{low: number, high: number, unit: string}|undefined} targetRange
 * @param {boolean} unitMismatch Hay rango guardado, pero en otra unidad (ver
 *        {@see targetRangeUnitMismatch}).
 * @returns {DocumentFragment}
 */
export function renderGlucoseSection(glucoseSummary, unit, targetRange, unitMismatch = false) {
    const fragment = document.createDocumentFragment();

    /**
     * Hay rango, pero en la otra unidad: no se convierte (ADR 0007), así que no hay porcentaje. Se
     * dice, en vez de dejar el hueco mudo o de pedir que se configure algo que ya está configurado.
     */
    if (unitMismatch) {
        const warning = createCallout('warning', t('dashboard.targetRangeUnitMismatch', { unit }));
        warning.classList.add('mb-4');
        fragment.appendChild(warning);
    }

    /**
     * La invitación solo se muestra a quien ya tiene alguna glucemia registrada: a un usuario nuevo
     * le pediría configurar un rango que no tendría todavía sobre qué aplicarse, y su pantalla sin
     * datos empezaría por una tarea pendiente en vez de por lo que hay. Los registros excluidos por
     * unidad cuentan como datos: son glucemias suyas, solo que en otra unidad.
     */
    if (targetRange === undefined && !unitMismatch && hasAnyGlucoseSignal(glucoseSummary)) {
        const invite = createCallout('info', t('dashboard.targetRangeInvite'));
        invite.classList.add('mb-4');
        fragment.appendChild(invite);
    }

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 gap-6 lg:grid-cols-2';
    grid.appendChild(renderGlucosePeriod('week', glucoseSummary.week, unit));
    grid.appendChild(renderGlucosePeriod('month', glucoseSummary.month, unit));
    fragment.appendChild(grid);

    return fragment;
}

/**
 * @param {'week'|'month'} window
 * @param {{byMethod: Record<string, object>}} periodSummary
 * @returns {HTMLDivElement}
 */
function renderBloodPressurePeriod(window, periodSummary) {
    const section = document.createElement('div');
    section.className = 'space-y-3';
    section.appendChild(createWindowHeading(window));

    if (!hasBloodPressureData(periodSummary)) {
        section.appendChild(renderEmptyState(
            t('dashboard.emptyBloodPressure'),
            pageUrl('bloodPressureUrl'),
            t('dashboard.addFirstBloodPressure'),
        ));

        return section;
    }

    for (const [method, methodSummary] of sortedMethodEntries(periodSummary.byMethod)) {
        section.appendChild(renderBloodPressureMethodCard(method, methodSummary));
    }

    return section;
}

/**
 * @param {string} method
 * @param {object} methodSummary Una entrada de `byMethod` de `summarizeBloodPressurePeriod`.
 * @returns {HTMLDivElement}
 */
function renderBloodPressureMethodCard(method, methodSummary) {
    const card = document.createElement('div');
    card.className = 'rounded-card border border-border bg-surface p-pad-md';

    const heading = document.createElement('p');
    heading.className = 'text-body-sm font-semibold text-ink';
    heading.textContent = formatMethodLabel(method);
    card.appendChild(heading);

    /** `mmHg` es el código UCUM y no se traduce; `lpm`/`bpm`/`次/分` sí, porque es una abreviatura. */
    const pulseUnit = t('dashboard.unit.bpm');

    const lastReadingLine = document.createElement('p');
    lastReadingLine.className = 'mt-2 font-mono text-body-lg font-semibold text-ink';
    lastReadingLine.textContent = `${methodSummary.lastReading.systolic}/${methodSummary.lastReading.diastolic}`;

    const lastReadingUnit = document.createElement('span');
    lastReadingUnit.className = 'ml-1 text-body-sm font-normal text-ink-secondary';
    lastReadingUnit.textContent = `mmHg · ${methodSummary.lastReading.pulse} ${pulseUnit} · `
        + `${formatDateTime(methodSummary.lastReading.occurredAt)}`;
    lastReadingLine.appendChild(lastReadingUnit);
    card.appendChild(lastReadingLine);

    const lastCaption = document.createElement('p');
    lastCaption.className = 'text-caption text-ink-secondary';
    lastCaption.textContent = t('dashboard.bp.lastReadingCaption');
    card.insertBefore(lastCaption, lastReadingLine);

    const grid = document.createElement('div');
    grid.className = 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3';

    grid.appendChild(createStatTile({ label: t('dashboard.stat.count'), value: String(methodSummary.count) }));

    for (const [key, magnitudeKey, unit] of [
        ['systolic', 'dashboard.magnitude.systolic', 'mmHg'],
        ['diastolic', 'dashboard.magnitude.diastolic', 'mmHg'],
        ['pulse', 'dashboard.magnitude.pulse', pulseUnit],
    ]) {
        const magnitude = methodSummary[key];
        const label = t(magnitudeKey);

        grid.appendChild(createStatTile({
            label: t('dashboard.stat.withMean', { magnitude: label }),
            value: formatNumber(magnitude.mean),
            unit,
        }));
        grid.appendChild(createStatTile({
            label: t('dashboard.stat.withMedian', { magnitude: label }),
            value: formatNumber(magnitude.median),
            unit,
        }));
        grid.appendChild(createStatTile({
            label: t('dashboard.stat.withRange', { magnitude: label }),
            value: `${formatNumber(magnitude.min)}–${formatNumber(magnitude.max)}`,
            unit,
        }));
    }

    card.appendChild(grid);

    return card;
}

/**
 * @param {{week: object, month: object}} bloodPressureSummary
 * @returns {DocumentFragment}
 */
function renderBloodPressureSection(bloodPressureSummary) {
    const fragment = document.createDocumentFragment();

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 gap-6 lg:grid-cols-2';
    grid.appendChild(renderBloodPressurePeriod('week', bloodPressureSummary.week));
    grid.appendChild(renderBloodPressurePeriod('month', bloodPressureSummary.month));
    fragment.appendChild(grid);

    return fragment;
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

    return t('dashboard.generic');
}

/**
 * Factoría del componente Alpine. Se registra como `phrDashboardPage`.
 *
 * @returns {object}
 */
export function dashboardPage() {
    return {
        init() {
            if (isUnlocked()) {
                void this.loadSummary();

                return;
            }

            this.renderLocked();
            document.addEventListener(SESSION_READY_EVENT, () => void this.loadSummary(), { once: true });
        },

        /** Descarga, descifra y resume glucemia y tensión de las dos ventanas del panel. */
        async loadSummary() {
            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    this.renderLocked();

                    return;
                }

                const referenceInstant = new Date();
                const { rawEvents, truncated } = await this.fetchWindowEvents(referenceInstant);

                let failedToOpen = 0;
                const events = [];

                for (const rawEvent of rawEvents) {
                    try {
                        const content = openEvent({
                            userId,
                            occurredAt: rawEvent.occurredAt,
                            envelope: rawEvent.payload,
                        });

                        events.push(flattenDecryptedEvent(rawEvent, content));
                    } catch {
                        /** Un sobre que no abre no tumba el panel (ADR 0004): se cuenta y se avisa. */
                        failedToOpen += 1;
                    }
                }

                const userSettings = settings();
                const unit = userSettings?.glucoseUnit ?? DEFAULT_UNIT;
                const targetRange = resolveGlucoseTargetRange(userSettings, unit);
                const unitMismatch = targetRangeUnitMismatch(userSettings, unit);

                const glucoseSummary = summarizeGlucose(events, referenceInstant, { unit, targetRange });
                const bloodPressureSummary = summarizeBloodPressure(events, referenceInstant);

                this.renderNotice(failedToOpen, truncated);
                this.$refs.glucose.replaceChildren(renderGlucoseSection(glucoseSummary, unit, targetRange, unitMismatch));
                this.$refs.bloodPressure.replaceChildren(renderBloodPressureSection(bloodPressureSummary));
            } catch (failure) {
                this.renderNoticeError(failure);
            }
        },

        /**
         * Pide páginas de eventos hacia atrás hasta cubrir la ventana del mes (ver
         * {@see needsAnotherPage}). El cursor es la fecha del evento más antiguo de la página, y el
         * servidor la aplica con `<` estricto, así que cada página avanza de verdad.
         *
         * `truncated` avisa de que se agotó el tope de páginas antes de llegar al inicio de la
         * ventana: el resumen sigue siendo el de los registros más recientes, pero no puede
         * presentarse como si fuera el del periodo entero.
         *
         * @param {Date} referenceInstant
         * @returns {Promise<{rawEvents: list<object>, truncated: boolean}>}
         */
        async fetchWindowEvents(referenceInstant) {
            const windowStartMs = monthWindowStartMs(referenceInstant);
            const rawEvents = [];
            let cursor = null;
            let truncated = false;

            for (let page = 0; page < MAX_FETCH_PAGES; page += 1) {
                /** Mismo orden de argumentos que `HealthEventPage::fetchEvents(?string, int)`. */
                const pageEvents = await this.$wire.fetchEvents(cursor, FETCH_PAGE_SIZE);

                rawEvents.push(...pageEvents);

                if (!needsAnotherPage(pageEvents, FETCH_PAGE_SIZE, windowStartMs)) {
                    return { rawEvents, truncated: false };
                }

                cursor = pageEvents[pageEvents.length - 1].occurredAt;
                truncated = true;
            }

            return { rawEvents, truncated };
        },

        /**
         * Sin clave no se puede descifrar nada: se dice en las dos secciones, no se pinta un resumen
         * vacío que se confundiría con «no tienes registros» (ADR 0003: perder la clave es normal).
         */
        renderLocked() {
            this.$refs.notice.replaceChildren();
            this.$refs.glucose.replaceChildren(createCallout('info', t('common.locked.summary')));
            this.$refs.bloodPressure.replaceChildren(createCallout('info', t('common.locked.summary')));
        },

        /**
         * @param {number} failedToOpen
         * @param {boolean} [truncated]
         */
        renderNotice(failedToOpen, truncated = false) {
            const callouts = [];

            if (failedToOpen > 0) {
                callouts.push(createCallout(
                    'warning',
                    t('dashboard.recordsUndecrypted', { count: failedToOpen }),
                ));
            }

            if (truncated) {
                callouts.push(createCallout('warning', t('dashboard.truncated')));
            }

            for (const callout of callouts.slice(0, -1)) {
                callout.classList.add('mb-4');
            }

            this.$refs.notice.replaceChildren(...callouts);
        },

        /** @param {unknown} failure */
        renderNoticeError(failure) {
            this.$refs.notice.replaceChildren(createCallout('warning', describeError(failure)));
        },
    };
}
