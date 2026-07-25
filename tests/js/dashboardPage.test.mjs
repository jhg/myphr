/**
 * Comprobaciones de la lógica pura de `health/dashboardPage.js` (ADR 0004, ADR 0006, ADR 0007,
 * ADR 0008).
 *
 * No se monta Alpine: `dashboardPage()` solo orquesta DOM, y esa orquestación no se prueba aquí. Lo
 * que se prueba es la lógica que no depende de él, exportada aparte para poder llamarla
 * directamente, más la integración con `summarizeGlucose` de `statistics.js` para el punto que más
 * importa (ADR 0007: sin rango objetivo configurado, `inRangePercent` no aparece en absoluto).
 *
 * Corredor incorporado de Node, como el resto de `tests/js` (ver `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
    describeExcludedByUnit,
    flattenDecryptedEvent,
    formatMethodLabel,
    formatNumber,
    hasAnyGlucoseData,
    hasAnyGlucoseSignal,
    hasBloodPressureData,
    hasGlucoseData,
    monthWindowStartMs,
    needsAnotherPage,
    renderGlucosePeriod,
    renderGlucoseSection,
    resolveGlucoseTargetRange,
    sortedMethodEntries,
    targetRangeUnitMismatch,
} from '../../resources/js/health/dashboardPage.js';
import { summarizeGlucose, WINDOW_DAYS } from '../../resources/js/health/statistics.js';
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
    const { week } = summarizeGlucose(events, reference, { unit: 'mg/dL', targetRange });

    assert.equal('inRangePercent' in week.byMethod.capillary, false);
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
 * El caso que más importa (ADR 0007): sin rango configurado, `summarizeGlucose` no calcula
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
    const { week } = summarizeGlucose(events, reference, { unit: 'mg/dL', targetRange });

    assert.equal('inRangePercent' in week.byMethod.capillary, false);
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
    const { week } = summarizeGlucose(events, reference, { unit: 'mg/dL', targetRange });

    assert.equal(week.byMethod.capillary.inRangePercent, 100);
});

// --- hasGlucoseData / hasBloodPressureData -------------------------------------------------------

test('hasGlucoseData / hasBloodPressureData: falso cuando byMethod está vacío', () => {
    assert.equal(hasGlucoseData({ byMethod: {} }), false);
    assert.equal(hasBloodPressureData({ byMethod: {} }), false);
});

test('hasGlucoseData / hasBloodPressureData: verdadero cuando hay al menos un método', () => {
    assert.equal(hasGlucoseData({ byMethod: { capillary: {} } }), true);
    assert.equal(hasBloodPressureData({ byMethod: { left_sitting: {} } }), true);
});

test('hasAnyGlucoseData: solo si alguna de las dos ventanas tiene datos', () => {
    assert.equal(hasAnyGlucoseData({ week: { byMethod: {} }, month: { byMethod: {} } }), false);
    assert.equal(hasAnyGlucoseData({ week: { byMethod: {} }, month: { byMethod: { capillary: {} } } }), true);
    assert.equal(hasAnyGlucoseData({ week: { byMethod: { capillary: {} } }, month: { byMethod: {} } }), true);
});

// --- Paginación de fetchEvents -------------------------------------------------------------------

test('monthWindowStartMs: retrocede la ventana del mes desde el instante de referencia', () => {
    const reference = new Date('2026-07-25T12:00:00.000Z');

    assert.equal(
        monthWindowStartMs(reference),
        reference.getTime() - (WINDOW_DAYS.month * 24 * 60 * 60 * 1000)
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

    assert.equal(hasAnyGlucoseSignal(empty), false);
    assert.equal(hasAnyGlucoseData(onlyExcluded), false);
    assert.equal(hasAnyGlucoseSignal(onlyExcluded), true);
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

/**
 * El caso que el aviso existe para cubrir: treinta glucemias en mg/dL y la unidad de presentación
 * cambiada a mmol/L. Sin el aviso, el panel afirma que no hay ningún registro y no da ninguna pista
 * de que los datos existen y solo están en otra unidad.
 */
test('renderGlucosePeriod: avisa de los excluidos por unidad aunque no quede ningún método', () => {
    const section = renderGlucosePeriod('month', { byMethod: {}, excludedByUnit: 30 }, 'mmol/L');

    assert.match(section.text, /Todavía no hay registros/);
    assert.match(section.text, /30 registros/);
    assert.match(section.text, /mmol\/L/);
});

test('renderGlucosePeriod: sin excluidos, solo el estado sin datos', () => {
    const section = renderGlucosePeriod('week', { byMethod: {}, excludedByUnit: 0 }, 'mg/dL');

    assert.match(section.text, /Todavía no hay registros/);
    assert.doesNotMatch(section.text, /no se muestra/);
});

test('renderGlucoseSection: con rango en otra unidad avisa, y no invita a configurar lo que ya existe', () => {
    const summary = {
        week: { byMethod: {}, excludedByUnit: 0 },
        month: { byMethod: {}, excludedByUnit: 30 },
    };

    const fragment = renderGlucoseSection(summary, 'mg/dL', undefined, true);

    assert.match(fragment.text, /otra unidad/);
    assert.doesNotMatch(fragment.text, /Configura tu rango objetivo/);
});

test('renderGlucoseSection: sin rango, invita también a quien solo tiene registros excluidos', () => {
    const summary = {
        week: { byMethod: {}, excludedByUnit: 0 },
        month: { byMethod: {}, excludedByUnit: 30 },
    };

    const fragment = renderGlucoseSection(summary, 'mg/dL', undefined, false);

    assert.match(fragment.text, /Configura tu rango objetivo/);
});
