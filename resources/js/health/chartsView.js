/**
 * Las gráficas del periodo: qué se dibuja, con qué nombre y en qué bloque.
 *
 * Son tres familias, y las tres se pintan a la vez en las tres pantallas que consumen este módulo
 * —el panel del paciente, el lector del profesional y la vista previa de compartir—:
 *
 * 1. **La curva de glucemia con las marcas de comida e insulina** ({@see GLUCOSE_CONTEXT_TYPE}), que
 *    es la que enseña la relación entre comer, pincharse y lo que hace la glucosa después.
 * 2. **La superposición de días sobre 24 horas** ({@see DAY_OVERLAY_TYPE}), el perfil glucémico
 *    ambulatorio, que enseña el patrón que se repite cada día.
 * 3. **Una por tipo de evento** ({@see CHART_SECTIONS}): mediana de cada día con una banda del
 *    mínimo al máximo de ese día.
 *
 * **Por qué es un módulo propio.** El cálculo ya vivía fuera (`dailyBands.js`) y el dibujo también
 * (`medianBandChart.js`); lo que seguía atado al panel del paciente era la tabla de qué se dibuja de
 * cada tipo, cómo se nombra cada serie y cómo se enciende o apaga cada bloque. Sacarlo es lo que
 * permite que el lector del profesional dibuje las mismas gráficas sin sesión y sin Livewire: aquí
 * no hay `$wire`, ni `x-ref`, ni nada del panel; solo eventos descifrados, unos identificadores de
 * elementos y Chart.js.
 *
 * **Los bloques los emite la plantilla y este módulo solo los rellena.** Se buscan por `id`, nunca
 * por `x-ref`: un `<canvas>` dentro de un `@island` desaparece tras cualquier petición de Livewire
 * —el servidor reemite el island y se lleva por delante lo que Alpine dibujó, la lección cara de las
 * pantallas de glucemia, tensión e insulina—, así que el bloque tiene que poder quedarse fuera de
 * los islands, con `wire:ignore` y `wire:key` estable. Con `id` el módulo encuentra su lienzo esté
 * donde esté (ver `resources/views/phr/pages/dashboard.blade.php`).
 */

import { formatNumber, joinList, t } from '../i18n/index.js';
import { buildDailyBands } from './dailyBands.js';
import { buildDayOverlay } from './dayOverlay.js';
import { renderDayOverlayChart } from './dayOverlayChart.js';
import {
    catalogLabel,
    formatMethodLabel,
    INSULIN_TYPE_KEYS,
    TEMPERATURE_SITE_KEYS,
    typeLabel,
} from './eventLabels.js';
import { buildGlucoseContext, MAX_READING_GAP_MS } from './glucoseContext.js';
import { renderGlucoseContextChart } from './glucoseContextChart.js';
import { renderMedianBandChart } from './medianBandChart.js';
import { describeExcludedByUnit } from './statsView.js';
import { dominantUnit } from './statistics.js';

/**
 * Prefijo de los identificadores del bloque de cada tipo. Cada pantalla que dibuje gráficas usa el
 * suyo, para que dos pantallas montadas a la vez nunca se peleen por el mismo `<canvas>`.
 */
export const DASHBOARD_CHART_PREFIX = 'dashboard';

/**
 * Qué se dibuja de cada tipo: el campo (o los campos) con la magnitud, el que dice cómo se midió y
 * con qué claves se traduce ese grupo. Es la misma tabla que gobierna las tarjetas de estadísticas
 * (`MEASUREMENT_SECTIONS` de `statsView.js`), ampliada con glucemia y tensión, para que la gráfica y
 * la tarjeta del mismo tipo no puedan estar agrupando de formas distintas.
 *
 * **Las comidas no tienen gráfica**, por lo mismo que no tienen tarjeta: no hay magnitud que
 * promediar.
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
 * Las dos gráficas que **no** son de un tipo de evento, sino de una pregunta clínica.
 *
 * `glucoseContext` cruza tres tipos —glucemia, comidas e insulina— sobre el mismo eje temporal, que
 * es lo que se mira en consulta y lo que ninguna pantalla por tipo puede enseñar. `dayOverlay`
 * superpone todos los días del periodo sobre 24 horas: el formato del perfil glucémico ambulatorio,
 * que revela el patrón que se repite cada día y que una serie cronológica disuelve.
 *
 * Sus identificadores de bloque salen de {@see chartElementIds} igual que los de un tipo: para la
 * plantilla y para el lector son un bloque más.
 */
export const GLUCOSE_CONTEXT_TYPE = 'glucoseContext';
export const DAY_OVERLAY_TYPE = 'dayOverlay';

/**
 * Todos los bloques de gráfica que emite una pantalla, en el orden en que se leen: primero las dos
 * que responden una pregunta, después una por tipo de evento.
 *
 * @type {Readonly<list<string>>}
 */
export const CHART_BLOCKS = Object.freeze([
    GLUCOSE_CONTEXT_TYPE,
    DAY_OVERLAY_TYPE,
    ...CHART_SECTIONS.map((section) => section.type),
]);

/** Claves de los textos propios de las dos gráficas que no son de un tipo. */
const BLOCK_KEYS = Object.freeze({
    [GLUCOSE_CONTEXT_TYPE]: { title: 'dashboard.chart.context.title', aria: 'dashboard.chart.context.ariaLabel' },
    [DAY_OVERLAY_TYPE]: { title: 'dashboard.chart.overlay.title', aria: 'dashboard.chart.overlay.ariaLabel' },
});

/**
 * Encabezado del bloque de una gráfica.
 *
 * @param {string} type Uno de {@see CHART_BLOCKS}.
 * @returns {string}
 */
export function chartBlockTitle(type) {
    return BLOCK_KEYS[type] === undefined ? typeLabel(type) : t(BLOCK_KEYS[type].title);
}

/**
 * Nombre accesible del lienzo: un `<canvas>` es un objeto gráfico sin texto y sin esto no tiene
 * nombre ninguno (Do's #3).
 *
 * @param {string} type
 * @returns {string}
 */
export function chartBlockAriaLabel(type) {
    return BLOCK_KEYS[type] === undefined
        ? t('dashboard.chart.ariaLabel', { type: typeLabel(type) })
        : t(BLOCK_KEYS[type].aria);
}

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
        return typeLabel(section.type);
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
 * (Do's #3), la única forma de que la banda y sus exclusiones lleguen a quien no ve la gráfica.
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
 * la del registro más reciente ({@see dominantUnit}), porque no hay ajuste que elegir. `null`
 * significa que no hay ninguna lectura de ese tipo con unidad, y entonces no hay nada que dibujar.
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
 * Identificadores del bloque de gráfica de un tipo, tal como los escribe la plantilla.
 *
 * @param {string} type
 * @param {string} [prefix]
 * @returns {{block: string, canvas: string, caption: string, legend: string}}
 */
export function chartElementIds(type, prefix = DASHBOARD_CHART_PREFIX) {
    const base = `${prefix}-chart-${type}`;

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
 * Destruye la gráfica de un tipo, si la había. Repintar sin destruir dejaría la instancia anterior
 * atada al mismo lienzo, con las dos respondiendo al ratón.
 *
 * @param {Record<string, object>} charts Instancias vivas, indexadas por tipo. Se modifica.
 * @param {string} type
 */
export function destroyChart(charts, type) {
    if (charts[type] !== undefined && charts[type] !== null) {
        charts[type].destroy();
    }

    delete charts[type];
}

/**
 * Oculta y destruye todas las gráficas: sin datos que dibujar no queda ninguna en pie (es lo que
 * ocurre al bloquearse la sesión, porque dibujan valores en claro).
 *
 * @param {Record<string, object>} charts
 * @param {string} [prefix]
 */
export function destroyCharts(charts, prefix = DASHBOARD_CHART_PREFIX) {
    for (const type of CHART_BLOCKS) {
        destroyChart(charts, type);
        elementById(chartElementIds(type, prefix).block)?.classList.add('hidden');
    }
}

/**
 * Plumbing común de un bloque de gráfica: encontrarlo, destruir la anterior, decidir si hay algo que
 * dibujar, escribir el pie y dibujar.
 *
 * El bloque se descubre **antes** de construir la gráfica: Chart.js mide el ancho del contenedor al
 * crearse y dentro de un elemento oculto ese ancho es cero, así que el lienzo saldría de un píxel y
 * no se recuperaría al mostrarlo.
 *
 * @param {object} params
 * @param {string} params.type
 * @param {string} params.prefix
 * @param {Record<string, object>} params.charts Se modifica.
 * @param {() => {caption: string, draw: (canvas: HTMLCanvasElement, ids: object) => object|null}|null} params.plan
 *        Devuelve `null` cuando no hay nada que dibujar y el bloque tiene que quedarse oculto: un
 *        lienzo con los ejes vacíos parece un fallo, no un estado vacío.
 */
function paintChartBlock({ type, prefix, charts, plan }) {
    const ids = chartElementIds(type, prefix);
    const block = elementById(ids.block);

    destroyChart(charts, type);

    if (block === null) {
        return;
    }

    const canvas = elementById(ids.canvas);
    const drawing = canvas === null ? null : plan();

    if (drawing === null) {
        block.classList.add('hidden');

        return;
    }

    block.classList.remove('hidden');

    const caption = elementById(ids.caption);

    if (caption !== null) {
        caption.textContent = drawing.caption;
    }

    charts[type] = drawing.draw(canvas, ids);
}

/**
 * Pie de la curva de glucemia con marcas: qué series lleva, qué se agrupó y qué se quedó fuera.
 *
 * Todo lo que no se ve se dice con un número. Una marca agrupada en silencio es una comida que el
 * ojo da por no ocurrida, y una lectura recortada sin avisar se lee como «antes no había nada».
 *
 * @param {object} params
 * @returns {string}
 */
export function contextCaptionText({
    seriesLabels,
    unit,
    excludedByUnit,
    groupedMarkers,
    omittedReadings,
    omittedMarkers,
}) {
    const parts = [t('dashboard.chart.context.caption', {
        unit,
        series: joinList(seriesLabels),
        hours: formatNumber(MAX_READING_GAP_MS / 3_600_000),
    })];

    if (groupedMarkers > 0) {
        parts.push(t('dashboard.chart.context.grouped', { count: groupedMarkers }));
    }

    if (omittedReadings > 0) {
        parts.push(t('dashboard.chart.context.omittedReadings', { count: omittedReadings }));
    }

    if (omittedMarkers > 0) {
        parts.push(t('dashboard.chart.context.omittedMarkers', { count: omittedMarkers }));
    }

    const excludedText = describeExcludedByUnit(excludedByUnit, unit);

    if (excludedText !== null) {
        parts.push(excludedText);
    }

    return parts.join(' ');
}

/**
 * Pie de la superposición de 24 horas: qué series lleva, cuántos días se superponen, qué banda de
 * fondo hay y qué se quedó fuera.
 *
 * @param {object} params
 * @returns {string}
 */
export function overlayCaptionText({ seriesLabels, unit, dayCount, omittedDays, excludedByUnit, targetRange }) {
    const parts = [
        t('dashboard.chart.overlay.caption', { unit, series: joinList(seriesLabels) }),
        t('dashboard.chart.overlay.days', { count: dayCount }),
    ];

    if (targetRange !== undefined && targetRange !== null) {
        parts.push(t('dashboard.chart.overlay.targetRange', {
            low: formatNumber(targetRange.low),
            high: formatNumber(targetRange.high),
            unit: targetRange.unit,
        }));
    }

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
 * Dibuja una gráfica por cada tipo incluido que tenga algo que dibujar.
 *
 * Un tipo excluido, o sin lecturas en el periodo, queda oculto: un lienzo con los ejes vacíos parece
 * un fallo, y lo que sí hay que decir —que no hay registros de ese tipo en el periodo— ya lo dice su
 * tarjeta de estadísticas, en texto.
 *
 * @param {list<object>} events Eventos del periodo, ya descifrados y filtrados por tipo.
 * @param {object} params
 * @param {string} params.glucoseUnit Unidad de presentación de glucemia (ADR 0007).
 * @param {Record<string, object>} params.charts Instancias vivas indexadas por tipo. Se modifica.
 * @param {(type: string) => boolean} [params.includesType] Qué tipos están marcados.
 * @param {string} [params.prefix]
 * @param {{low: number, high: number, unit: string}} [params.targetRange] Rango objetivo de glucemia
 *        ya resuelto y ya comprobado en la misma unidad (ADR 0007: no se convierte). Sin él, la
 *        superposición de 24 horas se dibuja sin banda de fondo, que es lo correcto: una banda con
 *        números de otra unidad sería una referencia falsa.
 */
export function renderCharts(events, {
    glucoseUnit,
    charts,
    includesType = () => true,
    prefix = DASHBOARD_CHART_PREFIX,
    targetRange,
}) {
    renderGlucoseContextBlock(events, { glucoseUnit, charts, includesType, prefix });
    renderDayOverlayBlock(events, { glucoseUnit, charts, includesType, prefix, targetRange });

    for (const section of CHART_SECTIONS) {
        const ids = chartElementIds(section.type, prefix);
        const block = elementById(ids.block);

        destroyChart(charts, section.type);

        if (block === null) {
            continue;
        }

        const unit = includesType(section.type) ? chartUnit(section, events, glucoseUnit) : null;

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
         * Se descubre el bloque **antes** de construir la gráfica: Chart.js mide el ancho del
         * contenedor al crearse, y dentro de un elemento oculto ese ancho es cero, así que el lienzo
         * saldría de un píxel y no se recuperaría al mostrarlo.
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

        charts[section.type] = renderMedianBandChart(canvas, {
            days: bands.days,
            series: bands.series.map((series, index) => ({
                label: seriesLabels[index],
                points: series.points,
            })),
            unit,
            legendId: ids.legend,
        });
    }
}

/**
 * La curva de glucemia con las marcas de comida e insulina encima.
 *
 * **Solo depende de que la glucemia esté marcada**, no de las comidas ni de la insulina: la gráfica
 * es la glucemia, y las marcas son el contexto que la explica. Si el filtro deja fuera las comidas,
 * los eventos de comida ya no llegan aquí —quien llama filtra antes— y la curva se dibuja sin ellas,
 * que es exactamente lo que se ha pedido.
 *
 * @param {list<object>} events
 * @param {object} params
 */
function renderGlucoseContextBlock(events, { glucoseUnit, charts, includesType, prefix }) {
    paintChartBlock({
        type: GLUCOSE_CONTEXT_TYPE,
        prefix,
        charts,
        plan: () => {
            if (!includesType('glucose')) {
                return null;
            }

            const context = buildGlucoseContext(events, { unit: glucoseUnit });

            if (context.series.length === 0) {
                return null;
            }

            const seriesLabels = context.series.map(
                (series) => (series.group === '' ? typeLabel('glucose') : formatMethodLabel(series.group)),
            );

            return {
                caption: contextCaptionText({ seriesLabels, unit: glucoseUnit, ...context }),
                draw: (canvas, ids) => renderGlucoseContextChart(canvas, {
                    series: context.series.map((series, index) => ({
                        label: seriesLabels[index],
                        points: series.points,
                    })),
                    markers: context.markers,
                    unit: glucoseUnit,
                    legendId: ids.legend,
                }),
            };
        },
    });
}

/**
 * La superposición de todos los días del periodo sobre un eje de 24 horas.
 *
 * @param {list<object>} events
 * @param {object} params
 */
function renderDayOverlayBlock(events, { glucoseUnit, charts, includesType, prefix, targetRange }) {
    paintChartBlock({
        type: DAY_OVERLAY_TYPE,
        prefix,
        charts,
        plan: () => {
            if (!includesType('glucose')) {
                return null;
            }

            const overlay = buildDayOverlay(events, { unit: glucoseUnit });

            if (overlay.groups.length === 0) {
                return null;
            }

            const groups = overlay.groups.map((group) => ({
                ...group,
                label: group.group === '' ? typeLabel('glucose') : formatMethodLabel(group.group),
            }));

            return {
                caption: overlayCaptionText({
                    seriesLabels: groups.map((group) => group.label),
                    unit: glucoseUnit,
                    dayCount: overlay.dayCount,
                    omittedDays: overlay.omittedDays,
                    excludedByUnit: overlay.excludedByUnit,
                    targetRange,
                }),
                draw: (canvas, ids) => renderDayOverlayChart(canvas, {
                    groups,
                    unit: glucoseUnit,
                    legendId: ids.legend,
                    targetRange,
                }),
            };
        },
    });
}
