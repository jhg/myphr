/**
 * Checks of `health/chartLegend.js`, the legend the three screens with a chart paint in HTML
 * **outside** the `<canvas>` (see the module JSDoc for the why).
 *
 * Like `sessionBootstrap.test.mjs`, this file mounts a minimal `document`: exactly what the module
 * touches (`createElement`, `createElementNS`, `getElementById`) and nothing else. Chart.js is not
 * mounted, and it does not need to be: `legendItems` is pure and `renderLegend` only writes DOM.
 *
 * Node's built-in runner, like the rest of `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { legendElementFor, legendItems, renderLegend } from '../../resources/js/health/chartLegend.js';

/** Fake node with exactly what the module uses. */
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

    /** `after` inserts as a sibling: here noting it on the parent is enough. */
    after(node) {
        if (this.parentElement !== null) {
            this.parentElement.appendChild(node);
        }
    }

    /** All descendants with a given tag, in order. */
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

test('legendItems: keeps the order and carries over colour, dash and shape of each series', () => {
    const items = legendItems([
        { label: 'Capilar', color: '#0077b6', borderDash: [], pointStyle: 'circle' },
        { label: 'Intersticial', color: '#005280', borderDash: [6, 4], pointStyle: 'triangle' },
    ]);

    assert.deepEqual(items, [
        { text: 'Capilar', color: '#0077b6', dash: [], shape: 'circle', line: true },
        { text: 'Intersticial', color: '#005280', dash: [6, 4], shape: 'triangle', line: true },
    ]);
});

test('legendItems: a series with no declared dash or shape falls back to a solid line and a circle', () => {
    assert.deepEqual(
        legendItems([{ label: 'Rápida', color: '#0077b6' }]),
        [{ text: 'Rápida', color: '#0077b6', dash: [], shape: 'circle', line: true }],
    );
});

test('legendItems: a series declared without a line does not carry one in the legend', () => {
    /**
     * The meal and insulin markers of the glucose curve are loose events, not a continuous series:
     * a stroke in their legend entry would assert a line the chart does not draw.
     */
    assert.deepEqual(
        legendItems([{ label: 'Comidas', color: '#059669', pointStyle: 'rectRot', lineless: true }]),
        [{ text: 'Comidas', color: '#059669', dash: [], shape: 'rectRot', line: false }],
    );
});

test('legendItems: it copies the dash, it does not share it with the series descriptor', () => {
    const dash = [6, 4];
    const [item] = legendItems([{ label: 'Diastólica', color: '#005280', borderDash: dash }]);

    item.dash.push(99);

    assert.deepEqual(dash, [6, 4], 'mutar la leyenda no puede tocar lo que consume Chart.js');
});

// --- renderLegend -------------------------------------------------------------------------------

test('renderLegend: one entry per series, with its text and its shape marker', () => {
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
     * Do's #3: two series of the SAME colour are told apart by shape. If this stops holding, the
     * legend depends on colour alone again, which is the defect this module fixes.
     */
    assert.deepEqual(list.children.map((entry) => entry.find('circle').length > 0), [true, false]);
    assert.deepEqual(list.children.map((entry) => entry.find('polygon').length > 0), [false, true]);
});

test('renderLegend: the dash pattern of the series reaches the line of the sample', () => {
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

test('renderLegend: the ink goes by its role, never by a shade of the ramp', () => {
    const list = new FakeElement('ul');

    renderLegend(list, legendItems([{ label: 'Capilar', color: '#0077b6' }]));

    assert.match(list.children[0].className, /\btext-ink\b/);
    assert.doesNotMatch(
        list.children[0].className,
        /text-gray-/,
        'en modo oscuro gray-900 es la superficie: el texto desaparecería',
    );
});

test('renderLegend: repainting replaces, it does not stack (the history repaints after every save)', () => {
    const list = new FakeElement('ul');
    const series = [{ label: 'Capilar', color: '#0077b6' }];

    renderLegend(list, legendItems(series));
    renderLegend(list, legendItems(series));

    assert.equal(list.children.length, 1);
});

test('renderLegend: with no series it leaves the node empty, not an orphan legend', () => {
    const list = new FakeElement('ul');

    renderLegend(list, legendItems([{ label: 'Capilar', color: '#0077b6' }]));
    renderLegend(list, []);

    assert.deepEqual(list.children, []);
});

test('renderLegend: with no node to paint in it does not blow up (the template may not have declared it)', () => {
    assert.doesNotThrow(() => renderLegend(undefined, legendItems([{ label: 'Capilar', color: '#0077b6' }])));
    assert.doesNotThrow(() => renderLegend(null, []));
});

// --- legendElementFor ---------------------------------------------------------------------------

test('legendElementFor: if the node already exists with that id, it is reused and no other is created', () => {
    const declared = new FakeElement('ul');
    byId.set('glucose-chart-legend', declared);

    assert.equal(legendElementFor(new FakeElement('canvas'), 'glucose-chart-legend'), declared);
});

test('legendElementFor: with no declared node it creates one outside the canvas container', () => {
    const container = new FakeElement('div');
    const canvas = container.appendChild(new FakeElement('canvas'));
    const region = new FakeElement('section');
    region.appendChild(container);

    const list = legendElementFor(canvas, 'glucose-chart-legend');

    assert.equal(list.tagName, 'ul');
    assert.equal(list.id, 'glucose-chart-legend');
    /**
     * Sibling of the fixed-height container, never inside: with `maintainAspectRatio: false`
     * Chart.js demands that the parent of the `<canvas>` be exclusively its own.
     */
    assert.equal(list.parentElement, region);
});

test('legendElementFor: the created node is added to the aria-describedby of the canvas, without treading on the caption', () => {
    const container = new FakeElement('div');
    const canvas = container.appendChild(new FakeElement('canvas'));
    new FakeElement('section').appendChild(container);
    canvas.setAttribute('aria-describedby', 'glucose-chart-caption');

    legendElementFor(canvas, 'glucose-chart-legend');

    assert.equal(canvas.getAttribute('aria-describedby'), 'glucose-chart-caption glucose-chart-legend');
});

test('legendElementFor: it does not duplicate the node between repaints', () => {
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
