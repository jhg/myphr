/**
 * Comprobaciones de `health/chartLegend.js`, la leyenda que las tres pantallas con gráfica pintan
 * en HTML **fuera** del `<canvas>` (ver el JSDoc del módulo para el porqué).
 *
 * Como `sessionBootstrap.test.mjs`, este fichero monta un `document` mínimo: lo justo que el módulo
 * toca (`createElement`, `createElementNS`, `getElementById`) y nada más. No se monta Chart.js, ni
 * hace falta: `legendItems` es pura y `renderLegend` solo escribe DOM.
 *
 * Corredor incorporado de Node, como el resto de `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { legendElementFor, legendItems, renderLegend } from '../../resources/js/health/chartLegend.js';

/** Nodo de mentira con lo justo que usa el módulo. */
class FakeElement {
    constructor(tagName, namespace = null) {
        this.tagName = tagName;
        this.namespace = namespace;
        this.attributes = {};
        this.children = [];
        this.className = '';
        this.textContent = '';
        this.id = '';
        this.parentElement = null;
        this.siblings = null;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);

        return child;
    }

    replaceChildren(...nodes) {
        this.children = nodes;

        for (const node of nodes) {
            node.parentElement = this;
        }
    }

    /** `after` inserta como hermano: aquí basta con anotarlo en el padre. */
    after(node) {
        if (this.parentElement !== null) {
            this.parentElement.appendChild(node);
        }
    }

    /** Todos los descendientes con una etiqueta dada, en orden. */
    find(tagName) {
        return this.children.flatMap((child) => [
            ...(child.tagName === tagName ? [child] : []),
            ...child.find(tagName),
        ]);
    }
}

/** @type {Map<string, FakeElement>} */
let byId;

beforeEach(() => {
    byId = new Map();

    globalThis.document = {
        createElement: (tagName) => new FakeElement(tagName),
        createElementNS: (namespace, tagName) => new FakeElement(tagName, namespace),
        getElementById: (id) => byId.get(id) ?? null,
    };
});

afterEach(() => {
    delete globalThis.document;
});

// --- legendItems --------------------------------------------------------------------------------

test('legendItems: conserva el orden y traslada color, trazo y forma de cada serie', () => {
    const items = legendItems([
        { label: 'Capilar', color: '#0077b6', borderDash: [], pointStyle: 'circle' },
        { label: 'Intersticial', color: '#005280', borderDash: [6, 4], pointStyle: 'triangle' },
    ]);

    assert.deepEqual(items, [
        { text: 'Capilar', color: '#0077b6', dash: [], shape: 'circle' },
        { text: 'Intersticial', color: '#005280', dash: [6, 4], shape: 'triangle' },
    ]);
});

test('legendItems: una serie sin trazo ni forma declarados cae en línea continua y círculo', () => {
    assert.deepEqual(
        legendItems([{ label: 'Rápida', color: '#0077b6' }]),
        [{ text: 'Rápida', color: '#0077b6', dash: [], shape: 'circle' }],
    );
});

test('legendItems: copia el trazo, no lo comparte con el descriptor de la serie', () => {
    const dash = [6, 4];
    const [item] = legendItems([{ label: 'Diastólica', color: '#005280', borderDash: dash }]);

    item.dash.push(99);

    assert.deepEqual(dash, [6, 4], 'mutar la leyenda no puede tocar lo que consume Chart.js');
});

// --- renderLegend -------------------------------------------------------------------------------

test('renderLegend: una entrada por serie, con su texto y su marca de forma', () => {
    const list = new FakeElement('ul');

    renderLegend(list, legendItems([
        { label: 'Sistólica · Izquierdo, sentado', color: '#0077b6', borderDash: [], pointStyle: 'circle' },
        { label: 'Diastólica · Izquierdo, sentado', color: '#0077b6', borderDash: [], pointStyle: 'triangle' },
    ]));

    assert.equal(list.getAttribute('role'), 'list');
    assert.equal(list.children.length, 2);
    assert.deepEqual(
        list.children.map((entry) => entry.find('span')[0].textContent),
        ['Sistólica · Izquierdo, sentado', 'Diastólica · Izquierdo, sentado'],
    );

    /**
     * Do's #3: dos series del MISMO color se distinguen por la forma. Si esto deja de cumplirse, la
     * leyenda vuelve a depender solo del color, que es el defecto que este módulo corrige.
     */
    assert.deepEqual(list.children.map((entry) => entry.find('circle').length > 0), [true, false]);
    assert.deepEqual(list.children.map((entry) => entry.find('polygon').length > 0), [false, true]);
});

test('renderLegend: el patrón de trazo de la serie llega a la línea de la muestra', () => {
    const list = new FakeElement('ul');

    renderLegend(list, legendItems([
        { label: 'Continua', color: '#0077b6', borderDash: [], pointStyle: 'circle' },
        { label: 'Discontinua', color: '#005280', borderDash: [6, 4], pointStyle: 'circle' },
    ]));

    const lines = list.children.map((entry) => entry.find('line')[0]);

    assert.equal(lines[0].getAttribute('stroke-dasharray'), null);
    assert.equal(lines[1].getAttribute('stroke-dasharray'), '6 4');
    assert.equal(lines[1].getAttribute('stroke'), '#005280');
});

test('renderLegend: la tinta va por su papel, nunca por un tono de la rampa', () => {
    const list = new FakeElement('ul');

    renderLegend(list, legendItems([{ label: 'Capilar', color: '#0077b6' }]));

    assert.match(list.children[0].className, /\btext-ink\b/);
    assert.doesNotMatch(
        list.children[0].className,
        /text-gray-/,
        'en modo oscuro gray-900 es la superficie: el texto desaparecería',
    );
});

test('renderLegend: repintar sustituye, no acumula (el historial se repinta tras cada guardado)', () => {
    const list = new FakeElement('ul');
    const series = [{ label: 'Capilar', color: '#0077b6' }];

    renderLegend(list, legendItems(series));
    renderLegend(list, legendItems(series));

    assert.equal(list.children.length, 1);
});

test('renderLegend: sin series deja el nodo vacío, no una leyenda huérfana', () => {
    const list = new FakeElement('ul');

    renderLegend(list, legendItems([{ label: 'Capilar', color: '#0077b6' }]));
    renderLegend(list, []);

    assert.deepEqual(list.children, []);
});

test('renderLegend: sin nodo donde pintar no revienta (la plantilla puede no haberlo declarado)', () => {
    assert.doesNotThrow(() => renderLegend(undefined, legendItems([{ label: 'Capilar', color: '#0077b6' }])));
    assert.doesNotThrow(() => renderLegend(null, []));
});

// --- legendElementFor ---------------------------------------------------------------------------

test('legendElementFor: si el nodo ya existe con ese id, se reutiliza y no se crea otro', () => {
    const declared = new FakeElement('ul');
    byId.set('glucose-chart-legend', declared);

    assert.equal(legendElementFor(new FakeElement('canvas'), 'glucose-chart-legend'), declared);
});

test('legendElementFor: sin nodo declarado lo crea fuera del contenedor del lienzo', () => {
    const container = new FakeElement('div');
    const canvas = container.appendChild(new FakeElement('canvas'));
    const region = new FakeElement('section');
    region.appendChild(container);

    const list = legendElementFor(canvas, 'glucose-chart-legend');

    assert.equal(list.tagName, 'ul');
    assert.equal(list.id, 'glucose-chart-legend');
    /**
     * Hermano del contenedor de altura fija, nunca dentro: con `maintainAspectRatio: false`
     * Chart.js exige que el padre del `<canvas>` sea suyo en exclusiva.
     */
    assert.equal(list.parentElement, region);
});

test('legendElementFor: el nodo creado se añade al aria-describedby del lienzo, sin pisar el pie', () => {
    const container = new FakeElement('div');
    const canvas = container.appendChild(new FakeElement('canvas'));
    new FakeElement('section').appendChild(container);
    canvas.setAttribute('aria-describedby', 'glucose-chart-caption');

    legendElementFor(canvas, 'glucose-chart-legend');

    assert.equal(canvas.getAttribute('aria-describedby'), 'glucose-chart-caption glucose-chart-legend');
});

test('legendElementFor: no duplica el nodo entre repintados', () => {
    const container = new FakeElement('div');
    const canvas = container.appendChild(new FakeElement('canvas'));
    const region = new FakeElement('section');
    region.appendChild(container);

    const first = legendElementFor(canvas, 'glucose-chart-legend');
    byId.set('glucose-chart-legend', first);
    const second = legendElementFor(canvas, 'glucose-chart-legend');

    assert.equal(first, second);
    assert.equal(region.children.filter((child) => child.tagName === 'ul').length, 1);
});
