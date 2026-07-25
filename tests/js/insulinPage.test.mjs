/**
 * Comprobaciones de la lógica pura de `health/insulinPage.js` (ADR 0004, ADR 0006).
 *
 * No se monta Alpine ni Chart.js: `insulinPage()` solo orquesta DOM y librerías externas, y esa
 * orquestación no se prueba aquí. Lo que se prueba es la lógica que no depende de ninguna de las
 * dos, exportada aparte para poder llamarla directamente (mismo enfoque que
 * `tests/js/glucosePage.test.mjs`).
 *
 * Corredor incorporado de Node, como el resto de `tests/js` (ver `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNumericValue } from '../../resources/js/health/numericValue.js';
import { test } from 'node:test';

import {
    buildInsulinContent,
    datetimeLocalToCanonical,
    filterInsulinEvents,
    formatTzOffset,
    groupInsulinByDay,
    injectionSiteLabel,
    INSULIN_UNIT,
    productLabel,
    summarizeDailyDoses,
} from '../../resources/js/health/insulinPage.js';
import { setLocale } from '../../resources/js/i18n/index.js';

/**
 * Estos tests afirman el texto **en castellano**, así que fijan el idioma en vez de darlo por
 * supuesto: el idioma por defecto del cliente es el inglés (igual que `config/app.php`), y en Node
 * no hay `<html lang>` del que deducirlo. Sin esta línea, las afirmaciones de texto de abajo
 * estarían comprobando el catálogo de respaldo sin decirlo.
 */
setLocale('es');

/**
 * Campos comunes de prueba, con la forma que devuelve `buildCommonEventFields` cuando no se le pasa
 * `origin`: siempre `manual`, porque el formulario de insulina no pregunta el origen del dato
 * (corrección de alcance del 2026-07-25).
 */
const COMMON_FIELDS = Object.freeze({ origin: 'manual', recordedBy: 'self' });

test('INSULIN_UNIT es el código UCUM de la unidad internacional, [iU]', () => {
    assert.equal(INSULIN_UNIT, '[iU]');
});

test('buildInsulinContent: forma exacta del ADR 0006, sin código LOINC', () => {
    const content = buildInsulinContent({
        dose: '6',
        insulinType: 'rapid',
        product: 'NovoRapid',
        site: 'abdomen',
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.deepEqual(content, {
        v: 1,
        type: 'insulin',
        tz: '+02:00',
        origin: 'manual',
        recordedBy: 'self',
        data: {
            insulinType: 'rapid',
            dose: '6',
            unit: '[iU]',
            product: 'NovoRapid',
            site: 'abdomen',
        },
    });

    assert.equal('loinc' in content.data, false, 'la insulina no lleva código LOINC (ADR 0006)');
});

test('buildInsulinContent: la dosis decimal viaja como cadena, nunca como número (ADR 0004)', () => {
    const content = buildInsulinContent({
        dose: '0.5',
        insulinType: 'rapid',
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.dose, '0.5');
    assert.equal(typeof content.data.dose, 'string');
});

test('buildInsulinContent: producto y zona ausentes cuando llegan vacíos o no se indican', () => {
    const withEmptyStrings = buildInsulinContent({
        dose: '6',
        insulinType: 'long',
        product: '',
        site: '',
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.equal('product' in withEmptyStrings.data, false);
    assert.equal('site' in withEmptyStrings.data, false);

    const withoutFields = buildInsulinContent({
        dose: '6',
        insulinType: 'long',
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.equal('product' in withoutFields.data, false);
    assert.equal('site' in withoutFields.data, false);
});

test('buildInsulinContent: producto con espacios de sobra se recorta', () => {
    const content = buildInsulinContent({
        dose: '6',
        insulinType: 'mixed',
        product: '  Humalog Mix 25  ',
        tz: '+02:00',
        common: COMMON_FIELDS,
    });

    assert.equal(content.data.product, 'Humalog Mix 25');
});

test('buildInsulinContent: los campos comunes van en el nivel superior, nunca dentro de data', () => {
    const content = buildInsulinContent({
        dose: '6',
        insulinType: 'rapid',
        tz: '+02:00',
        common: { origin: 'manual', recordedBy: 'caregiver', device: 'NovoPen', note: 'Nota libre' },
    });

    assert.equal(content.origin, 'manual');
    assert.equal(content.recordedBy, 'caregiver');
    assert.equal(content.device, 'NovoPen');
    assert.equal(content.note, 'Nota libre');

    assert.equal('origin' in content.data, false);
    assert.equal('recordedBy' in content.data, false);
    assert.equal('device' in content.data, false);
    assert.equal('note' in content.data, false);
});

test('buildInsulinContent: sin dosis, lanza en vez de guardar algo a medias', () => {
    assert.throws(() => buildInsulinContent({
        dose: '   ',
        insulinType: 'rapid',
        tz: '+02:00',
        common: COMMON_FIELDS,
    }));
});

test('buildInsulinContent: sin tipo de insulina, lanza en vez de adivinar uno', () => {
    assert.throws(() => buildInsulinContent({
        dose: '6',
        insulinType: '',
        tz: '+02:00',
        common: COMMON_FIELDS,
    }));

    assert.throws(() => buildInsulinContent({
        dose: '6',
        tz: '+02:00',
        common: COMMON_FIELDS,
    }));
});

test('injectionSiteLabel: tolera un evento sin site y no inventa nada', () => {
    const catalog = { injectionSites: [{ token: 'abdomen', label: 'Abdomen' }] };

    assert.equal(injectionSiteLabel(catalog, {}), null);
    assert.equal(injectionSiteLabel(catalog, { site: '' }), null);
    assert.equal(injectionSiteLabel(catalog, { site: 'abdomen' }), 'Abdomen');
    assert.equal(injectionSiteLabel(catalog, { site: 'unknown' }), 'unknown');
});

test('productLabel: tolera un evento sin product y no inventa nada', () => {
    assert.equal(productLabel({}), null);
    assert.equal(productLabel({ product: '' }), null);
    assert.equal(productLabel({ product: 'Lantus' }), 'Lantus');
});

test('filterInsulinEvents: descarta eventos de otro tipo', () => {
    const events = [
        { id: '1', occurredAt: '2026-07-25T08:00:00.000000Z', content: { type: 'insulin' } },
        { id: '2', occurredAt: '2026-07-25T08:05:00.000000Z', content: { type: 'glucose' } },
    ];

    const result = filterInsulinEvents(events);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
});

test('groupInsulinByDay: suma la dosis por día y tipo, y tolera decimales', () => {
    const events = [
        {
            id: '1',
            occurredAt: '2026-07-25T08:00:00.000000Z',
            content: { data: { insulinType: 'rapid', dose: '6' } },
        },
        {
            id: '2',
            occurredAt: '2026-07-25T20:00:00.000000Z',
            content: { data: { insulinType: 'rapid', dose: '0.5' } },
        },
        {
            id: '3',
            occurredAt: '2026-07-25T22:00:00.000000Z',
            content: { data: { insulinType: 'long', dose: '10' } },
        },
        {
            id: '4',
            occurredAt: '2026-07-26T08:00:00.000000Z',
            content: { data: { insulinType: 'rapid', dose: '7' } },
        },
    ];

    const { days, totalsByType } = groupInsulinByDay(events);

    assert.deepEqual(days, ['2026-07-25', '2026-07-26']);
    assert.deepEqual(totalsByType.rapid, [6.5, 7]);
    assert.deepEqual(totalsByType.long, [10, 0]);
});

test('groupInsulinByDay: sin eventos, no hay días ni series', () => {
    const { days, totalsByType } = groupInsulinByDay([]);

    assert.deepEqual(days, []);
    assert.deepEqual(totalsByType, {});
});

test('formatTzOffset: signo y relleno a dos dígitos', () => {
    assert.equal(formatTzOffset(120), '+02:00');
    assert.equal(formatTzOffset(-300), '-05:00');
    assert.equal(formatTzOffset(0), '+00:00');
});

test('datetimeLocalToCanonical: convierte con un desfase explícito, sin depender de la zona horaria local', () => {
    const { occurredAt, tz } = datetimeLocalToCanonical('2026-07-25T09:30:00', { timezoneOffsetMinutes: -120 });

    assert.equal(occurredAt, '2026-07-25T07:30:00.000000Z');
    assert.equal(tz, '+02:00');
});

test('la dosis pasa por la validacion numerica: coma normalizada a punto y limite de decimales', () => {
    const content = buildInsulinContent({
        dose: parseNumericValue('7,85', 'La dosis'),
        insulinType: 'rapid',
        tz: '+02:00',
        common: { origin: 'manual', recordedBy: 'self' },
    });

    assert.strictEqual(content.data.dose, '7.85');
    assert.strictEqual(typeof content.data.dose, 'string');

    assert.throws(() => parseNumericValue('7,855', 'La dosis'), /decimales/);
    assert.throws(() => parseNumericValue('-1', 'La dosis'), /negativ/);
});

test('summarizeDailyDoses: sin días, explica qué aparecerá aquí en vez de dejar el pie en blanco', () => {
    const caption = summarizeDailyDoses([], {}, (type) => type);

    assert.match(caption, /Aquí aparecerá la dosis total de cada día/);
});

test('summarizeDailyDoses: dice en texto los tipos y su dosis acumulada (DESIGN.md Do\'s #3)', () => {
    const caption = summarizeDailyDoses(
        ['2026-07-25', '2026-07-26'],
        { rapid: [6.5, 7], long: [10, 0] },
        (type) => ({ rapid: 'Rápida', long: 'Lenta' })[type] ?? type,
    );

    assert.match(caption, /2 días con registro/);
    assert.match(caption, /Rápida: 13\.5 \[iU\]/);
    assert.match(caption, /Lenta: 10 \[iU\]/);
});

/**
 * Contrato de DOM entre `insulin.blade.php` e `insulinPage.js`.
 *
 * Un `this.$refs.loQueSea` que la plantilla no declara es `undefined` y revienta al pulsar, sin
 * ningún aviso previo; un `x-ref` declarado y que nadie lee es peso muerto que aparenta un contrato
 * que no existe. Ninguno de los dos lo detecta el navegador, así que lo detecta este test: los dos
 * conjuntos tienen que coincidir exactamente.
 */
test('contrato de DOM: los x-ref de la plantilla y los $refs del módulo coinciden exactamente', () => {
    const template = readFileSync(new URL('../../resources/views/phr/pages/insulin.blade.php', import.meta.url), 'utf8');
    const module = readFileSync(new URL('../../resources/js/health/insulinPage.js', import.meta.url), 'utf8');

    const declared = new Set([...template.matchAll(/x-ref="([a-zA-Z]+)"/g)].map((match) => match[1]));
    const used = new Set([...module.matchAll(/\$refs\.([a-zA-Z]+)/g)].map((match) => match[1]));

    assert.deepEqual(
        [...used].filter((ref) => !declared.has(ref)),
        [],
        'hay $refs que la plantilla no declara: serían undefined en tiempo de ejecución',
    );

    assert.deepEqual(
        [...declared].filter((ref) => !used.has(ref)),
        [],
        'hay x-ref declarados que nadie lee: sobran',
    );
});

/**
 * Contrato con el servidor, la mitad que se puede comprobar sin PHP: qué métodos llama el módulo.
 * Que existan de verdad en `App\Filament\Pages\Insulin` lo comprueba
 * `tests/Feature/InsulinPageTest.php`, que es quien puede mirar la clase por reflexión.
 */
test('contrato con el servidor: el módulo solo llama a storeEvent y fetchEvents', () => {
    const module = readFileSync(new URL('../../resources/js/health/insulinPage.js', import.meta.url), 'utf8');

    const called = [...new Set([...module.matchAll(/\$wire\.([a-zA-Z]+)/g)].map((match) => match[1]))].sort();

    assert.deepEqual(called, ['fetchEvents', 'storeEvent']);
});
