/**
 * Tarjetas de estadísticas de un periodo, a partir de eventos ya descifrados (ADR 0007, ADR 0008).
 *
 * **Todo el cálculo lo hace `health/statistics.js`** (`summarizeGlucosePeriod`,
 * `summarizeBloodPressurePeriod`, `summarizeMeasurementPeriod`): este módulo no reimplementa ninguna
 * media ni mediana, solo da forma al resultado para pintarlo.
 *
 * **Por qué es un módulo propio.** Vivía dentro de `dashboardPage.js`, es decir, dentro del panel
 * del paciente. Ahora recibe un array de eventos descifrados y devuelve nodos, sin Livewire, sin
 * `$wire` y sin leer el documento, para que el profesional que abre un recorte compartido vea las
 * mismas cifras calculadas de la misma forma. Que el paciente y el médico vean dos medias distintas
 * del mismo periodo es exactamente el fallo que esta separación impide.
 *
 * **El método de medición no se mezcla en silencio** (ADR 0008): cada tarjeta es de un único
 * método, con su etiqueta siempre visible.
 */

import { formatDateTime, t } from '../i18n/index.js';
import {
    catalogLabel,
    formatMethodLabel,
    formatNumber,
    INSULIN_TYPE_KEYS,
    TEMPERATURE_SITE_KEYS,
    typeLabel,
} from './eventLabels.js';
import { buildDailyBands } from './dailyBands.js';
import { createCallout, createSegmentedBar, createStatTile, renderEmptyState } from './eventVisuals.js';
import { selectedTypeTokens } from './eventTypes.js';
import {
    dominantUnit,
    summarizeBloodPressurePeriod,
    summarizeGlucosePeriod,
    summarizeMeasurementPeriod,
} from './statistics.js';

/**
 * Resuelve el rango objetivo de glucemia de los ajustes cifrados del usuario (ADR 0007).
 *
 * El ajuste **no trae valor por defecto**: si los ajustes no existen, o no traen
 * `glucoseTargetRange`, o lo traen con `low`/`high` que no son números finitos y ordenados, esta
 * función devuelve `undefined` y `summarizeGlucosePeriod` no calculará `inRangePercent` en absoluto
 * (ni `null` ni `0`: la clave no está).
 *
 * **El rango lleva su propia unidad y hay que compararla con la de presentación** (ADR 0007: no se
 * convierte entre mg/dL y mmol/L). Un rango de 3,9-10 mmol/L con lecturas en mg/dL es un estado
 * alcanzable: comparar unos números contra los otros publicaría un «tiempo en rango: 0 %» que parece
 * un dato clínico y no lo es.
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
 * por tanto si tiene sentido hablarle del rango objetivo, ADR 0007) cuentan también las excluidas.
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

/**
 * Nota al pie con los registros que quedaron fuera por estar en otra unidad, o `null`.
 *
 * Vive aparte porque acompaña tanto a una ventana con datos como al estado vacío: es el aviso que
 * impide que quien tiene treinta glucemias en mg/dL y ha cambiado su unidad a mmol/L lea «todavía no
 * hay registros» y crea que ha perdido sus datos.
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
 * Separador de la clave compuesta grupo + magnitud, el mismo carácter nulo y por el mismo motivo que
 * en `dailyBands.js`: los tokens de catálogo pueden llevar guiones y espacios, y una clave que se
 * pudiera partir mal mezclaría dos series clínicas distintas.
 */
const TREND_KEY_SEPARATOR = '\u0000';

/**
 * @param {string} group Método de medición, sitio, tipo de insulina... o `''` si el tipo no agrupa.
 * @param {string} valueKey Magnitud dentro del sobre (`value`, `systolic`, `dose`, ...).
 * @returns {string}
 */
function trendKey(group, valueKey) {
    return `${group}${TREND_KEY_SEPARATOR}${valueKey}`;
}

/**
 * Series diarias para las minigráficas de las baldosas, una por grupo y magnitud.
 *
 * **Se apoya en `buildDailyBands` en vez de recalcular nada**, y eso es lo importante: la
 * minigráfica de una tarjeta y la gráfica grande de al lado tienen que estar dibujando el mismo día
 * con el mismo número. De ahí salen ya resueltas las tres reglas que no se negocian: una serie por
 * método de medición (ADR 0008), el día en la zona horaria del **propio evento** y no la del
 * navegador que mira, y los días sin lecturas como `null` —hueco— y jamás como cero.
 *
 * De cada día se toma la **mediana**, la misma cifra que la gráfica dibuja como línea central: la
 * media de un día con una hipoglucemia y cinco lecturas normales cuenta otra historia.
 *
 * @param {list<object>} events Eventos del periodo, ya descifrados.
 * @param {{type: string, valueKeys?: list<string>, groupBy?: string, unit?: string}} params
 * @returns {Map<string, list<number|null>>} Clave de {@see trendKey}.
 */
export function dailyTrends(events, { type, valueKeys = ['value'], groupBy, unit } = {}) {
    const { series } = buildDailyBands(events, { type, valueKeys, groupBy, unit });
    /** @type {Map<string, list<number|null>>} */
    const trends = new Map();

    for (const entry of series) {
        trends.set(
            trendKey(entry.group, entry.valueKey),
            entry.points.map((point) => (point === null ? null : point.median)),
        );
    }

    return trends;
}

/**
 * Barra segmentada del tiempo en rango: por debajo, dentro y por encima del rango objetivo.
 *
 * **El único dato de esta pantalla que se puede leer como bueno o mejorable sin interpretar nada**:
 * el rango lo eligió la propia persona en su perfil (ADR 0007), así que el umbral no lo pone la
 * aplicación. Un número solo —«68 %»— no dice hacia qué lado se va el 32 % restante, y por debajo y
 * por encima son situaciones clínicas opuestas.
 *
 * **Los dos tramos de fuera comparten tono a propósito.** El sistema reserva el rojo para errores y
 * acciones destructivas (DESIGN.md, Don'ts #4), y esto es un resumen personal, no un diagnóstico:
 * teñir de rojo la glucemia de alguien es un mensaje que esta aplicación no está en posición de dar.
 * Inventar un quinto color para distinguirlos sería inventar un papel que el sistema no tiene, así
 * que lo que los distingue es su sitio en la barra —abajo a la izquierda, arriba a la derecha— y su
 * etiqueta escrita en la leyenda, que es lo que de verdad se lee.
 *
 * **El tramo de dentro siempre va en tono de acierto**, sin umbral que lo cambie. Antes esto era una
 * cifra suelta y el 70 % de referencia clínica decidía si salía verde o ámbar; con la barra ese
 * umbral sobra y además estorbaría: a quien esté en el 68 % le pintaría los tres tramos del mismo
 * ámbar y la barra dejaría de segmentarse justo cuando más falta hace verla. Esas lecturas estuvieron
 * dentro del rango, que es un hecho y no una nota.
 *
 * @param {{inRangePercent: number, belowRangePercent: number, aboveRangePercent: number}} methodSummary
 * @returns {HTMLElement}
 */
function renderTimeInRangeBar(methodSummary) {
    const section = document.createElement('div');
    section.className = 'mt-3 rounded-card border border-border bg-background px-4 py-3';

    const caption = document.createElement('p');
    caption.className = 'text-caption text-ink-secondary';
    caption.textContent = t('dashboard.stat.timeInRange');
    section.appendChild(caption);

    const asPercent = (percent) => `${formatNumber(percent)} %`;

    const bar = createSegmentedBar([
        {
            label: t('dashboard.stat.belowRange'),
            percent: methodSummary.belowRangePercent,
            value: asPercent(methodSummary.belowRangePercent),
            tone: 'warning',
        },
        {
            label: t('dashboard.stat.inRange'),
            percent: methodSummary.inRangePercent,
            value: asPercent(methodSummary.inRangePercent),
            tone: 'good',
        },
        {
            label: t('dashboard.stat.aboveRange'),
            percent: methodSummary.aboveRangePercent,
            value: asPercent(methodSummary.aboveRangePercent),
            tone: 'warning',
        },
    ]);
    bar.classList.add('mt-2');
    section.appendChild(bar);

    return section;
}

/**
 * Estado vacío de una sección.
 *
 * La frase no nombra el tipo porque la cabecera de la tarjeta ya lo dice. Lo que sí dice es «en este
 * periodo», que es la información que evita leer un hueco como «se ha perdido».
 *
 * `urlForType` llega como argumento y por defecto no da ninguna ruta: el panel del paciente pasa la
 * de Filament para el botón de «registra el primero», y el lector del profesional no tiene ninguna.
 *
 * `emptyText` también llega de fuera, y por el mismo motivo: la frase por defecto («todavía no hay
 * registros en este periodo») está escrita con voz de paciente y afirma una ausencia clínica. En el
 * lector no vale ninguna de las dos cosas —quien mira no tiene cuenta, y lo que ve es un recorte
 * cerrado, no su historial—, así que la pantalla que llama dice la frase que corresponde.
 *
 * @param {string} type
 * @param {(type: string) => string|null} urlForType
 * @param {string} [emptyText]
 * @returns {HTMLElement}
 */
function renderTypeEmptyState(type, urlForType, emptyText) {
    return renderEmptyState(emptyText ?? t('dashboard.empty'), urlForType(type), t('dashboard.addFirst'));
}

/**
 * @param {string} method
 * @param {object} methodSummary Una entrada de `byMethod` de `summarizeGlucosePeriod`.
 * @param {string} unit
 * @param {list<number|null>} [trend] Serie diaria de este método para la minigráfica de la mediana
 *        ({@see dailyTrends}).
 * @returns {HTMLDivElement}
 */
function renderGlucoseMethodCard(method, methodSummary, unit, trend) {
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
    /**
     * La minigráfica acompaña a la **mediana** y no a la media: es la cifra que la gráfica grande
     * dibuja como línea, así que la tarjeta y la gráfica cuentan lo mismo. Colgarla de las seis
     * baldosas sería repetir seis veces el mismo trazo.
     */
    grid.appendChild(createStatTile({
        label: t('dashboard.stat.median'),
        value: formatNumber(methodSummary.median),
        unit,
        trend,
    }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.min'), value: formatNumber(methodSummary.min), unit }));
    grid.appendChild(createStatTile({ label: t('dashboard.stat.max'), value: formatNumber(methodSummary.max), unit }));
    grid.appendChild(createStatTile({
        label: t('dashboard.stat.lastReading'),
        value: formatNumber(methodSummary.last.value),
        unit: `${unit} · ${formatDateTime(methodSummary.last.occurredAt)}`,
    }));

    card.appendChild(grid);

    /**
     * El tiempo en rango no es una baldosa más: es un reparto, y como barra segmentada se lee sin
     * hacer ninguna cuenta ({@see renderTimeInRangeBar}). Sin rango objetivo configurado no hay
     * barra —la clave `inRangePercent` no existe, ADR 0007— y lo que queda en su lugar es la
     * invitación a configurarlo que pinta la sección.
     */
    if (methodSummary.inRangePercent !== undefined) {
        card.appendChild(renderTimeInRangeBar(methodSummary));
    }

    return card;
}

/**
 * Sección completa de glucemia del periodo: el aviso del rango objetivo (falta, o está en otra
 * unidad) y una subtarjeta por método de medición (ADR 0008).
 *
 * @param {{byMethod: object, excludedByUnit: number}} glucoseSummary Resumen del periodo.
 * @param {string} unit
 * @param {{low: number, high: number, unit: string}|undefined} targetRange
 * @param {boolean} unitMismatch Hay rango guardado, pero en otra unidad (ver
 *        {@see targetRangeUnitMismatch}).
 * @param {{
 *   urlForType?: (type: string) => string|null,
 *   inviteTargetRange?: boolean,
 *   trends?: Map<string, list<number|null>>,
 * }} [options] `trends` llega de fuera porque esta función recibe el resumen ya calculado y no los
 *        eventos, y las series diarias solo se pueden construir con los eventos ({@see dailyTrends}).
 * @returns {DocumentFragment}
 */
export function renderGlucoseSection(glucoseSummary, unit, targetRange, unitMismatch = false, options = {}) {
    const urlForType = options.urlForType ?? (() => null);
    const emptyText = options.emptyText;
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
     * le pediría configurar un rango que no tendría todavía sobre qué aplicarse. Los registros
     * excluidos por unidad cuentan como datos: son glucemias suyas, solo que en otra unidad.
     *
     * Y solo a quien puede configurarlo. En el lector de un recorte compartido (ADR 0011) quien mira
     * no tiene cuenta aquí y no hay ningún ajuste que pueda tocar: la invitación sería una tarea
     * imposible, y además insinuaría que falta configuración del paciente cuando lo que pasa es que
     * su rango objetivo es suyo y no viaja en el recorte.
     */
    if (options.inviteTargetRange !== false
        && targetRange === undefined && !unitMismatch && hasAnyGlucoseSignal(glucoseSummary)) {
        const invite = createCallout('info', t('dashboard.targetRangeInvite'));
        invite.classList.add('mb-4');
        fragment.appendChild(invite);
    }

    /**
     * Sin ningún método con datos, un único estado vacío a lo ancho de la tarjeta. El aviso de
     * excluidos por unidad no se pierde: se pinta debajo, que es justo cuando más falta hace.
     */
    if (!hasPeriodData(glucoseSummary)) {
        fragment.appendChild(renderTypeEmptyState('glucose', urlForType, emptyText));

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
        methods.appendChild(
            renderGlucoseMethodCard(method, methodSummary, unit, options.trends?.get(trendKey(method, 'value'))),
        );
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
 * @param {Map<string, list<number|null>>} [trends] Series diarias del periodo ({@see dailyTrends}).
 * @returns {HTMLDivElement}
 */
function renderBloodPressureMethodCard(method, methodSummary, trends) {
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
        /** Una minigráfica por magnitud: sistólica, diastólica y pulso tienen tendencias distintas. */
        grid.appendChild(createStatTile({
            label: t('dashboard.stat.withMedian', { magnitude: label }),
            value: formatNumber(magnitude.median),
            unit,
            trend: trends?.get(trendKey(method, key)),
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
 * Sección de tensión arterial del periodo: una subtarjeta por método (brazo y postura, ADR 0008), o
 * el estado vacío.
 *
 * @param {{byMethod: object}} bloodPressureSummary Resumen del periodo.
 * @param {{
 *   urlForType?: (type: string) => string|null,
 *   trends?: Map<string, list<number|null>>,
 * }} [options] `trends` llega de fuera por lo mismo que en la glucemia: aquí solo hay resumen, y las
 *        series diarias se construyen con los eventos ({@see dailyTrends}).
 * @returns {DocumentFragment}
 */
export function renderBloodPressureSection(bloodPressureSummary, options = {}) {
    const urlForType = options.urlForType ?? (() => null);
    const emptyText = options.emptyText;
    const fragment = document.createDocumentFragment();

    if (!hasPeriodData(bloodPressureSummary)) {
        fragment.appendChild(renderTypeEmptyState('bloodPressure', urlForType, emptyText));

        return fragment;
    }

    const methods = document.createElement('div');
    methods.className = 'space-y-3';

    for (const [method, methodSummary] of sortedMethodEntries(bloodPressureSummary.byMethod)) {
        methods.appendChild(renderBloodPressureMethodCard(method, methodSummary, options.trends));
    }

    fragment.appendChild(methods);

    return fragment;
}

/**
 * Tipos de una sola magnitud numérica que se resumen con el mismo cálculo genérico
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
 * @param {list<number|null>} [trend] Serie diaria del grupo para la minigráfica de la mediana.
 * @returns {HTMLDivElement}
 */
function renderMeasurementCard(groupLabel, groupSummary, unit, trend) {
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
        trend,
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
 * Sección de un tipo de magnitud simple (insulina, peso, temperatura) para el periodo.
 *
 * La unidad no la elige la persona en ningún ajuste para estos tres (a diferencia de la glucemia,
 * ADR 0007), así que se resume con la del registro más reciente y las demás se cuentan aparte
 * ({@see dominantUnit}); el aviso de excluidos por unidad es el mismo que usa la glucemia.
 *
 * @param {{type: string, valueKey?: string, groupBy?: string, groupKeys?: object}} section
 * @param {list<object>} events Eventos del periodo, ya descifrados.
 * @param {{urlForType?: (type: string) => string|null}} [options]
 * @returns {DocumentFragment}
 */
export function renderMeasurementSection(section, events, options = {}) {
    const urlForType = options.urlForType ?? (() => null);
    const emptyText = options.emptyText;
    const fragment = document.createDocumentFragment();
    const valueKey = section.valueKey ?? 'value';
    const unit = dominantUnit(events, section.type, valueKey);

    if (unit === null) {
        fragment.appendChild(renderTypeEmptyState(section.type, urlForType, emptyText));

        return fragment;
    }

    const summary = summarizeMeasurementPeriod(events, {
        type: section.type,
        valueKey,
        groupBy: section.groupBy,
        unit,
    });

    if (!hasPeriodData(summary)) {
        fragment.appendChild(renderTypeEmptyState(section.type, urlForType, emptyText));

        return fragment;
    }

    const groups = document.createElement('div');
    groups.className = 'space-y-3';

    /**
     * Aquí sí se construyen las series en casa, y no llegan por `options`: esta función recibe los
     * eventos, que es lo único que hacía falta. La glucemia y la tensión reciben resúmenes ya
     * hechos, y por eso las suyas se las tienen que dar.
     */
    const trends = dailyTrends(events, {
        type: section.type,
        valueKeys: [valueKey],
        groupBy: section.groupBy,
        unit,
    });

    for (const [group, groupSummary] of sortedMethodEntries(summary.byGroup)) {
        const label = section.groupKeys === undefined ? null : catalogLabel(section.groupKeys, group);

        groups.appendChild(renderMeasurementCard(label, groupSummary, unit, trends.get(trendKey(group, valueKey))));
    }

    const note = createExcludedNote(summary.excludedByUnit, unit);

    if (note !== null) {
        groups.appendChild(note);
    }

    fragment.appendChild(groups);

    return fragment;
}

/**
 * Tarjeta de un tipo: la misma superficie que las secciones de la plantilla (DESIGN.md § Cards, con
 * papeles del tema y no tonos de la rampa) y el nombre del tipo como cabecera.
 *
 * La cabecera la escribe este módulo y no la plantilla porque qué tarjetas existen depende del
 * filtro, y una cabecera del servidor se quedaría en pantalla sobre una tarjeta que ya no está.
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
    heading.textContent = typeLabel(type);
    card.appendChild(heading);

    const content = document.createElement('div');
    content.className = 'mt-4';
    content.appendChild(body);
    card.appendChild(content);

    return card;
}

/**
 * Todas las secciones de estadísticas del periodo, una tarjeta por tipo marcado.
 *
 * Solo se pinta lo que se ha marcado: si se desmarca la tensión, su tarjeta no está, en vez de
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
 * @param {(type: string) => string|null} [params.urlForType]
 * @param {boolean} [params.inviteTargetRange] `false` en el lector del profesional, que no tiene
 *        ningún ajuste que configurar (ver {@see renderGlucoseSection}).
 * @param {string} [params.emptyText] Frase del estado vacío. Ver {@see renderTypeEmptyState}: la de
 *        serie habla en voz de paciente y afirma una ausencia clínica, que no es lo que ocurre
 *        cuando lo que vacía la tarjeta es un recorte ajeno.
 * @returns {DocumentFragment}
 */
export function renderStatsSections(events, {
    selectedTypes,
    unit,
    targetRange,
    unitMismatch,
    urlForType,
    inviteTargetRange = true,
    emptyText,
}) {
    const options = { urlForType: urlForType ?? (() => null), inviteTargetRange, emptyText };
    const fragment = document.createDocumentFragment();

    if (selectedTypeTokens(selectedTypes).length === 0) {
        fragment.appendChild(createCallout('info', t('dashboard.typeFilter.none')));

        return fragment;
    }

    /** @type {list<[string, DocumentFragment]>} */
    const sections = [];

    if (selectedTypes.glucose === true) {
        const summary = summarizeGlucosePeriod(events, { unit, targetRange });
        /** Una serie por método (ADR 0008) y solo de la unidad de presentación (ADR 0007). */
        const trends = dailyTrends(events, { type: 'glucose', groupBy: 'method', unit });

        sections.push([
            'glucose',
            renderGlucoseSection(summary, unit, targetRange, unitMismatch, { ...options, trends }),
        ]);
    }

    if (selectedTypes.bloodPressure === true) {
        /** Las tres magnitudes del sobre van juntas y salen como tres series por método. */
        const trends = dailyTrends(events, {
            type: 'bloodPressure',
            valueKeys: ['systolic', 'diastolic', 'pulse'],
            groupBy: 'method',
        });

        sections.push([
            'bloodPressure',
            renderBloodPressureSection(summarizeBloodPressurePeriod(events), { ...options, trends }),
        ]);
    }

    for (const section of MEASUREMENT_SECTIONS) {
        if (selectedTypes[section.type] === true) {
            sections.push([section.type, renderMeasurementSection(section, events, options)]);
        }
    }

    for (const [type, body] of sections) {
        fragment.appendChild(createStatsCard(type, body));
    }

    return fragment;
}
