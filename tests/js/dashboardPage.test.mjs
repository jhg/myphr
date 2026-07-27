/**
 * Comprobaciones de la lógica pura de `health/dashboardPage.js` (ADR 0004, ADR 0006, ADR 0007,
 * ADR 0008).
 *
 * No se monta Alpine: `dashboardPage()` solo orquesta DOM, y esa orquestación no se prueba aquí. Lo
 * que se prueba es la lógica que no depende de él, exportada aparte para poder llamarla
 * directamente, más la integración con `summarizeGlucosePeriod` de `statistics.js` para el punto que más
 * importa (ADR 0007: sin rango objetivo configurado, `inRangePercent` no aparece en absoluto).
 *
 * Corredor incorporado de Node, como el resto de `tests/js` (ver `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
    buildTimeline,
    chartCaptionText,
    CHART_SECTIONS,
    chartElementIds,
    chartSeriesLabel,
    chartUnit,
    defaultSelectedTypes,
    describeExcludedByUnit,
    describeTimelineEvent,
    EVENT_TYPES,
    filterBySelectedTypes,
    flattenDecryptedEvent,
    formatMeasuredValue,
    formatMethodLabel,
    formatNumber,
    groupEntriesByDay,
    hasAnyGlucoseSignal,
    hasPeriodData,
    localDayKey,
    MEASUREMENT_SECTIONS,
    needsAnotherPage,
    rangeStartMs,
    renderBloodPressureSection,
    renderGlucoseSection,
    renderMeasurementSection,
    renderStatsSections,
    renderTimelineSection,
    resolveGlucoseTargetRange,
    selectedTypeTokens,
    sortedMethodEntries,
    targetRangeUnitMismatch,
    TIMELINE_MAX_ENTRIES,
} from '../../resources/js/health/dashboardPage.js';
import { summarizeGlucosePeriod } from '../../resources/js/health/statistics.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/**
 * Estos tests afirman el texto **en castellano**, así que fijan el idioma en vez de darlo por
 * supuesto: el idioma por defecto del cliente es el inglés (igual que `config/app.php`), y en Node
 * no hay `<html lang>` del que deducirlo. Sin esta línea, las afirmaciones de texto de abajo
 * estarían comprobando el catálogo de respaldo sin decirlo.
 */
setLocale('es');

// --- formatMethodLabel -------------------------------------------------------------------------

test('formatMethodLabel: traduce los tokens de glucemia (ADR 0008)', () => {
    assert.equal(formatMethodLabel('capillary'), 'Capilar');
    assert.equal(formatMethodLabel('interstitial'), 'Intersticial');
});

test('formatMethodLabel: traduce brazo y postura de tensión (ADR 0008)', () => {
    assert.equal(formatMethodLabel('left_sitting'), 'Izquierdo, sentado');
    assert.equal(formatMethodLabel('right_standing'), 'Derecho, de pie');
    assert.equal(formatMethodLabel('left_lying'), 'Izquierdo, tumbado');
});

test('formatMethodLabel: un token que no reconoce se humaniza en vez de romper', () => {
    assert.equal(formatMethodLabel('oral_axillary'), 'Oral Axillary');
    assert.equal(formatMethodLabel('unknown'), 'Unknown');
});

// --- formatNumber -------------------------------------------------------------------------------

test('formatNumber: localiza con como máximo dos decimales', () => {
    assert.equal(formatNumber(140), '140');
    assert.equal(formatNumber(98.5), '98,5');
    assert.equal(formatNumber(98.456), '98,46');
});

// --- flattenDecryptedEvent ----------------------------------------------------------------------

test('flattenDecryptedEvent: junta occurredAt con el contenido descifrado', () => {
    const rawEvent = { id: 'abc', occurredAt: '2026-07-25T09:00:00.000000Z', payload: 'v1.xyz' };
    const content = { v: 1, type: 'glucose', tz: '+00:00', data: { value: '100', unit: 'mg/dL', method: 'capillary' } };

    const flattened = flattenDecryptedEvent(rawEvent, content);

    assert.equal(flattened.occurredAt, rawEvent.occurredAt);
    assert.equal(flattened.type, 'glucose');
    assert.deepEqual(flattened.data, content.data);
});

// --- resolveGlucoseTargetRange (ADR 0007) --------------------------------------------------------

test('resolveGlucoseTargetRange: sin ajustes, no hay rango', () => {
    assert.equal(resolveGlucoseTargetRange(null), undefined);
    assert.equal(resolveGlucoseTargetRange(undefined), undefined);
});

test('resolveGlucoseTargetRange: ajustes sin glucoseTargetRange, no hay rango', () => {
    assert.equal(resolveGlucoseTargetRange({ glucoseUnit: 'mg/dL' }), undefined);
});

test('resolveGlucoseTargetRange: low/high no numéricos o invertidos, no hay rango', () => {
    assert.equal(resolveGlucoseTargetRange({ glucoseTargetRange: { low: 'x', high: 180 } }), undefined);
    assert.equal(resolveGlucoseTargetRange({ glucoseTargetRange: { low: 200, high: 70 } }), undefined);
});

test('resolveGlucoseTargetRange: un rango bien formado se resuelve a números, con su unidad', () => {
    const range = resolveGlucoseTargetRange(
        { glucoseTargetRange: { low: '70', high: '180', unit: 'mg/dL' } },
        'mg/dL',
    );

    assert.deepEqual(range, { low: 70, high: 180, unit: 'mg/dL' });
});

/**
 * ADR 0007: no se convierte entre mg/dL y mmol/L. El perfil deja elegir por separado la unidad del
 * rango y la de presentación, así que un rango de 3,9-10 mmol/L con lecturas en mg/dL es un estado
 * alcanzable; comparar unos números contra los otros publicaría un «tiempo en rango: 0 %» que parece
 * un dato clínico y no lo es.
 */
test('resolveGlucoseTargetRange: un rango en otra unidad no se aplica', () => {
    const userSettings = { glucoseTargetRange: { low: 3.9, high: 10, unit: 'mmol/L' } };

    assert.equal(resolveGlucoseTargetRange(userSettings, 'mg/dL'), undefined);
    assert.deepEqual(resolveGlucoseTargetRange(userSettings, 'mmol/L'), { low: 3.9, high: 10, unit: 'mmol/L' });
});

test('un rango en otra unidad no produce ningún porcentaje de tiempo en rango', () => {
    const reference = '2026-07-25T12:00:00.000000Z';
    const events = [
        {
            v: 1,
            type: 'glucose',
            tz: '+00:00',
            occurredAt: reference,
            data: { value: '140', unit: 'mg/dL', method: 'capillary', loinc: '41653-7' },
        },
    ];

    const targetRange = resolveGlucoseTargetRange(
        { glucoseTargetRange: { low: 3.9, high: 10, unit: 'mmol/L' } },
        'mg/dL',
    );
    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL', targetRange });

    assert.equal('inRangePercent' in byMethod.capillary, false);
});

// --- targetRangeUnitMismatch ---------------------------------------------------------------------

test('targetRangeUnitMismatch: distingue «no hay rango» de «hay rango en otra unidad»', () => {
    assert.equal(targetRangeUnitMismatch(null, 'mg/dL'), false);
    assert.equal(targetRangeUnitMismatch({ glucoseUnit: 'mg/dL' }, 'mg/dL'), false);
    assert.equal(
        targetRangeUnitMismatch({ glucoseTargetRange: { low: 70, high: 180, unit: 'mg/dL' } }, 'mg/dL'),
        false,
    );
    assert.equal(
        targetRangeUnitMismatch({ glucoseTargetRange: { low: 3.9, high: 10, unit: 'mmol/L' } }, 'mg/dL'),
        true,
    );
});

/**
 * El caso que más importa (ADR 0007): sin rango configurado, `summarizeGlucosePeriod` no calcula
 * `inRangePercent` en ningún grupo, ni con `null` ni con `0`, la clave no está.
 */
test('sin rango objetivo configurado, inRangePercent no aparece en ningún grupo', () => {
    const reference = '2026-07-25T12:00:00.000000Z';
    const events = [
        {
            v: 1,
            type: 'glucose',
            tz: '+00:00',
            occurredAt: reference,
            data: { value: '140', unit: 'mg/dL', method: 'capillary', loinc: '41653-7' },
        },
    ];

    const targetRange = resolveGlucoseTargetRange(null);
    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL', targetRange });

    assert.equal('inRangePercent' in byMethod.capillary, false);
});

test('con rango objetivo configurado, inRangePercent sí aparece', () => {
    const reference = '2026-07-25T12:00:00.000000Z';
    const events = [
        {
            v: 1,
            type: 'glucose',
            tz: '+00:00',
            occurredAt: reference,
            data: { value: '140', unit: 'mg/dL', method: 'capillary', loinc: '41653-7' },
        },
    ];

    const targetRange = resolveGlucoseTargetRange(
        { glucoseTargetRange: { low: 70, high: 180, unit: 'mg/dL' } },
        'mg/dL',
    );
    const { byMethod } = summarizeGlucosePeriod(events, { unit: 'mg/dL', targetRange });

    assert.equal(byMethod.capillary.inRangePercent, 100);
});

// --- Filtro por tipo de evento ------------------------------------------------------------------

/**
 * Todos los tipos marcados de salida: estrenar el panel con alguno fuera escondería registros que
 * existen, y en un historial clínico «no aparece» se lee como «se ha perdido».
 */
test('defaultSelectedTypes: todos los tipos marcados', () => {
    const selected = defaultSelectedTypes();

    assert.deepEqual(Object.keys(selected).sort(), [...EVENT_TYPES].sort());
    assert.equal(Object.values(selected).every((value) => value === true), true);
});

test('selectedTypeTokens: solo los marcados, en el orden del catálogo', () => {
    assert.deepEqual(selectedTypeTokens({ ...defaultSelectedTypes(), meal: false, insulin: false }), [
        'glucose',
        'bloodPressure',
        'bodyWeight',
        'temperature',
    ]);
    assert.deepEqual(selectedTypeTokens({}), []);
});

/** Filtrar por tipo no cuesta ninguna petición: los eventos ya están descifrados (ADR 0006). */
test('filterBySelectedTypes: deja solo los tipos marcados', () => {
    const events = [
        { type: 'glucose', occurredAt: 't1' },
        { type: 'meal', occurredAt: 't2' },
        { type: 'bodyWeight', occurredAt: 't3' },
    ];

    const filtered = filterBySelectedTypes(events, { glucose: true, meal: false, bodyWeight: true });

    assert.deepEqual(filtered.map((event) => event.type), ['glucose', 'bodyWeight']);
});

// --- hasPeriodData -------------------------------------------------------------------------------

test('hasPeriodData: falso cuando el resumen del periodo no tiene ningún grupo', () => {
    assert.equal(hasPeriodData({ byMethod: {} }), false);
    assert.equal(hasPeriodData({ byGroup: {} }), false);
    assert.equal(hasPeriodData({ byMethod: { capillary: {} } }), true);
    assert.equal(hasPeriodData({ byGroup: { '': {} } }), true);
});

// --- Paginación de fetchEvents -------------------------------------------------------------------

/** Con «todos los registros» no hay suelo: se pagina hasta que el servidor deja de dar eventos. */
test('rangeStartMs: un rango abierto por abajo no pone suelo', () => {
    assert.equal(rangeStartMs({ from: null, to: null }), -Infinity);
    assert.equal(rangeStartMs({}), -Infinity);
    assert.equal(rangeStartMs({ from: 'no es una fecha' }), -Infinity);
});

test('rangeStartMs: el inicio del rango es hasta donde hay que retroceder', () => {
    assert.equal(
        rangeStartMs({ from: '2026-07-24T12:00:00.000000Z', to: null }),
        Date.parse('2026-07-24T12:00:00.000000Z'),
    );
});

test('needsAnotherPage: una página incompleta significa que ya no quedan eventos', () => {
    const page = [{ occurredAt: '2026-07-25T09:00:00.000000Z' }];

    assert.equal(needsAnotherPage(page, 500, Date.parse('2026-06-25T00:00:00Z')), false);
});

test('needsAnotherPage: página llena que aún no llega al inicio de la ventana, se pide otra', () => {
    const windowStartMs = Date.parse('2026-06-25T00:00:00Z');
    const page = [
        { occurredAt: '2026-07-25T09:00:00.000000Z' },
        { occurredAt: '2026-07-20T09:00:00.000000Z' },
    ];

    assert.equal(needsAnotherPage(page, 2, windowStartMs), true);
});

test('needsAnotherPage: página llena que ya cruza el inicio de la ventana, no se pide otra', () => {
    const windowStartMs = Date.parse('2026-06-25T00:00:00Z');
    const page = [
        { occurredAt: '2026-07-25T09:00:00.000000Z' },
        { occurredAt: '2026-06-01T09:00:00.000000Z' },
    ];

    assert.equal(needsAnotherPage(page, 2, windowStartMs), false);
});

test('needsAnotherPage: una fecha ilegible detiene el bucle en vez de pedir páginas a ciegas', () => {
    const page = [{ occurredAt: 'no es una fecha' }, { occurredAt: 'tampoco' }];

    assert.equal(needsAnotherPage(page, 2, Date.parse('2026-06-25T00:00:00Z')), false);
});

// --- sortedMethodEntries --------------------------------------------------------------------------

test('sortedMethodEntries: orden alfabético estable', () => {
    const entries = sortedMethodEntries({ interstitial: { a: 1 }, capillary: { b: 2 } });

    assert.deepEqual(entries.map(([method]) => method), ['capillary', 'interstitial']);
});

// --- describeExcludedByUnit -----------------------------------------------------------------------

test('describeExcludedByUnit: null sin eventos excluidos', () => {
    assert.equal(describeExcludedByUnit(0, 'mg/dL'), null);
});

test('describeExcludedByUnit: menciona el conteo y la unidad de presentación', () => {
    const text = describeExcludedByUnit(3, 'mg/dL');

    assert.match(text, /3 registro/);
    assert.match(text, /mg\/dL/);
});

// --- hasAnyGlucoseSignal ---------------------------------------------------------------------------

test('hasAnyGlucoseSignal: cuenta también lo excluido por unidad', () => {
    const empty = { week: { byMethod: {}, excludedByUnit: 0 }, month: { byMethod: {}, excludedByUnit: 0 } };
    const onlyExcluded = { week: { byMethod: {}, excludedByUnit: 0 }, month: { byMethod: {}, excludedByUnit: 30 } };

    assert.equal(hasAnyGlucoseSignal(empty.month), false);
    assert.equal(hasPeriodData(onlyExcluded.month), false);
    assert.equal(hasAnyGlucoseSignal(onlyExcluded.month), true);
});

// --- Pintado de la sección de glucemia -----------------------------------------------------------

/**
 * Estos cuatro tests montan un `document` mínimo, como `chartLegend.test.mjs`: lo justo que toca el
 * módulo (`createElement`, `createElementNS`, `createDocumentFragment`) y nada más.
 */
class FakeElement {
    constructor(tagName, namespace = null) {
        this.tagName = tagName;
        this.namespace = namespace;
        this.attributes = {};
        this.children = [];
        this.className = '';
        this.textContent = '';
        this.classList = { add: (...names) => { this.className = `${this.className} ${names.join(' ')}`.trim(); } };
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    appendChild(child) {
        this.children.push(child);

        return child;
    }

    /** Todo el texto del subárbol, que es lo que la persona acaba leyendo. */
    get text() {
        return [this.textContent, ...this.children.map((child) => child.text)].join(' ').trim();
    }
}

beforeEach(() => {
    globalThis.document = {
        createElement: (tagName) => new FakeElement(tagName),
        createElementNS: (namespace, tagName) => new FakeElement(tagName, namespace),
        createDocumentFragment: () => new FakeElement('#fragment'),
    };
});

afterEach(() => {
    delete globalThis.document;
});

/** Un resumen de método con la forma que devuelve `summarizeGlucosePeriod`, para pintar con datos. */
const GLUCOSE_METHOD_SUMMARY = Object.freeze({
    count: 2,
    mean: 110,
    median: 110,
    min: 100,
    max: 120,
    last: { value: 120, occurredAt: '2026-07-25T09:00:00.000000Z' },
});

/**
 * Cuántas veces aparece un texto en el subárbol. El estado vacío es la misma frase en cada tarjeta,
 * así que `assert.match` no distingue una de dos: hay que contar.
 *
 * @param {string} haystack
 * @param {RegExp} pattern Sin la bandera `g`: se añade aquí.
 * @returns {number}
 */
function countMatches(haystack, pattern) {
    return [...haystack.matchAll(new RegExp(pattern.source, 'g'))].length;
}

/**
 * El caso que el aviso existe para cubrir: treinta glucemias en mg/dL y la unidad de presentación
 * cambiada a mmol/L. Sin el aviso, el panel afirma que no hay ningún registro y no da ninguna pista
 * de que los datos existen y solo están en otra unidad.
 */
test('renderGlucoseSection: avisa de los excluidos por unidad aunque no quede ningún método', () => {
    const fragment = renderGlucoseSection({ byMethod: {}, excludedByUnit: 30 }, 'mmol/L', undefined, false);

    assert.match(fragment.text, /Todavía no hay registros/);
    assert.match(fragment.text, /30 registros/);
    assert.match(fragment.text, /mmol\/L/);
});

test('renderGlucoseSection: un único estado vacío cuando el periodo no trae nada', () => {
    const fragment = renderGlucoseSection({ byMethod: {}, excludedByUnit: 0 }, 'mg/dL', undefined, false);

    assert.equal(countMatches(fragment.text, /Todavía no hay registros/), 1);
    assert.doesNotMatch(fragment.text, /no se muestra/);
});

test('renderGlucoseSection: con rango en otra unidad avisa, y no invita a configurar lo que ya existe', () => {
    const fragment = renderGlucoseSection({ byMethod: {}, excludedByUnit: 30 }, 'mg/dL', undefined, true);

    assert.match(fragment.text, /otra unidad/);
    assert.doesNotMatch(fragment.text, /Configura tu rango objetivo/);
});

test('renderGlucoseSection: sin rango, invita también a quien solo tiene registros excluidos', () => {
    const fragment = renderGlucoseSection({ byMethod: {}, excludedByUnit: 30 }, 'mg/dL', undefined, false);

    assert.match(fragment.text, /Configura tu rango objetivo/);
});

/**
 * Las estadísticas del periodo elegido son las mismas que antes tenían las dos ventanas fijas:
 * recuento, media, mediana, mínimo, máximo y última lectura, una tarjeta por método (ADR 0008).
 */
test('renderGlucoseSection: una tarjeta por método, con todas las estadísticas', () => {
    const summary = {
        byMethod: { capillary: { ...GLUCOSE_METHOD_SUMMARY }, interstitial: { ...GLUCOSE_METHOD_SUMMARY } },
        excludedByUnit: 0,
    };

    const fragment = renderGlucoseSection(summary, 'mg/dL', undefined, false);

    assert.match(fragment.text, /Capilar/);
    assert.match(fragment.text, /Intersticial/);
    assert.equal(countMatches(fragment.text, /Recuento/), 2);
    assert.match(fragment.text, /Mediana/);
    assert.match(fragment.text, /Última lectura/);
    assert.doesNotMatch(fragment.text, /Todavía no hay registros/);
});

/** Ya no hay dos ventanas fijas: lo que se resume es el periodo que la persona ha elegido. */
test('renderGlucoseSection: no quedan cabeceras de «última semana» ni «último mes»', () => {
    const summary = { byMethod: { capillary: { ...GLUCOSE_METHOD_SUMMARY } }, excludedByUnit: 0 };

    const fragment = renderGlucoseSection(summary, 'mg/dL', undefined, false);

    assert.doesNotMatch(fragment.text, /Última semana/);
    assert.doesNotMatch(fragment.text, /Último mes/);
});

test('renderBloodPressureSection: un único estado vacío cuando el periodo no trae nada', () => {
    const fragment = renderBloodPressureSection({ byMethod: {} });

    assert.equal(countMatches(fragment.text, /Todavía no hay registros/), 1);
    assert.doesNotMatch(fragment.text, /Última semana/);
});

// --- Estadísticas de peso, temperatura e insulina ------------------------------------------------

/**
 * @param {string} type
 * @param {string} occurredAt
 * @param {object} data
 * @returns {object}
 */
function statsEvent(type, occurredAt, data) {
    return { v: 1, type, tz: '+00:00', occurredAt, data };
}

/** El peso se mide de una sola forma: una única tarjeta, sin cabecera de grupo. */
test('renderMeasurementSection: el peso resume las mismas estadísticas del periodo', () => {
    const events = [
        statsEvent('bodyWeight', '2026-07-24T08:00:00.000000Z', { value: '72.4', unit: 'kg' }),
        statsEvent('bodyWeight', '2026-07-25T08:00:00.000000Z', { value: '71.6', unit: 'kg' }),
    ];

    const fragment = renderMeasurementSection({ type: 'bodyWeight' }, events);

    assert.match(fragment.text, /Recuento/);
    assert.match(fragment.text, /Media/);
    assert.match(fragment.text, /Mediana/);
    assert.match(fragment.text, /Última lectura/);
    assert.match(fragment.text, /kg/);
    assert.match(fragment.text, /72/);
});

/** El sitio de medición nunca se mezcla en silencio (ADR 0008), igual que el método en glucemia. */
test('renderMeasurementSection: la temperatura lleva una tarjeta por sitio, con su etiqueta', () => {
    const events = [
        statsEvent('temperature', '2026-07-25T08:00:00.000000Z', { value: '36.5', unit: 'Cel', site: 'axillary' }),
        statsEvent('temperature', '2026-07-25T09:00:00.000000Z', { value: '37.1', unit: 'Cel', site: 'oral' }),
    ];

    /** La configuración real del módulo, no una copia: el sitio y sus etiquetas son su contrato. */
    const section = MEASUREMENT_SECTIONS.find((candidate) => candidate.type === 'temperature');

    const fragment = renderMeasurementSection(section, events);

    assert.match(fragment.text, /Axilar/);
    assert.match(fragment.text, /Oral/);
});

test('renderMeasurementSection: sin registros del tipo, el estado vacío y no una tarjeta de ceros', () => {
    const fragment = renderMeasurementSection({ type: 'bodyWeight' }, []);

    assert.match(fragment.text, /Todavía no hay registros/);
    assert.doesNotMatch(fragment.text, /Recuento/);
});

// --- Secciones de estadísticas -------------------------------------------------------------------

test('renderStatsSections: solo pinta las tarjetas de los tipos marcados', () => {
    const events = [
        statsEvent('glucose', '2026-07-25T09:00:00.000000Z', { value: '112', unit: 'mg/dL', method: 'capillary' }),
        statsEvent('bodyWeight', '2026-07-25T08:00:00.000000Z', { value: '72.4', unit: 'kg' }),
    ];

    const fragment = renderStatsSections(events, {
        selectedTypes: { glucose: true, bodyWeight: true },
        unit: 'mg/dL',
        targetRange: undefined,
        unitMismatch: false,
    });

    assert.match(fragment.text, /Glucemia/);
    assert.match(fragment.text, /Peso corporal/);
    assert.doesNotMatch(fragment.text, /Tensión arterial/);
    assert.doesNotMatch(fragment.text, /Temperatura/);
});

/**
 * Una pantalla vacía sin explicación se lee como «no tengo registros», y no es eso lo que ha
 * pasado: es que no hay ningún tipo marcado.
 */
test('renderStatsSections: sin ningún tipo marcado lo dice, en vez de quedarse en blanco', () => {
    const fragment = renderStatsSections([], {
        selectedTypes: {},
        unit: 'mg/dL',
        targetRange: undefined,
        unitMismatch: false,
    });

    assert.match(fragment.text, /ningún tipo de evento marcado/);
});

// --- Línea temporal unificada --------------------------------------------------------------------

/**
 * Fecha de referencia de los tests de la línea temporal. Las fechas de los eventos se escriben al
 * mediodía UTC a propósito: la agrupación por día usa la zona del dispositivo, y a las 12:00Z la
 * fecha local coincide con la UTC en cualquier zona razonable, así que estos tests no cambian de
 * resultado según dónde se ejecuten.
 */
const TIMELINE_REFERENCE = '2026-07-25T18:00:00.000000Z';

/**
 * @param {string} type
 * @param {string} occurredAt
 * @param {object} data
 * @returns {object} Un evento descifrado y aplanado, como los que produce `flattenDecryptedEvent`.
 */
function timelineEvent(type, occurredAt, data) {
    return { v: 1, type, tz: '+00:00', occurredAt, data };
}

test('describeTimelineEvent: resume una glucemia con su valor, su unidad y su método', () => {
    const entry = describeTimelineEvent(timelineEvent('glucose', TIMELINE_REFERENCE, {
        value: '112', unit: 'mg/dL', method: 'capillary', loinc: '41653-7',
    }));

    assert.equal(entry.typeLabel, 'Glucemia');
    assert.equal(entry.summary, '112 mg/dL');
    assert.equal(entry.detail, 'Capilar');
});

test('describeTimelineEvent: la tensión lleva sistólica, diastólica y pulso en una línea', () => {
    const entry = describeTimelineEvent(timelineEvent('bloodPressure', TIMELINE_REFERENCE, {
        systolic: '120', diastolic: '80', pulse: '68', unit: 'mm[Hg]', arm: 'left', posture: 'sitting',
    }));

    assert.equal(entry.typeLabel, 'Tensión arterial');
    assert.equal(entry.summary, '120/80 mm[Hg] · 68 lpm');
    assert.equal(entry.detail, 'Izquierdo, sentado');
});

/** El pulso es opcional (ADR 0006): sin él la línea no escribe un cero ni deja un hueco. */
test('describeTimelineEvent: una tensión sin pulso no inventa ninguno', () => {
    const entry = describeTimelineEvent(timelineEvent('bloodPressure', TIMELINE_REFERENCE, {
        systolic: '118', diastolic: '76', unit: 'mm[Hg]', arm: 'right', posture: 'lying',
    }));

    assert.equal(entry.summary, '118/76 mm[Hg]');
    assert.doesNotMatch(entry.summary, /lpm/);
});

test('describeTimelineEvent: la insulina lleva la dosis y el tipo', () => {
    const entry = describeTimelineEvent(timelineEvent('insulin', TIMELINE_REFERENCE, {
        insulinType: 'rapid', dose: '6', unit: '[iU]',
    }));

    assert.equal(entry.typeLabel, 'Insulina');
    assert.equal(entry.summary, '6 [iU]');
    assert.equal(entry.detail, 'Rápida');
});

test('describeTimelineEvent: la comida lleva su tipo y los alimentos', () => {
    const entry = describeTimelineEvent(timelineEvent('meal', TIMELINE_REFERENCE, {
        mealType: 'breakfast',
        foods: [{ name: 'Tostada', quantity: '2', unit: '{unidad}' }, { name: 'Café', quantity: '1', unit: '{unidad}' }],
    }));

    assert.equal(entry.typeLabel, 'Comida');
    assert.equal(entry.summary, 'Desayuno');
    assert.equal(entry.detail, 'Tostada, Café');
});

/** Una comida larga no puede ocupar cinco renglones: se nombran unos pocos y se cuenta el resto. */
test('describeTimelineEvent: una comida con muchos alimentos resume el resto con un recuento', () => {
    const entry = describeTimelineEvent(timelineEvent('meal', TIMELINE_REFERENCE, {
        mealType: 'lunch',
        foods: ['Arroz', 'Pollo', 'Ensalada', 'Pan', 'Fruta'].map((name) => ({ name, quantity: '1', unit: 'g' })),
    }));

    assert.equal(entry.detail, 'Arroz, Pollo, Ensalada, +2');
});

test('describeTimelineEvent: una comida sin alimentos lo dice, no finge una lista', () => {
    const entry = describeTimelineEvent(timelineEvent('meal', TIMELINE_REFERENCE, { mealType: 'snack', foods: [] }));

    assert.equal(entry.detail, 'sin alimentos anotados');
});

test('describeTimelineEvent: peso y temperatura, los dos tipos nuevos', () => {
    const weight = describeTimelineEvent(timelineEvent('bodyWeight', TIMELINE_REFERENCE, {
        value: '72.4', unit: 'kg', loinc: '3141-9',
    }));
    const temperature = describeTimelineEvent(timelineEvent('temperature', TIMELINE_REFERENCE, {
        value: '36.8', unit: 'Cel', site: 'axillary', loinc: '8310-5',
    }));

    assert.equal(weight.typeLabel, 'Peso corporal');
    assert.equal(weight.summary, '72,4 kg');
    assert.equal(temperature.typeLabel, 'Temperatura');
    assert.equal(temperature.summary, '36,8 Cel');
    assert.equal(temperature.detail, 'Axilar');
});

/** El separador decimal es el del idioma: en castellano `36,8`, no `36.8` (ver `formatNumber`). */
test('formatMeasuredValue: localiza el separador decimal y respeta lo que no es número', () => {
    assert.equal(formatMeasuredValue('36.8'), '36,8');
    assert.equal(formatMeasuredValue('120'), '120');
    assert.equal(formatMeasuredValue('positivo'), 'positivo');
    assert.equal(formatMeasuredValue(''), '');
    assert.equal(formatMeasuredValue(undefined), '');
});

test('describeTimelineEvent: un tipo que no sabe resumir devuelve null en vez de una línea vacía', () => {
    assert.equal(describeTimelineEvent(timelineEvent('futureType', TIMELINE_REFERENCE, { value: '1' })), null);
    assert.equal(describeTimelineEvent({ occurredAt: TIMELINE_REFERENCE }), null);
});

/** El motivo de la pantalla: comida, insulina y glucemia del mismo día, juntas y en orden. */
test('buildTimeline: mezcla todos los tipos y los ordena de más reciente a más antiguo', () => {
    const events = [
        timelineEvent('glucose', '2026-07-25T09:30:00.000000Z', { value: '145', unit: 'mg/dL', method: 'capillary' }),
        timelineEvent('meal', '2026-07-25T08:00:00.000000Z', { mealType: 'breakfast', foods: [] }),
        timelineEvent('insulin', '2026-07-25T08:05:00.000000Z', { insulinType: 'rapid', dose: '6', unit: '[iU]' }),
    ];

    const { entries, hidden, unsupported } = buildTimeline(events);

    assert.deepEqual(entries.map((entry) => entry.type), ['glucose', 'insulin', 'meal']);
    assert.equal(hidden, 0);
    assert.equal(unsupported, 0);
});

/**
 * Ya no recorta por ventana, y no es un descuido: el periodo lo aplica el servidor al pedir los
 * eventos (`[from, to)`) y el tipo lo aplica quien llama, así que aquí se pinta lo que llega. Un
 * segundo recorte en el cliente escondería registros que el periodo elegido sí incluye.
 */
test('buildTimeline: no vuelve a recortar por fecha lo que el servidor ya acotó', () => {
    const events = [
        timelineEvent('glucose', '2026-07-24T12:00:00.000000Z', { value: '100', unit: 'mg/dL', method: 'capillary' }),
        timelineEvent('glucose', '2026-01-01T12:00:00.000000Z', { value: '100', unit: 'mg/dL', method: 'capillary' }),
    ];

    const { entries } = buildTimeline(events);

    assert.equal(entries.length, 2);
    assert.equal(entries[0].occurredAt, '2026-07-24T12:00:00.000000Z');
});

test('buildTimeline: cuenta los tipos que no sabe describir en vez de tragárselos', () => {
    const events = [
        timelineEvent('glucose', '2026-07-24T12:00:00.000000Z', { value: '100', unit: 'mg/dL', method: 'capillary' }),
        timelineEvent('futureType', '2026-07-24T13:00:00.000000Z', { value: '1' }),
    ];

    const { entries, unsupported } = buildTimeline(events);

    assert.equal(entries.length, 1);
    assert.equal(unsupported, 1);
});

/**
 * El tope existe por el coste de pintar, no por el de descifrar (los eventos ya vienen descifrados).
 * Lo que este test fija es que recorte por lo más reciente y que diga cuántas dejó fuera: un recorte
 * silencioso haría leer la línea temporal como si fuera completa.
 */
test('buildTimeline: recorta por lo más reciente y declara cuántas entradas quedaron fuera', () => {
    const total = TIMELINE_MAX_ENTRIES + 7;
    const events = Array.from({ length: total }, (_, index) => timelineEvent(
        'glucose',
        new Date(Date.parse(TIMELINE_REFERENCE) - (index * 60 * 60 * 1000)).toISOString(),
        { value: String(100 + index), unit: 'mg/dL', method: 'capillary' },
    ));

    const { entries, hidden } = buildTimeline(events);

    assert.equal(entries.length, TIMELINE_MAX_ENTRIES);
    assert.equal(hidden, 7);
    assert.equal(entries[0].summary, '100 mg/dL');
});

test('groupEntriesByDay: agrupa por día y conserva el orden de las entradas', () => {
    const entries = [
        { occurredAt: '2026-07-25T18:00:00.000000Z' },
        { occurredAt: '2026-07-25T09:00:00.000000Z' },
        { occurredAt: '2026-07-24T21:00:00.000000Z' },
    ];

    const days = groupEntriesByDay(entries);

    assert.equal(days.length, 2);
    assert.equal(days[0].entries.length, 2);
    assert.equal(days[1].entries.length, 1);
    assert.equal(days[0].dayKey, localDayKey('2026-07-25T18:00:00.000000Z'));
});

/**
 * El mismo estado vacío que usan las otras dos secciones (`renderEmptyState`). El botón que lleva a
 * crear el primer registro no aparece aquí porque el destino se lee del `data-*` que pinta Blade, y
 * el `document` de estos tests no tiene `querySelector`: la frase, que es lo que informa, no depende
 * de encontrar la ruta.
 */
test('renderTimelineSection: sin ningún registro, el estado vacío coherente con el resto', () => {
    const fragment = renderTimelineSection([]);

    assert.match(fragment.text, /Todavía no hay registros/);
});

test('renderTimelineSection: pinta la hora, el tipo y el dato de cada entrada', () => {
    const events = [
        timelineEvent('glucose', '2026-07-25T09:30:00.000000Z', { value: '112', unit: 'mg/dL', method: 'capillary' }),
        timelineEvent('insulin', '2026-07-25T08:05:00.000000Z', { insulinType: 'rapid', dose: '6', unit: '[iU]' }),
    ];

    const fragment = renderTimelineSection(events);

    assert.match(fragment.text, /Glucemia/);
    assert.match(fragment.text, /112 mg\/dL/);
    assert.match(fragment.text, /Insulina/);
    assert.match(fragment.text, /6 \[iU\]/);
});

test('renderTimelineSection: dice cuántas entradas quedaron fuera cuando recorta', () => {
    const total = TIMELINE_MAX_ENTRIES + 3;
    const events = Array.from({ length: total }, (_, index) => timelineEvent(
        'glucose',
        new Date(Date.parse(TIMELINE_REFERENCE) - (index * 60 * 60 * 1000)).toISOString(),
        { value: '100', unit: 'mg/dL', method: 'capillary' },
    ));

    const fragment = renderTimelineSection(events);

    assert.match(fragment.text, new RegExp(String(TIMELINE_MAX_ENTRIES)));
    assert.match(fragment.text, /3 más antiguas no aparecen/);
});

test('renderTimelineSection: avisa de los registros de un tipo que no sabe resumir', () => {
    const events = [timelineEvent('futureType', '2026-07-25T09:00:00.000000Z', { value: '1' })];

    const fragment = renderTimelineSection(events);

    assert.match(fragment.text, /todavía no sabe resumir/);
});

// --- Gráficas del periodo -----------------------------------------------------------------------

test('chartElementIds: los identificadores son los que escribe la plantilla', () => {
    assert.deepEqual(chartElementIds('glucose'), {
        block: 'dashboard-chart-glucose',
        canvas: 'dashboard-chart-glucose-canvas',
        caption: 'dashboard-chart-glucose-caption',
        legend: 'dashboard-chart-glucose-legend',
    });
});

test('CHART_SECTIONS: no hay gráfica de comidas, que no tienen magnitud que promediar', () => {
    assert.deepEqual(
        CHART_SECTIONS.map((section) => section.type),
        ['glucose', 'bloodPressure', 'insulin', 'bodyWeight', 'temperature'],
    );
});

test('chartSeriesLabel: una magnitud sola se nombra por su método de medición (ADR 0008)', () => {
    const glucose = CHART_SECTIONS.find((section) => section.type === 'glucose');

    assert.equal(chartSeriesLabel(glucose, { group: 'capillary', valueKey: 'value' }), 'Capilar');
});

test('chartSeriesLabel: la tensión dice también cuál de las dos magnitudes es', () => {
    const bloodPressure = CHART_SECTIONS.find((section) => section.type === 'bloodPressure');

    assert.equal(
        chartSeriesLabel(bloodPressure, { group: 'left_sitting', valueKey: 'systolic' }),
        'Izquierdo, sentado · Sistólica',
    );
});

test('chartSeriesLabel: un tipo que no agrupa toma el nombre del tipo, nunca una entrada sin nombre', () => {
    const bodyWeight = CHART_SECTIONS.find((section) => section.type === 'bodyWeight');

    assert.equal(chartSeriesLabel(bodyWeight, { group: '', valueKey: 'value' }), 'Peso corporal');
});

test('chartUnit: la glucemia toma la unidad de presentación y los demás la del registro más reciente', () => {
    const events = [
        {
            type: 'bodyWeight',
            tz: '+00:00',
            occurredAt: '2026-07-25T09:00:00.000000Z',
            data: { value: '70', unit: 'kg' },
        },
    ];

    assert.equal(chartUnit({ type: 'glucose' }, events, 'mmol/L'), 'mmol/L');
    assert.equal(chartUnit({ type: 'bodyWeight' }, events, 'mmol/L'), 'kg');
    assert.equal(chartUnit({ type: 'temperature' }, events, 'mmol/L'), null);
});

test('chartCaptionText: sin series dice que no hay nada que dibujar, no una lista vacía', () => {
    const caption = chartCaptionText({ seriesLabels: [], unit: 'mg/dL', excludedByUnit: 0, omittedDays: 0 });

    assert.match(caption, /No hay lecturas/);
});

test('chartCaptionText: nombra las series, la unidad y todo lo que se ha quedado fuera', () => {
    const caption = chartCaptionText({
        seriesLabels: ['Capilar', 'Intersticial'],
        unit: 'mg/dL',
        excludedByUnit: 2,
        omittedDays: 5,
    });

    assert.match(caption, /Capilar/);
    assert.match(caption, /Intersticial/);
    assert.match(caption, /mg\/dL/);
    assert.match(caption, /5/);
    assert.match(caption, /2 registros/);
});
