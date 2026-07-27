/**
 * Componente Alpine del panel de inicio (ADR 0002, ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * Pinta la línea temporal unificada y las estadísticas **del periodo y de los tipos de evento que
 * elige la persona**. Todo el cálculo lo hace `health/statistics.js` (`summarizeGlucosePeriod`,
 * `summarizeBloodPressurePeriod`, `summarizeMeasurementPeriod`): este módulo no reimplementa ninguna
 * media ni mediana, solo descifra los eventos, se los pasa tal cual espera esa API y da forma al
 * resultado para pintarlo. Igual que `glucosePage.js`, nada de `wire:model` (ADR 0002): el único dato
 * que sube al servidor es la petición de lectura `fetchEvents`, y el descifrado ocurre aquí, en el
 * navegador.
 *
 * **Por qué el periodo se elige y ya no hay dos tarjetas fijas de semana y mes.** El panel resumía
 * siempre las mismas dos ventanas; ahora las mismas estadísticas —recuento, media, mediana, mínimo,
 * máximo, última lectura y tiempo en rango— se calculan sobre el periodo elegido, con el **último
 * día** por defecto. Las dos tarjetas fijas no se han conservado como resumen rápido a propósito:
 * (1) dirían «última semana» y «último mes» junto a una cabecera que dice «último día», que es una
 * contradicción en pantalla y la peor clase de dato, el que parece responder a otra pregunta;
 * (2) obligarían a bajar y descifrar 30 días en cada carga, justo lo que el periodo por defecto
 * evita para que la pantalla de entrada abra rápido; y (3) la semana y el mes siguen a un clic en el
 * mismo desplegable. El control de rango es el compartido con las pantallas de historial
 * (`health/dateRange.js`), no uno propio.
 *
 * **El servidor no puede filtrar por tipo** (ADR 0006): `fetchEvents` trae todos los eventos del
 * usuario del rango pedido y aquí se descifra cada uno. Por eso el filtro por tipo de esta pantalla
 * es **gratis**: los datos ya están descifrados en memoria, así que marcar o desmarcar un tipo
 * repinta sin pedir ni descifrar nada ({@see filterBySelectedTypes}). Un sobre que no abre no tumba
 * el panel: se cuenta y se avisa (ADR 0004).
 *
 * **El rango sí lo aplica el servidor** y por eso viaja a `fetchEvents`: `occurred_at` es una de las
 * tres columnas en claro del ADR 0006. Es la mejora de rendimiento que importa aquí, porque
 * descifrar un año de eventos en el navegador se nota: con «último día» se bajan y se abren los
 * sobres de 24 horas, no los de un mes.
 *
 * **La línea temporal aprovecha justo eso.** Como la petición baja de todos modos todos los tipos
 * del periodo, mezclarlos en una sola lista ordenada por fecha no cuesta ni una petición ni un
 * descifrado de más: son los eventos que cada pantalla por tipo tira. Y es lo único del panel que
 * enseña la relación entre comer, pincharse insulina y lo que hace la glucosa después. Lo que sí
 * cuesta es pintar: hay un tope explícito de entradas ({@see TIMELINE_MAX_ENTRIES}) que la propia
 * sección declara en pantalla cuando recorta.
 *
 * **Por eso se pagina**: como bajan todos los tipos de evento mezclados, una sola página de
 * `fetchEvents` no cubre necesariamente el periodo elegido. Se piden páginas con cursor hasta llegar
 * al inicio del rango ({@see needsAnotherPage}); si aun así no se llega, el panel lo dice en vez de
 * presentar un resumen recortado como si fuera completo.
 *
 * **El método de medición no se mezcla en silencio** (ADR 0008): cada tarjeta de estadística es de
 * un único método, con su etiqueta siempre visible. `formatMethodLabel` traduce el token del evento
 * a una etiqueta legible; es una duplicación deliberada de las etiquetas que ya definen
 * `App\Catalog\GlucoseMeasurementMethod`, `App\Catalog\BloodPressureArm` y
 * `App\Catalog\BloodPressurePosture` (no se pueden tocar esos ficheros desde aquí), así que un
 * token nuevo que no esté en el mapa cae al humanizado genérico en vez de romper el panel.
 *
 * **El rango objetivo de glucemia no trae valor por defecto** (ADR 0007): `resolveGlucoseTargetRange`
 * solo lo pasa a `summarizeGlucosePeriod` cuando los ajustes cifrados traen un rango válido y en
 * la misma unidad de presentación (el rango guarda la suya y no se convierte entre unidades); si no
 * lo hay, `summarizeGlucosePeriod` no calcula `inRangePercent` en absoluto y la vista no dibuja esa
 * estadística en ningún hueco, solo una invitación discreta a configurarlo. Quien escribe `glucoseTargetRange` es
 * la pantalla de perfil (`resources/js/auth/profilePage.js`), así que el nombre del ajuste es un
 * contrato entre esos dos módulos: cambiarlo en uno sin el otro deja la estadística muda.
 */

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { settings } from '../auth/settings.js';
import { EnvelopeError } from '../crypto/envelope.js';
import {
    formatDateTime,
    formatDayHeading,
    formatNumber as formatLocalizedNumber,
    formatTimeOfDay,
    joinList,
    t,
} from '../i18n/index.js';
import { observeThemeChange } from './chartTheme.js';
import { buildDailyBands } from './dailyBands.js';
import { dateRangeControl } from './dateRange.js';
import { openEvent } from './eventEnvelope.js';
import { renderMedianBandChart } from './medianBandChart.js';
import {
    dominantUnit,
    summarizeBloodPressurePeriod,
    summarizeGlucosePeriod,
    summarizeMeasurementPeriod,
} from './statistics.js';

/** Unidad de presentación de glucemia por defecto, igual que en `glucosePage.js` (ADR 0006). */
const DEFAULT_UNIT = 'mg/dL';

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

    return humanizeToken(token);
}

/**
 * Último recurso para un token de catálogo que este módulo no sabe traducir: se capitaliza cada
 * palabra separada por `_`. Nunca devuelve cadena vacía ni inventa una etiqueta clínica; enseña el
 * token tal cual venía en el sobre, que es información verdadera aunque no esté traducida.
 *
 * @param {string} token
 * @returns {string}
 */
function humanizeToken(token) {
    if (typeof token !== 'string') {
        return '';
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
 * función devuelve `undefined` y `summarizeGlucosePeriod` no calculará `inRangePercent` en absoluto (ni
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
 * Tipos de evento que el panel sabe manejar, en el orden en que se ofrecen en el filtro.
 *
 * Los tokens son los que viajan dentro del sobre cifrado (ADR 0006) y son el contrato con los
 * `<input type="checkbox">` que renderiza `resources/views/phr/pages/dashboard.blade.php`: allí se
 * escribe el mismo token en el `x-model`, porque las opciones las pinta el servidor (el morph del
 * DOM borraría cualquier opción escrita por JavaScript).
 *
 * @type {Readonly<list<string>>}
 */
export const EVENT_TYPES = Object.freeze([
    'glucose',
    'bloodPressure',
    'insulin',
    'meal',
    'bodyWeight',
    'temperature',
]);

/**
 * Estado inicial del filtro: **todos los tipos marcados**.
 *
 * Estrenar el panel con algún tipo desmarcado escondería registros que existen sin que nadie lo haya
 * pedido, y en un historial clínico «no aparece» se lee como «se ha perdido». Quien quiera mirar un
 * solo tipo lo desmarca; nadie tiene que descubrir por qué le falta algo.
 *
 * @returns {Record<string, boolean>}
 */
export function defaultSelectedTypes() {
    return Object.fromEntries(EVENT_TYPES.map((type) => [type, true]));
}

/**
 * Tipos marcados ahora mismo, en el orden de {@see EVENT_TYPES}.
 *
 * @param {Record<string, boolean>} selectedTypes
 * @returns {list<string>}
 */
export function selectedTypeTokens(selectedTypes) {
    return EVENT_TYPES.filter((type) => selectedTypes?.[type] === true);
}

/**
 * Deja solo los eventos de los tipos marcados.
 *
 * No cuesta ninguna petición ni ningún descifrado: los eventos llegan aquí ya abiertos, porque el
 * servidor no puede filtrar por tipo (ADR 0006) y baja de todos modos todos los del rango. Por eso
 * el filtro se aplica al pintar y no al pedir.
 *
 * @param {list<{type?: string}>} events
 * @param {Record<string, boolean>} selectedTypes
 * @returns {list<object>}
 */
export function filterBySelectedTypes(events, selectedTypes) {
    return events.filter((event) => selectedTypes?.[event?.type] === true);
}

/**
 * Instante en que empieza el rango pedido, en milisegundos desde epoch, o `-Infinity` cuando el
 * rango está abierto por abajo («todos los registros»).
 *
 * Es el punto hasta el que hay que retroceder pidiendo páginas: el servidor ya acota la consulta,
 * así que esto solo decide cuándo dejar de paginar ({@see needsAnotherPage}).
 *
 * @param {{from: string|null}} range
 * @returns {number}
 */
export function rangeStartMs(range) {
    if (range?.from === null || range?.from === undefined) {
        return -Infinity;
    }

    const startMs = Date.parse(range.from);

    return Number.isNaN(startMs) ? -Infinity : startMs;
}

/**
 * ¿Hace falta pedir otra página de eventos?
 *
 * `fetchEvents` devuelve **todos** los tipos de evento del usuario (el servidor no puede filtrar
 * por tipo, ADR 0006) ordenados de más reciente a más antiguo y con un límite. Con una sola página
 * de 100 —el valor por defecto del servidor— quien registra glucemia, tensión, comidas e insulina
 * varias veces al día no llega ni a diez días atrás, y el resumen de un periodo largo saldría
 * recortado sin decirlo: justo el "cero que parece una medición real" que hay que evitar. Así que se
 * pagina con cursor hasta cubrir el rango elegido.
 *
 * Se para cuando la página viene incompleta (ya no hay más eventos) o cuando el más antiguo de la
 * página ya cae antes del inicio del rango. Una fecha ilegible también para el bucle, en vez de
 * dejarlo pidiendo páginas a ciegas.
 *
 * @param {list<{occurredAt: string}>} page Tal cual la devuelve `fetchEvents` (sin descifrar).
 * @param {number} pageSize Límite pedido al servidor.
 * @param {number} windowStartMs Ver {@see rangeStartMs}.
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
 * ¿Tiene el resumen del periodo algún grupo con datos?
 *
 * Sirve igual para glucemia y tensión (`byMethod`, ADR 0008) que para peso, temperatura e insulina
 * (`byGroup`), porque la pregunta es la misma: ¿hay algo que pintar o toca el estado vacío?
 *
 * @param {{byMethod?: Record<string, object>, byGroup?: Record<string, object>}} periodSummary
 * @returns {boolean}
 */
export function hasPeriodData(periodSummary) {
    return Object.keys(periodSummary?.byMethod ?? periodSummary?.byGroup ?? {}).length > 0;
}

/**
 * ¿Hay glucemia registrada en el periodo, aunque toda esté en otra unidad de presentación?
 *
 * `hasPeriodData` mira solo lo que entró en el cálculo, así que da falso para quien tiene treinta
 * lecturas en mg/dL y presenta en mmol/L. Para decidir si esa persona ya es usuaria de glucemia (y
 * por tanto si tiene sentido hablarle del rango objetivo, ADR 0007) cuentan también las excluidas
 * por unidad.
 *
 * @param {{byMethod: object, excludedByUnit: number}} glucoseSummary
 * @returns {boolean}
 */
export function hasAnyGlucoseSignal(glucoseSummary) {
    return hasPeriodData(glucoseSummary) || glucoseSummary.excludedByUnit > 0;
}

/**
 * Entradas de `byMethod` (o de `byGroup`: es la misma forma) en un orden estable —alfabético por
 * token—, para que la vista no reordene las tarjetas entre una carga y la siguiente.
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

// --- Línea temporal unificada --------------------------------------------------------------------

/**
 * Tope de entradas que se pintan en la línea temporal.
 *
 * **El descifrado no lo motiva**: los eventos ya vienen descifrados de `loadSummary`, que los
 * necesita igualmente para las estadísticas; la línea temporal no descifra ni pide nada de más (es
 * justo lo que hoy tiran las pantallas por tipo). Lo que sí cuesta es el DOM: un mes de registro
 * intensivo puede pasar del millar de filas, y pintarlas todas deja el panel de inicio pesado en un
 * móvil.
 *
 * Se recorta por lo más reciente, **nunca en silencio**: cuando algo queda fuera, la sección lo dice
 * con el recuento exacto ({@see renderTimelineSection}). Un resumen recortado que se presenta como
 * completo es el mismo fallo que evita el aviso de páginas truncadas.
 */
export const TIMELINE_MAX_ENTRIES = 100;

/**
 * Alimentos que se nombran en la línea de una comida antes de resumir el resto con `+N`.
 *
 * Una comida de doce ingredientes ocuparía cinco líneas y rompería el «se lee de un vistazo» que
 * persigue esta pantalla; los nombres completos siguen estando en la pantalla de comidas.
 */
const TIMELINE_MAX_FOODS = 3;

/** Claves de tipo de insulina (`App\Catalog\InsulinType`). */
const INSULIN_TYPE_KEYS = Object.freeze({
    rapid: 'dashboard.timeline.insulinType.rapid',
    long: 'dashboard.timeline.insulinType.long',
    mixed: 'dashboard.timeline.insulinType.mixed',
});

/** Claves de tipo de comida (`App\Catalog\MealType`). */
const MEAL_TYPE_KEYS = Object.freeze({
    breakfast: 'dashboard.timeline.mealType.breakfast',
    lunch: 'dashboard.timeline.mealType.lunch',
    dinner: 'dashboard.timeline.mealType.dinner',
    snack: 'dashboard.timeline.mealType.snack',
});

/** Claves de sitio de medición de temperatura (`App\Catalog\TemperatureMeasurementSite`). */
const TEMPERATURE_SITE_KEYS = Object.freeze({
    axillary: 'dashboard.timeline.site.axillary',
    oral: 'dashboard.timeline.site.oral',
    tympanic: 'dashboard.timeline.site.tympanic',
    temporal: 'dashboard.timeline.site.temporal',
    rectal: 'dashboard.timeline.site.rectal',
});

/**
 * Etiqueta de un token de catálogo, con el humanizado genérico como respaldo.
 *
 * Igual que con los métodos de medición, estas etiquetas están duplicadas a conciencia: el panel de
 * inicio no recibe ningún catálogo del servidor (a diferencia de las pantallas por tipo, que sí lo
 * reciben en su Blade), así que traduce los tokens por su cuenta. Un token nuevo no rompe nada: sale
 * humanizado.
 *
 * @param {Record<string, string>} keys
 * @param {unknown} token
 * @returns {string}
 */
function catalogLabel(keys, token) {
    if (typeof token !== 'string' || token === '') {
        return '';
    }

    return keys[token] !== undefined ? t(keys[token]) : humanizeToken(token);
}

/**
 * Da forma localizada a un valor clínico en reposo (ADR 0004: siempre cadena, con el punto como
 * separador decimal).
 *
 * Si la cadena no representa un número finito se devuelve **tal cual**, sin tocarla: es el dato que
 * la persona guardó, y sustituirlo por un guion o por `NaN` sería esconder o inventar. Solo lo que
 * es número de verdad pasa por `formatNumber`, que aplica el separador decimal del idioma.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function formatMeasuredValue(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
        return '';
    }

    const value = Number(raw);

    return Number.isFinite(value) ? formatNumber(value) : raw;
}

/**
 * Resumen de una línea de cada tipo de evento.
 *
 * Cada entrada devuelve `{summary, detail}`: `summary` es el dato (la cifra con su unidad) y
 * `detail` el contexto que evita leerlo mal —el método de medición, el sitio, el tipo de insulina—,
 * que la vista pinta en tinta secundaria. `detail` puede ser `null`: todos esos campos son
 * opcionales en el sobre (ADR 0006) y aquí no se inventa ninguno.
 *
 * Las unidades salen del propio evento y son códigos UCUM (ADR 0005): no se traducen ni se
 * convierten (ADR 0007), igual que en las pantallas por tipo.
 *
 * @type {Record<string, (data: object) => {summary: string, detail: string|null}>}
 */
const TIMELINE_SUMMARIES = Object.freeze({
    glucose: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.value),
            unit: data.unit ?? '',
        }),
        detail: typeof data.method === 'string' && data.method !== '' ? formatMethodLabel(data.method) : null,
    }),

    bloodPressure: (data) => {
        const reading = t('dashboard.timeline.bloodPressureReading', {
            systolic: formatMeasuredValue(data.systolic),
            diastolic: formatMeasuredValue(data.diastolic),
            unit: data.unit ?? '',
        });

        /** El pulso es opcional (ADR 0006): sin él la línea no deja ningún hueco ni escribe un cero. */
        const pulse = typeof data.pulse === 'string' && data.pulse !== ''
            ? t('dashboard.timeline.pulse', {
                pulse: formatMeasuredValue(data.pulse),
                unit: t('dashboard.unit.bpm'),
            })
            : null;

        return {
            summary: pulse === null ? reading : `${reading} · ${pulse}`,
            detail: typeof data.arm === 'string' && typeof data.posture === 'string'
                ? formatMethodLabel(`${data.arm}_${data.posture}`)
                : null,
        };
    },

    insulin: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.dose),
            unit: data.unit ?? '',
        }),
        detail: catalogLabel(INSULIN_TYPE_KEYS, data.insulinType) || null,
    }),

    /**
     * En una comida el dato clínico no es una cifra sino qué se comió: el tipo de comida es el
     * resumen y los alimentos, el detalle. Es justo el dato que permite leer la línea temporal como
     * lo que persigue esta pantalla: comer, pincharse y lo que hace la glucosa después.
     */
    meal: (data) => {
        const foods = Array.isArray(data.foods) ? data.foods : [];
        const names = foods
            .map((food) => (typeof food?.name === 'string' ? food.name.trim() : ''))
            .filter((name) => name !== '');
        const shown = names.slice(0, TIMELINE_MAX_FOODS);
        const hidden = names.length - shown.length;

        if (hidden > 0) {
            shown.push(t('dashboard.timeline.moreFoods', { count: hidden }));
        }

        return {
            summary: catalogLabel(MEAL_TYPE_KEYS, data.mealType),
            detail: names.length === 0 ? t('dashboard.timeline.noFoods') : joinList(shown),
        };
    },

    bodyWeight: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.value),
            unit: data.unit ?? '',
        }),
        detail: null,
    }),

    temperature: (data) => ({
        summary: t('dashboard.timeline.measurement', {
            value: formatMeasuredValue(data.value),
            unit: data.unit ?? '',
        }),
        detail: catalogLabel(TEMPERATURE_SITE_KEYS, data.site) || null,
    }),
});

/**
 * Trazo del icono de cada tipo, en el estilo de línea de los demás iconos del panel (24×24, sin
 * relleno, `stroke-width` 1.5).
 *
 * **Por qué icono y no color propio.** Seis tipos exigirían seis colores, y DESIGN.md solo define
 * cuatro colores de serie —los dos últimos con significado de estado (Success, Warning) y el rojo
 * reservado a errores (Don'ts #4)—; inventar dos más sería exactamente la «paleta privada» que la
 * sección § Charts prohíbe. Además el color nunca puede ser el único portador del significado
 * (Do's #3), así que un color propio por tipo obligaría igualmente a poner la etiqueta al lado. Con
 * la silueta del icono más el nombre del tipo escrito, la distinción se sostiene también en escala
 * de grises y con el tema oscuro.
 *
 * @type {Record<string, string>}
 */
const TIMELINE_ICONS = Object.freeze({
    glucose: 'M12 3.75s5.25 5.25 5.25 9a5.25 5.25 0 0 1-10.5 0c0-3.75 5.25-9 5.25-9Z',
    bloodPressure: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733'
        + '-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z',
    insulin: 'm15.75 3.75 4.5 4.5M18.75 6.75 6.75 18.75l-3.75 1.5 1.5-3.75L16.5 4.5M9.75 12l1.5 1.5M12 9.75l1.5 1.5',
    meal: 'M6 3v6a2.25 2.25 0 0 0 2.25 2.25M6 3v18M9.75 3v6M8.25 11.25V21M17.25 3c-1.125 1.5-1.5 3-1.5 5.25 '
        + '0 1.5.75 2.25 1.5 2.25V21',
    bodyWeight: 'M4.5 6.75h15v12.75h-15V6.75Zm7.5 2.25-2.25 4.5h4.5L12 9Z',
    temperature: 'M12 3.75a2.25 2.25 0 0 1 2.25 2.25v7.06a4.5 4.5 0 1 1-4.5 0V6A2.25 2.25 0 0 1 12 3.75Z',
});

/**
 * Resume un evento ya descifrado en una entrada de la línea temporal.
 *
 * Devuelve `null` para un tipo que este módulo no sabe describir —un tipo futuro, o un sobre cuyo
 * contenido no tiene la forma esperada—. Quien llame cuenta esos casos y los declara en pantalla
 * ({@see buildTimeline}): un evento que existe y no se enseña tiene que decirse, porque una línea
 * temporal incompleta que se presenta como completa hace leer mal lo que sí aparece.
 *
 * @param {{type?: string, occurredAt: string, data?: object}} event Aplanado con
 *        {@see flattenDecryptedEvent}.
 * @returns {{type: string, typeLabel: string, summary: string, detail: string|null, occurredAt: string}|null}
 */
export function describeTimelineEvent(event) {
    const describe = TIMELINE_SUMMARIES[event?.type];

    if (describe === undefined) {
        return null;
    }

    const { summary, detail } = describe(event.data ?? {});

    return {
        type: event.type,
        /**
         * Clave compuesta con el token del tipo. Solo se alcanza para los tipos que están en
         * `TIMELINE_SUMMARIES` (los demás han salido ya por `null`), así que la lista de claves
         * `dashboard.timeline.type.*` que tienen que existir en los tres catálogos es exactamente la
         * de ese objeto.
         */
        typeLabel: t(`dashboard.timeline.type.${event.type}`),
        summary,
        detail,
        occurredAt: event.occurredAt,
    };
}

/**
 * Clave de agrupación por día **en la zona del dispositivo**, no en UTC.
 *
 * Agrupar por la fecha UTC partiría en dos días una cena de las 23:30 en Madrid en verano, que es
 * justo la entrada que hay que ver junto a la glucemia de después. La fecha se compone a mano en vez
 * de recortar el ISO por eso mismo.
 *
 * @param {string} occurredAt
 * @returns {string} `YYYY-MM-DD` local.
 */
export function localDayKey(occurredAt) {
    const date = new Date(occurredAt);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Entradas de la línea temporal: los tipos marcados, mezclados y del más reciente al más antiguo.
 *
 * Ya no filtra por ventana: el periodo lo aplica el servidor al pedir los eventos (`[from, to)` de
 * `fetchEvents`) y el tipo lo aplica quien llama ({@see filterBySelectedTypes}), así que aquí llega
 * exactamente lo que hay que pintar.
 *
 * `hidden` son las entradas que quedaron fuera por el tope de {@see TIMELINE_MAX_ENTRIES} y
 * `unsupported` las de un tipo que este módulo no sabe describir. Los dos recuentos salen a pantalla:
 * ninguna de las dos exclusiones es silenciosa.
 *
 * @param {list<object>} events Eventos descifrados, aplanados y ya filtrados por periodo y por tipo.
 * @returns {{entries: list<object>, hidden: number, unsupported: number}}
 */
export function buildTimeline(events) {
    const entries = [];
    let unsupported = 0;

    for (const event of events) {
        const entry = describeTimelineEvent(event);

        if (entry === null) {
            unsupported += 1;

            continue;
        }

        entries.push(entry);
    }

    entries.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

    return {
        entries: entries.slice(0, TIMELINE_MAX_ENTRIES),
        hidden: Math.max(entries.length - TIMELINE_MAX_ENTRIES, 0),
        unsupported,
    };
}

/**
 * Agrupa entradas ya ordenadas en días, conservando el orden de llegada.
 *
 * @param {list<{occurredAt: string}>} entries Ordenadas de más reciente a más antigua.
 * @returns {list<{dayKey: string, occurredAt: string, entries: list<object>}>}
 */
export function groupEntriesByDay(entries) {
    /** @type {list<{dayKey: string, occurredAt: string, entries: list<object>}>} */
    const days = [];

    for (const entry of entries) {
        const dayKey = localDayKey(entry.occurredAt);
        const current = days[days.length - 1];

        if (current !== undefined && current.dayKey === dayKey) {
            current.entries.push(entry);

            continue;
        }

        days.push({ dayKey, occurredAt: entry.occurredAt, entries: [entry] });
    }

    return days;
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

/**
 * Nota al pie con los registros que quedaron fuera por estar en otra unidad, o `null` si no hubo
 * ninguno.
 *
 * Vive aparte porque acompaña tanto a una ventana concreta como al estado vacío único de la tarjeta:
 * es el aviso que impide que quien tiene treinta glucemias en mg/dL y ha cambiado su unidad a mmol/L
 * lea «todavía no hay registros» y crea que ha perdido sus datos.
 *
 * @param {number} excludedByUnit
 * @param {string} unit
 * @returns {HTMLParagraphElement|null}
 */
function createExcludedNote(excludedByUnit, unit) {
    const excludedText = describeExcludedByUnit(excludedByUnit, unit);

    if (excludedText === null) {
        return null;
    }

    const note = document.createElement('p');
    note.className = 'text-caption text-ink-secondary';
    note.textContent = excludedText;

    return note;
}

/**
 * Nombre del `data-*` con la ruta de la pantalla de cada tipo, para el botón del estado vacío. Los
 * pinta Blade en el contenedor (ver {@see pageUrl}); un tipo sin ruta pinta el estado vacío sin
 * botón, que sigue informando.
 *
 * @type {Record<string, string>}
 */
const TYPE_URL_KEYS = Object.freeze({
    glucose: 'glucoseUrl',
    bloodPressure: 'bloodPressureUrl',
    insulin: 'insulinUrl',
    meal: 'mealsUrl',
    bodyWeight: 'bodyWeightUrl',
    temperature: 'temperatureUrl',
});

/**
 * Estado vacío de una sección de estadísticas.
 *
 * La frase no nombra el tipo porque la cabecera de la tarjeta ya lo dice: repetirlo dentro daría
 * «Glucemia — todavía no hay registros de glucemia», y una pantalla con seis tipos se llenaría de
 * ruido. Lo que sí dice es «en este periodo», que es la información que evita leer un hueco como
 * «se ha perdido».
 *
 * @param {string} type
 * @returns {HTMLElement}
 */
function renderTypeEmptyState(type) {
    return renderEmptyState(t('dashboard.empty'), pageUrl(TYPE_URL_KEYS[type] ?? ''), t('dashboard.addFirst'));
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
 * Sección completa de glucemia del periodo elegido: el aviso del rango objetivo (falta, o está en
 * otra unidad) y una subtarjeta por método de medición (ADR 0008).
 *
 * @param {{byMethod: object, excludedByUnit: number}} glucoseSummary Resumen del periodo.
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

    /**
     * Sin ningún método con datos, un único estado vacío a lo ancho de la tarjeta. El aviso de
     * excluidos por unidad no se pierde: se pinta debajo, que es justo cuando más falta hace, porque
     * es lo único que le dice a quien tiene glucemias en mg/dL y presenta en mmol/L que sus datos
     * siguen ahí.
     */
    if (!hasPeriodData(glucoseSummary)) {
        fragment.appendChild(renderTypeEmptyState('glucose'));

        const note = createExcludedNote(glucoseSummary.excludedByUnit, unit);

        if (note !== null) {
            note.classList.add('mt-3', 'text-center');
            fragment.appendChild(note);
        }

        return fragment;
    }

    const methods = document.createElement('div');
    methods.className = 'space-y-3';

    for (const [method, methodSummary] of sortedMethodEntries(glucoseSummary.byMethod)) {
        methods.appendChild(renderGlucoseMethodCard(method, methodSummary, unit));
    }

    const note = createExcludedNote(glucoseSummary.excludedByUnit, unit);

    if (note !== null) {
        methods.appendChild(note);
    }

    fragment.appendChild(methods);

    return fragment;
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
 * Sección de tensión arterial del periodo elegido: una subtarjeta por método (brazo y postura,
 * ADR 0008), o el estado vacío.
 *
 * @param {{byMethod: object}} bloodPressureSummary Resumen del periodo.
 * @returns {DocumentFragment}
 */
export function renderBloodPressureSection(bloodPressureSummary) {
    const fragment = document.createDocumentFragment();

    if (!hasPeriodData(bloodPressureSummary)) {
        fragment.appendChild(renderTypeEmptyState('bloodPressure'));

        return fragment;
    }

    const methods = document.createElement('div');
    methods.className = 'space-y-3';

    for (const [method, methodSummary] of sortedMethodEntries(bloodPressureSummary.byMethod)) {
        methods.appendChild(renderBloodPressureMethodCard(method, methodSummary));
    }

    fragment.appendChild(methods);

    return fragment;
}

/**
 * Tipos de una sola magnitud numérica que el panel resume con el mismo cálculo genérico
 * (`summarizeMeasurementPeriod`): qué campo lleva el valor, qué campo agrupa y con qué claves de
 * catálogo se traduce ese grupo.
 *
 * **Las comidas no están, y no es un olvido**: una comida no tiene magnitud que promediar (su dato
 * es qué se comió), así que una tarjeta de «media de comidas» sería un número inventado. Siguen
 * apareciendo en la línea temporal y en el filtro de tipos, que es donde significan algo.
 *
 * @type {Readonly<list<{type: string, valueKey?: string, groupBy?: string, groupKeys?: object}>>}
 */
export const MEASUREMENT_SECTIONS = Object.freeze([
    { type: 'insulin', valueKey: 'dose', groupBy: 'insulinType', groupKeys: INSULIN_TYPE_KEYS },
    /** El peso se mide de una sola forma: sin campo de agrupación, una única tarjeta sin cabecera. */
    { type: 'bodyWeight' },
    { type: 'temperature', groupBy: 'site', groupKeys: TEMPERATURE_SITE_KEYS },
]);

/**
 * Tarjeta de un grupo de una magnitud simple: las mismas estadísticas que la glucemia menos el
 * tiempo en rango, que solo existe donde hay un rango objetivo configurado (ADR 0007).
 *
 * @param {string|null} groupLabel Etiqueta del grupo, o `null` si el tipo no agrupa.
 * @param {object} groupSummary Una entrada de `byGroup` de `summarizeMeasurementPeriod`.
 * @param {string} unit
 * @returns {HTMLDivElement}
 */
function renderMeasurementCard(groupLabel, groupSummary, unit) {
    const card = document.createElement('div');
    card.className = 'rounded-card border border-border bg-surface p-pad-md';

    if (groupLabel !== null && groupLabel !== '') {
        const heading = document.createElement('p');
        heading.className = 'text-body-sm font-semibold text-ink';
        heading.textContent = groupLabel;
        card.appendChild(heading);
    }

    const grid = document.createElement('div');
    grid.className = 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3';

    grid.appendChild(createStatTile({ label: t('dashboard.stat.count'), value: String(groupSummary.count) }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.mean'), value: formatNumber(groupSummary.mean), unit }));
    grid.appendChild(createStatTile({
        label: t('dashboard.stat.median'),
        value: formatNumber(groupSummary.median),
        unit,
    }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.min'), value: formatNumber(groupSummary.min), unit }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.max'), value: formatNumber(groupSummary.max), unit }));
    grid.appendChild(createStatTile({
        label: t('dashboard.stat.lastReading'),
        value: formatNumber(groupSummary.last.value),
        unit: `${unit} · ${formatDateTime(groupSummary.last.occurredAt)}`,
    }));

    card.appendChild(grid);

    return card;
}

/**
 * Sección de un tipo de magnitud simple (insulina, peso, temperatura) para el periodo elegido.
 *
 * La unidad no la elige la persona en ningún ajuste para estos tres (a diferencia de la glucemia,
 * ADR 0007), así que se resume con la del registro más reciente y las demás se cuentan aparte
 * ({@see dominantUnit}); el aviso de excluidos por unidad es el mismo que ya usaba la glucemia.
 *
 * @param {{type: string, valueKey?: string, groupBy?: string, groupKeys?: object}} section
 * @param {list<object>} events Eventos del periodo, ya descifrados.
 * @returns {DocumentFragment}
 */
export function renderMeasurementSection(section, events) {
    const fragment = document.createDocumentFragment();
    const valueKey = section.valueKey ?? 'value';
    const unit = dominantUnit(events, section.type, valueKey);

    if (unit === null) {
        fragment.appendChild(renderTypeEmptyState(section.type));

        return fragment;
    }

    const summary = summarizeMeasurementPeriod(events, {
        type: section.type,
        valueKey,
        groupBy: section.groupBy,
        unit,
    });

    if (!hasPeriodData(summary)) {
        fragment.appendChild(renderTypeEmptyState(section.type));

        return fragment;
    }

    const groups = document.createElement('div');
    groups.className = 'space-y-3';

    for (const [group, groupSummary] of sortedMethodEntries(summary.byGroup)) {
        const label = section.groupKeys === undefined ? null : catalogLabel(section.groupKeys, group);

        groups.appendChild(renderMeasurementCard(label, groupSummary, unit));
    }

    const note = createExcludedNote(summary.excludedByUnit, unit);

    if (note !== null) {
        groups.appendChild(note);
    }

    fragment.appendChild(groups);

    return fragment;
}

/**
 * Todas las secciones de estadísticas del periodo, una tarjeta por tipo marcado.
 *
 * Solo se pinta lo que la persona ha marcado: si desmarca la tensión, su tarjeta no está, en vez de
 * quedarse ahí diciendo que no hay datos. Con **ningún** tipo marcado se dice, porque una pantalla
 * vacía sin explicación se lee como «no tengo registros» y no es eso lo que ha pasado.
 *
 * @param {list<object>} events Eventos del periodo, descifrados y **sin** filtrar por tipo: cada
 *        sección se queda con los suyos.
 * @param {object} params
 * @param {Record<string, boolean>} params.selectedTypes
 * @param {string} params.unit Unidad de presentación de glucemia (ADR 0007).
 * @param {{low: number, high: number, unit: string}|undefined} params.targetRange
 * @param {boolean} params.unitMismatch
 * @returns {DocumentFragment}
 */
export function renderStatsSections(events, { selectedTypes, unit, targetRange, unitMismatch }) {
    const fragment = document.createDocumentFragment();

    if (selectedTypeTokens(selectedTypes).length === 0) {
        fragment.appendChild(createCallout('info', t('dashboard.typeFilter.none')));

        return fragment;
    }

    /** @type {list<[string, DocumentFragment]>} */
    const sections = [];

    if (selectedTypes.glucose === true) {
        const summary = summarizeGlucosePeriod(events, { unit, targetRange });

        sections.push(['glucose', renderGlucoseSection(summary, unit, targetRange, unitMismatch)]);
    }

    if (selectedTypes.bloodPressure === true) {
        sections.push(['bloodPressure', renderBloodPressureSection(summarizeBloodPressurePeriod(events))]);
    }

    for (const section of MEASUREMENT_SECTIONS) {
        if (selectedTypes[section.type] === true) {
            sections.push([section.type, renderMeasurementSection(section, events)]);
        }
    }

    for (const [type, body] of sections) {
        fragment.appendChild(createStatsCard(type, body));
    }

    return fragment;
}

/**
 * Tarjeta de un tipo: la misma superficie que las secciones de la plantilla (DESIGN.md § Cards, con
 * papeles del tema y no tonos de la rampa) y el nombre del tipo como cabecera.
 *
 * La cabecera la escribe este módulo y no Blade porque qué tarjetas existen depende del filtro, y
 * una cabecera del servidor se quedaría en pantalla sobre una tarjeta que ya no está.
 *
 * @param {string} type
 * @param {DocumentFragment} body
 * @returns {HTMLElement}
 */
function createStatsCard(type, body) {
    const card = document.createElement('section');
    card.className = 'rounded-card border border-border bg-surface p-card shadow-sm';

    const heading = document.createElement('h3');
    heading.className = 'font-display text-subhead text-ink';
    heading.textContent = t(`dashboard.timeline.type.${type}`);
    card.appendChild(heading);

    const content = document.createElement('div');
    content.className = 'mt-4';
    content.appendChild(body);
    card.appendChild(content);

    return card;
}

/**
 * Icono del tipo de una entrada de la línea temporal. Es decorativo (`aria-hidden`): el tipo va
 * escrito al lado, y el lector de pantalla ya lo lee ahí.
 *
 * @param {string} type
 * @returns {SVGSVGElement}
 */
function createTimelineIcon(type) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.5');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('class', 'mt-0.5 size-5 shrink-0 text-ink-secondary');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', TIMELINE_ICONS[type] ?? '');
    icon.appendChild(path);

    return icon;
}

/**
 * Una entrada: hora, icono del tipo, y el dato en una línea.
 *
 * La hora va en IBM Plex Mono y con ancho fijo para que la columna quede alineada entre entradas:
 * un día con seis registros se recorre con la vista por esa columna.
 *
 * @param {{type: string, typeLabel: string, summary: string, detail: string|null, occurredAt: string}} entry
 * @returns {HTMLLIElement}
 */
function createTimelineEntry(entry) {
    const row = document.createElement('li');
    /** El mismo separador entre filas que el historial de las pantallas por tipo (`insulinPage.js`). */
    row.className = 'flex min-h-11 items-start gap-3 border-b border-border py-2 last:border-b-0';

    const time = document.createElement('span');
    time.className = 'w-14 shrink-0 pt-0.5 font-mono text-body-sm text-ink-secondary';
    time.textContent = formatTimeOfDay(entry.occurredAt);
    row.appendChild(time);

    row.appendChild(createTimelineIcon(entry.type));

    const line = document.createElement('p');
    line.className = 'text-body-sm text-ink';

    const typeLabel = document.createElement('span');
    typeLabel.className = 'font-semibold';
    typeLabel.textContent = entry.typeLabel;
    line.appendChild(typeLabel);

    /** El dato en el mismo renglón que el tipo: «Glucemia 112 mg/dL» se lee de una pasada. */
    if (entry.summary !== '') {
        const summary = document.createElement('span');
        summary.className = 'ml-2 font-mono';
        summary.textContent = entry.summary;
        line.appendChild(summary);
    }

    /**
     * El contexto (método, sitio, tipo de insulina, alimentos) en tinta secundaria: acompaña al dato
     * sin competir con él, pero está siempre, porque un número sin su método se lee mal (ADR 0008).
     */
    if (entry.detail !== null && entry.detail !== '') {
        const detail = document.createElement('span');
        detail.className = 'ml-2 text-ink-secondary';
        detail.textContent = `· ${entry.detail}`;
        line.appendChild(detail);
    }

    row.appendChild(line);

    return row;
}

/**
 * Un día de la línea temporal: la fecha como encabezado y sus entradas debajo.
 *
 * @param {{occurredAt: string, entries: list<object>}} day
 * @returns {HTMLDivElement}
 */
function createTimelineDay(day) {
    const section = document.createElement('div');
    section.className = 'border-t border-border pt-3 first:border-t-0 first:pt-0';

    const heading = document.createElement('h3');
    heading.className = 'font-display text-body-sm font-semibold text-ink';
    heading.textContent = formatDayHeading(day.occurredAt);
    section.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'mt-1';

    for (const entry of day.entries) {
        list.appendChild(createTimelineEntry(entry));
    }

    section.appendChild(list);

    return section;
}

/**
 * Sección de la línea temporal: los tipos marcados, del periodo elegido, mezclados y ordenados por
 * fecha descendente, agrupados por día.
 *
 * **Por qué esta pantalla existe**: es donde se ve la relación entre comer, pincharse insulina y lo
 * que hace la glucosa después. Ninguna pantalla por tipo puede enseñar eso, y el dato no cuesta nada
 * de más: `fetchEvents` ya devuelve todos los tipos juntos (el servidor no puede filtrar por tipo,
 * ADR 0006) y `loadSummary` ya los ha descifrado para las estadísticas.
 *
 * Las dos exclusiones posibles —el tope de entradas y los tipos que no se saben describir— se
 * declaran arriba con su recuento exacto, nunca en silencio.
 *
 * @param {list<object>} events Eventos descifrados y aplanados, ya filtrados por periodo y por tipo.
 * @returns {DocumentFragment}
 */
export function renderTimelineSection(events) {
    const fragment = document.createDocumentFragment();
    const { entries, hidden, unsupported } = buildTimeline(events);

    if (unsupported > 0) {
        const notice = createCallout('info', t('dashboard.timeline.unsupported', { count: unsupported }));
        notice.classList.add('mb-4');
        fragment.appendChild(notice);
    }

    if (entries.length === 0) {
        fragment.appendChild(renderEmptyState(
            t('dashboard.empty'),
            pageUrl('glucoseUrl'),
            t('dashboard.addFirst'),
        ));

        return fragment;
    }

    if (hidden > 0) {
        const notice = createCallout('info', t('dashboard.timeline.capped', {
            count: hidden,
            shown: entries.length,
        }));
        notice.classList.add('mb-4');
        fragment.appendChild(notice);
    }

    const days = document.createElement('div');
    days.className = 'space-y-4';

    for (const day of groupEntriesByDay(entries)) {
        days.appendChild(createTimelineDay(day));
    }

    fragment.appendChild(days);

    return fragment;
}

// --- Gráficas del periodo -----------------------------------------------------------------------

/**
 * Qué se dibuja de cada tipo: el campo (o los campos) con la magnitud, el que dice cómo se midió y
 * con qué claves se traduce ese grupo. Es la misma tabla que gobierna las tarjetas de estadísticas
 * ({@see MEASUREMENT_SECTIONS}), ampliada con glucemia y tensión, para que la gráfica y la tarjeta
 * del mismo tipo no puedan estar agrupando de formas distintas.
 *
 * **Las comidas no tienen gráfica**, por lo mismo que no tienen tarjeta: no hay magnitud que
 * promediar, y una línea de «comidas al día» no es lo que esta pantalla intenta responder.
 *
 * La tensión pide dos magnitudes del mismo evento (sistólica y diastólica) y sale con dos series por
 * método. El pulso no entra: en la misma gráfica compartiría eje vertical con la presión y son dos
 * magnitudes distintas —lpm y mmHg—, así que un eje serviría para leer mal las dos.
 *
 * @type {Readonly<list<object>>}
 */
export const CHART_SECTIONS = Object.freeze([
    { type: 'glucose', groupBy: 'method' },
    {
        type: 'bloodPressure',
        valueKeys: ['systolic', 'diastolic'],
        groupBy: 'method',
        magnitudeKeys: {
            systolic: 'dashboard.magnitude.systolic',
            diastolic: 'dashboard.magnitude.diastolic',
        },
    },
    { type: 'insulin', valueKeys: ['dose'], groupBy: 'insulinType', groupKeys: INSULIN_TYPE_KEYS },
    { type: 'bodyWeight' },
    { type: 'temperature', groupBy: 'site', groupKeys: TEMPERATURE_SITE_KEYS },
]);

/**
 * Etiqueta del grupo de una serie: el método de medición, el sitio o el tipo de insulina.
 *
 * Un tipo que no agrupa (el peso, que se mide de una sola forma) llega con el grupo vacío y toma el
 * nombre del tipo: la leyenda nunca se queda con una entrada sin nombre.
 *
 * @param {object} section Una entrada de {@see CHART_SECTIONS}.
 * @param {string} group
 * @returns {string}
 */
export function chartGroupLabel(section, group) {
    if (group === '') {
        return t(`dashboard.timeline.type.${section.type}`);
    }

    if (section.groupKeys !== undefined) {
        return catalogLabel(section.groupKeys, group);
    }

    /** Glucemia y tensión: sus tokens son los del ADR 0008, que ya traduce `formatMethodLabel`. */
    return formatMethodLabel(group);
}

/**
 * Etiqueta completa de una serie. Con una sola magnitud es la del grupo; con varias lleva además
 * cuál es, porque «Brazo izquierdo, sentado» a secas no dice si la línea es la sistólica o la
 * diastólica, y esas dos no se pueden confundir.
 *
 * @param {object} section
 * @param {{group: string, valueKey: string}} series
 * @returns {string}
 */
export function chartSeriesLabel(section, series) {
    const groupLabel = chartGroupLabel(section, series.group);
    const magnitudeKey = section.magnitudeKeys?.[series.valueKey];

    if (magnitudeKey === undefined) {
        return groupLabel;
    }

    return t('dashboard.chart.seriesMagnitude', { group: groupLabel, magnitude: t(magnitudeKey) });
}

/**
 * Pie de la gráfica: qué series incluye, en qué unidad, y qué se ha quedado fuera.
 *
 * No es decoración: el lienzo es un objeto gráfico sin texto y este párrafo es su `aria-describedby`
 * (Do's #3), la única forma de que la banda y sus exclusiones lleguen a quien no ve la gráfica. Por
 * eso dice también qué significa la banda, que es lo que un color solo no puede explicar.
 *
 * @param {object} params
 * @param {list<string>} params.seriesLabels
 * @param {string} params.unit
 * @param {number} params.excludedByUnit
 * @param {number} params.omittedDays
 * @returns {string}
 */
export function chartCaptionText({ seriesLabels, unit, excludedByUnit, omittedDays }) {
    if (seriesLabels.length === 0) {
        return t('dashboard.chart.empty');
    }

    const parts = [t('dashboard.chart.caption', { unit, series: joinList(seriesLabels) })];

    if (omittedDays > 0) {
        parts.push(t('dashboard.chart.omittedDays', { count: omittedDays }));
    }

    const excludedText = describeExcludedByUnit(excludedByUnit, unit);

    if (excludedText !== null) {
        parts.push(excludedText);
    }

    return parts.join(' ');
}

/**
 * Unidad con la que se dibuja un tipo.
 *
 * La glucemia toma la de presentación del perfil (ADR 0007, la misma que las tarjetas); los demás,
 * la del registro más reciente ({@see dominantUnit}), porque no hay ajuste que elegir. `undefined`
 * significa «este tipo no lleva unidad en el sobre» y entonces no se excluye nada por unidad.
 *
 * @param {object} section
 * @param {list<object>} events
 * @param {string} glucoseUnit Unidad de presentación de glucemia.
 * @returns {string|null}
 */
export function chartUnit(section, events, glucoseUnit) {
    if (section.type === 'glucose') {
        return glucoseUnit;
    }

    return dominantUnit(events, section.type, (section.valueKeys ?? ['value'])[0]);
}

/**
 * Identificadores del bloque de gráfica de un tipo, tal como los escribe
 * `resources/views/phr/pages/dashboard.blade.php`.
 *
 * **Se buscan por `id`, nunca por `x-ref`**, y es la misma razón que documenta `chartLegend.js`: el
 * lienzo no puede vivir dentro de un `@island` —el servidor lo reemite vacío tras cualquier petición
 * de Livewire y se lleva por delante lo que Alpine había dibujado, que es el fallo que ya costó caro
 * en las pantallas de glucemia, tensión e insulina—, y `DashboardPageTest` exige que fuera de los
 * islands no haya ningún `x-ref`. Con `id` el módulo encuentra su lienzo esté donde esté, y el
 * bloque puede quedarse fuera de los islands con `wire:ignore` y `wire:key` estable.
 *
 * @param {string} type
 * @returns {{block: string, canvas: string, caption: string, legend: string}}
 */
export function chartElementIds(type) {
    const base = `dashboard-chart-${type}`;

    return { block: base, canvas: `${base}-canvas`, caption: `${base}-caption`, legend: `${base}-legend` };
}

/**
 * @param {string} id
 * @returns {HTMLElement|null} `null` también cuando no hay un documento de verdad (los tests de
 *          `tests/js` montan un DOM mínimo y no traen los bloques de gráfica).
 */
function elementById(id) {
    if (typeof document?.getElementById !== 'function') {
        return null;
    }

    return document.getElementById(id);
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
        /**
         * El control de periodo compartido con las pantallas de historial: aporta `rangePreset`,
         * `rangeFromDay`, `rangeToDay` y `rangeError` (los tres primeros con `x-model` en la
         * plantilla común) y llama a `loadHistory()` al aplicar.
         *
         * Arranca en `day` y no en `all` como el historial: el panel es la pantalla de entrada, tiene
         * que abrir rápido y enseñar lo de hoy, y descifrar un año de eventos en el navegador se
         * nota. El historial, en cambio, se abre para buscar, y allí acotar de oficio escondería
         * registros antiguos que nadie ha pedido esconder.
         */
        ...dateRangeControl({ preset: 'day' }),

        /**
         * Tipos de evento marcados. Es estado de interfaz del cliente (`x-model`, nunca
         * `wire:model`: ADR 0002) y no viaja a ninguna parte.
         */
        selectedTypes: defaultSelectedTypes(),

        /**
         * Los eventos ya descifrados de la última carga.
         *
         * No es caché de datos ni un atajo: es lo que permite que marcar y desmarcar tipos repinte
         * **sin volver a pedir ni a descifrar nada**, que es justo por qué el filtro por tipo sale
         * gratis (el servidor no puede filtrar por tipo de todos modos, ADR 0006). Mismo patrón que
         * `chartEvents` en `glucosePage.js`, y con el mismo límite: se vacía al bloquearse la sesión,
         * porque son valores en claro de una sesión que ya no está desbloqueada (ADR 0003).
         *
         * @type {list<object>}
         */
        decryptedEvents: [],

        /** Estado de la última carga, para poder repintar sin volver a pedir. */
        failedToOpen: 0,
        truncated: false,

        /**
         * Instancias vivas de Chart.js, una por tipo con gráfica. Se guardan para poder destruirlas
         * antes de repintar: dos gráficas sobre el mismo lienzo dejan la vieja debajo y los tooltips
         * de las dos respondiendo al ratón.
         *
         * @type {Record<string, object>}
         */
        charts: {},

        init() {
            /**
             * DESIGN.md § Charts — Dark: «a chart must also re-read them and redraw when the `.dark`
             * class on `<html>` changes». Chart.js congela los colores al construir el lienzo, así
             * que la única forma de conmutar de tema es rehacer la gráfica con los mismos datos, y
             * repintar aquí no cuesta ni una petición ni un descifrado: los eventos ya están
             * abiertos en memoria. Sin datos no hay nada que repintar.
             */
            observeThemeChange(() => {
                if (this.decryptedEvents.length > 0) {
                    this.render();
                }
            });

            if (isUnlocked()) {
                void this.loadSummary();

                return;
            }

            this.renderLocked();
            document.addEventListener(SESSION_READY_EVENT, () => void this.loadSummary(), { once: true });
        },

        /**
         * Contrato de `dateRangeControl`: al aplicar un periodo se vuelve a cargar por aquí. Es una
         * carga de verdad —el rango lo aplica el servidor— a diferencia de cambiar el filtro de
         * tipos, que solo repinta.
         */
        loadHistory() {
            return this.loadSummary();
        },

        /** Descarga y descifra los eventos del periodo elegido, y pinta con lo que haya marcado. */
        async loadSummary() {
            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    this.renderLocked();

                    return;
                }

                const { rawEvents, truncated } = await this.fetchRangeEvents(this.historyRange());

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

                this.decryptedEvents = events;
                this.failedToOpen = failedToOpen;
                this.truncated = truncated;

                this.render();
            } catch (failure) {
                this.renderNoticeError(failure);
            }
        },

        /**
         * Repinta con lo ya descifrado. Lo llaman la carga y el filtro de tipos; el segundo no pide
         * ni descifra nada, que es lo que permite marcar y desmarcar sin esperas.
         */
        render() {
            const userSettings = settings();
            const unit = userSettings?.glucoseUnit ?? DEFAULT_UNIT;
            const targetRange = resolveGlucoseTargetRange(userSettings, unit);
            const unitMismatch = targetRangeUnitMismatch(userSettings, unit);

            const selected = filterBySelectedTypes(this.decryptedEvents, this.selectedTypes);

            this.renderNotice(this.failedToOpen, this.truncated, selected.length);
            /**
             * La línea temporal se pinta con la **misma** lista de eventos ya descifrados que las
             * estadísticas: ni una petición ni un descifrado de más (ver `renderTimelineSection`).
             */
            this.$refs.timeline.replaceChildren(renderTimelineSection(selected));
            this.$refs.stats.replaceChildren(renderStatsSections(selected, {
                selectedTypes: this.selectedTypes,
                unit,
                targetRange,
                unitMismatch,
            }));
            /**
             * Las gráficas se dibujan con los mismos eventos, así que el periodo y el filtro de
             * tipos las gobiernan igual que a todo lo demás: al cambiar cualquiera de los dos se
             * pasa por aquí y se rehacen.
             */
            this.renderCharts(selected, unit);
        },

        /**
         * Dibuja una gráfica por tipo marcado que tenga algo que dibujar.
         *
         * Los bloques los pinta Blade y viven **fuera** de los islands, con `wire:ignore` (ver
         * {@see chartElementIds}); aquí solo se muestran, se ocultan y se rellenan. Un tipo
         * desmarcado, o sin lecturas en el periodo, queda oculto: un lienzo con los ejes vacíos
         * parece un fallo, y lo que sí hay que decir —que no hay registros de ese tipo en el
         * periodo— ya lo dice su tarjeta de estadísticas, en texto y con un enlace para registrar el
         * primero.
         *
         * @param {list<object>} events Eventos del periodo ya descifrados y filtrados por tipo.
         * @param {string} glucoseUnit Unidad de presentación de glucemia (ADR 0007).
         */
        renderCharts(events, glucoseUnit) {
            for (const section of CHART_SECTIONS) {
                const ids = chartElementIds(section.type);
                const block = elementById(ids.block);

                this.destroyChart(section.type);

                if (block === null) {
                    continue;
                }

                const unit = this.selectedTypes[section.type] === true
                    ? chartUnit(section, events, glucoseUnit)
                    : null;

                const bands = unit === null
                    ? { days: [], series: [], excludedByUnit: 0, omittedDays: 0 }
                    : buildDailyBands(events, {
                        type: section.type,
                        valueKeys: section.valueKeys,
                        groupBy: section.groupBy,
                        unit,
                    });

                const canvas = elementById(ids.canvas);

                if (bands.series.length === 0 || canvas === null) {
                    block.classList.add('hidden');

                    continue;
                }

                /**
                 * Se descubre el bloque **antes** de construir la gráfica: Chart.js mide el ancho
                 * del contenedor al crearse, y dentro de un elemento oculto ese ancho es cero, así
                 * que el lienzo saldría de un píxel y no se recuperaría al mostrarlo.
                 */
                block.classList.remove('hidden');

                const seriesLabels = bands.series.map((series) => chartSeriesLabel(section, series));
                const caption = elementById(ids.caption);

                if (caption !== null) {
                    caption.textContent = chartCaptionText({
                        seriesLabels,
                        unit,
                        excludedByUnit: bands.excludedByUnit,
                        omittedDays: bands.omittedDays,
                    });
                }

                this.charts[section.type] = renderMedianBandChart(canvas, {
                    days: bands.days,
                    series: bands.series.map((series, index) => ({
                        label: seriesLabels[index],
                        points: series.points,
                    })),
                    unit,
                    legendId: ids.legend,
                });
            }
        },

        /**
         * Destruye la gráfica de un tipo, si la había. Repintar sin destruir dejaría la instancia
         * anterior atada al mismo lienzo.
         *
         * @param {string} type
         */
        destroyChart(type) {
            if (this.charts[type] !== undefined && this.charts[type] !== null) {
                this.charts[type].destroy();
            }

            delete this.charts[type];
        },

        /** Oculta y destruye todas las gráficas: sin datos que dibujar no queda ninguna en pie. */
        destroyCharts() {
            for (const section of CHART_SECTIONS) {
                this.destroyChart(section.type);
                elementById(chartElementIds(section.type).block)?.classList.add('hidden');
            }
        },

        /**
         * Pide páginas de eventos hacia atrás hasta cubrir el rango elegido (ver
         * {@see needsAnotherPage}). El cursor es la fecha del evento más antiguo de la página, y el
         * servidor la aplica con `<` estricto, así que cada página avanza de verdad.
         *
         * El rango va al servidor (`[from, to)`), que sí puede acotar por `occurred_at` (ADR 0006):
         * con «último día» no se bajan ni se descifran los sobres de un mes entero.
         *
         * `truncated` avisa de que se agotó el tope de páginas antes de llegar al inicio del rango:
         * el resumen sigue siendo el de los registros más recientes, pero no puede presentarse como
         * si fuera el del periodo entero.
         *
         * @param {{from: string|null, to: string|null}} range
         * @returns {Promise<{rawEvents: list<object>, truncated: boolean}>}
         */
        async fetchRangeEvents(range) {
            const windowStartMs = rangeStartMs(range);
            const rawEvents = [];
            let cursor = null;
            let truncated = false;

            for (let page = 0; page < MAX_FETCH_PAGES; page += 1) {
                /** Mismo orden de argumentos que `HealthEventPage::fetchEvents(?string, int, ?string, ?string)`. */
                const pageEvents = await this.$wire.fetchEvents(cursor, FETCH_PAGE_SIZE, range.from, range.to);

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
         * Marcar o desmarcar un tipo solo repinta: los datos ya están descifrados en memoria (ver
         * {@see filterBySelectedTypes}). Sin sesión desbloqueada no hay nada que repintar y se deja
         * el aviso de bloqueo en pantalla.
         */
        applyTypeFilter() {
            if (!isUnlocked()) {
                this.renderLocked();

                return;
            }

            this.render();
        },

        /**
         * Sin clave no se puede descifrar nada: se dice en las dos regiones, no se pinta un resumen
         * vacío que se confundiría con «no tienes registros» (ADR 0003: perder la clave es normal).
         *
         * Los eventos descifrados de la carga anterior se tiran: son valores en claro de una sesión
         * que ya no está desbloqueada.
         */
        renderLocked() {
            this.decryptedEvents = [];
            this.failedToOpen = 0;
            this.truncated = false;
            /** Las gráficas dibujan valores en claro: con la sesión bloqueada no pueden quedarse. */
            this.destroyCharts();

            this.$refs.notice.replaceChildren();
            this.$refs.timeline.replaceChildren(createCallout('info', t('common.locked.summary')));
            this.$refs.stats.replaceChildren(createCallout('info', t('common.locked.summary')));
        },

        /**
         * Avisos de la carga: sobres que no abrieron, resumen recortado y cuántos registros hay
         * detrás de lo que se está enseñando.
         *
         * El recuento se dice siempre, no solo cuando algo se recorta: es la referencia que permite
         * leer «100 entradas» de la línea temporal sabiendo cuántas había.
         *
         * @param {number} failedToOpen
         * @param {boolean} truncated
         * @param {number} shownCount Eventos del periodo que pasan el filtro de tipos.
         */
        renderNotice(failedToOpen, truncated, shownCount) {
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

            if (shownCount > 0) {
                callouts.push(createCallout('info', t('dashboard.loadedCount', { count: shownCount })));
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
