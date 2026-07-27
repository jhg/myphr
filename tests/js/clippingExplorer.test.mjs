/**
 * The screen of a shared clipping (`resources/js/reader/clippingExplorer.js`, ADR 0011).
 *
 * It is the module both ends of the sharing see: the professional who opens the link and the
 * patient who previews before sending it. Two different things are checked here:
 *
 * 1. **The pure logic**: which period is applied, how the package is flattened and which types are offered.
 * 2. **The security invariants**, which are not an implementation detail but the reason this
 *    screen can exist with no account and no session. They are checked by reading the source code
 *    of the reader itself: there is no way to write a behaviour assertion for "there is no way to
 *    ask for one more event", because what has to be shown is an **absence**.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

import { CHART_BLOCKS, chartElementIds } from '../../resources/js/health/chartsView.js';
import { DEFAULT_LOCALE, setLocale } from '../../resources/js/i18n/index.js';
import {
    clippingBounds,
    clippingEnd,
    clippingGlucoseUnit,
    clippingHasMixedGlucoseUnits,
    clippingSubrange,
    clippingTypes,
    flattenClippingEvents,
    narrowToClipping,
    renderClippingExplorer,
    viewingText,
} from '../../resources/js/reader/clippingExplorer.js';

afterEach(() => {
    setLocale(DEFAULT_LOCALE);
});

/** Vite manifest. It only exists after `npm run build`, and it is not in the repository. */
const MANIFEST_PATH = new URL('../../public/build/manifest.json', import.meta.url);

/**
 * A clipping like the one `buildSharePackageBody()` builds: events with `occurredAt` and
 * `content`, the declared range, the count and the two type lists.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
function clipping(overrides = {}) {
    return {
        v: 1,
        generatedAt: '2026-07-20T10:00:00.000000Z',
        range: { from: '2026-06-20T00:00:00.000000Z', to: '2026-07-20T00:00:00.000000Z' },
        includedTypes: ['glucose', 'insulin'],
        excludedTypes: ['meal'],
        eventCount: 3,
        events: [
            {
                occurredAt: '2026-06-21T08:00:00.000000Z',
                content: { v: 1, type: 'glucose', data: { value: '95', unit: 'mg/dL', method: 'capillary' } },
            },
            {
                occurredAt: '2026-07-19T08:00:00.000000Z',
                content: { v: 1, type: 'glucose', data: { value: '140', unit: 'mg/dL', method: 'capillary' } },
            },
            {
                occurredAt: '2026-07-19T22:00:00.000000Z',
                content: { v: 1, type: 'insulin', data: { dose: '12', unit: '[iU]', insulinType: 'rapid' } },
            },
        ],
        ...overrides,
    };
}

// --- Narrow, never widen ---------------------------------------------------------------------------

/**
 * The central invariant of the reader: the professional can narrow what they look at inside the
 * clipping, and cannot ask for a single day more than the patient chose to share.
 */
test('narrowToClipping: a period wider than the clipping is cut to the ends of the clipping', () => {
    const bounds = clippingBounds(clipping());

    const widened = narrowToClipping(
        { from: '2020-01-01T00:00:00.000000Z', to: '2030-01-01T00:00:00.000000Z' },
        bounds,
    );

    assert.deepEqual(widened, bounds);
});

test('narrowToClipping: a period open on both sides stays as the whole clipping', () => {
    const bounds = clippingBounds(clipping());

    assert.deepEqual(narrowToClipping({ from: null, to: null }, bounds), bounds);
});

test('narrowToClipping: a narrower period is respected, which is what it exists for', () => {
    const bounds = clippingBounds(clipping());
    const inner = { from: '2026-07-01T00:00:00.000000Z', to: '2026-07-10T00:00:00.000000Z' };

    assert.deepEqual(narrowToClipping(inner, bounds), inner);
});

/**
 * With a clipping with no declared ends there is nothing to cut, and none is needed: the data
 * source is the list already in memory, so an open range widens nothing.
 */
test('narrowToClipping: with no declared ends, what is asked for passes through as is', () => {
    const asked = { from: '2026-01-01T00:00:00.000000Z', to: null };

    assert.deepEqual(narrowToClipping(asked, { from: null, to: null }), asked);
});

/**
 * The shortcuts count from the end of the clipping and not from today's clock. With "today", a
 * clipping generated last week would come out empty on pressing "last day", and an empty screen in
 * an appointment reads as "this patient has no records".
 */
test('clippingEnd: the end of the clipping is the declared one, not the current instant', () => {
    const body = clipping();

    assert.equal(clippingEnd(clippingBounds(body), []).toISOString(), '2026-07-20T00:00:00.000Z');
});

test('clippingEnd: with no declared end, the most recent record of the clipping itself', () => {
    const body = clipping({ range: { from: null, to: null } });
    const { events } = flattenClippingEvents(body);

    /** The `+1` keeps the event itself inside, which is the one we want to see. */
    assert.equal(clippingEnd(clippingBounds(body), events).toISOString(), '2026-07-19T22:00:00.001Z');
});

test('clippingSubrange: "last day" is counted from the end of the clipping and comes out inside it', () => {
    const body = clipping();
    const { events } = flattenClippingEvents(body);

    const { range, error } = clippingSubrange({ preset: 'day', bounds: clippingBounds(body), events });

    assert.equal(error, '');
    assert.equal(range.from, '2026-07-19T00:00:00.000000Z');
    /** The upper end is set by the clipping: the shortcut leaves it open and here it cannot be. */
    assert.equal(range.to, '2026-07-20T00:00:00.000000Z');
});

/**
 * A custom range going outside the clipping is accepted and clipped, instead of being rejected:
 * whoever types it is asking for "everything around here", and giving them the whole clipping is
 * the honest answer. What cannot happen is showing anything from outside, because there is nothing outside.
 */
test('clippingSubrange: a custom range overflowing the clipping is clipped to it', () => {
    const body = clipping();
    const bounds = clippingBounds(body);

    const { range, error } = clippingSubrange({
        preset: 'custom',
        fromDay: '2019-01-01',
        toDay: '2031-12-31',
        bounds,
        events: [],
    });

    assert.equal(error, '');
    assert.deepEqual(range, bounds);
});

/**
 * A badly typed range does not leave the screen blank: the whole clipping is returned along with
 * the reason, which the caller paints as a warning. In an appointment, an empty screen with no
 * explanation is worse than a period wider than the one asked for.
 */
test('clippingSubrange: an incomplete range returns the whole clipping and a reason', () => {
    const bounds = clippingBounds(clipping());

    const { range, error } = clippingSubrange({ preset: 'custom', fromDay: '2026-07-01', toDay: '', bounds, events: [] });

    assert.deepEqual(range, bounds);
    assert.notEqual(error, '');
});

// --- Flattening the package --------------------------------------------------------------------

test('flattenClippingEvents: the content and the date end up at the same level, as statistics.js expects', () => {
    const { events, unreadable } = flattenClippingEvents(clipping());

    assert.equal(events.length, 3);
    assert.equal(unreadable.length, 0);
    assert.equal(events[0].type, 'glucose');
    assert.equal(events[0].occurredAt, '2026-06-21T08:00:00.000000Z');
    assert.equal(events[0].data.value, '95');
});

/**
 * ADR 0004: a record that cannot be read is counted and shown, never swallowed. In a clipping
 * somebody else is going to read, a missing record is indistinguishable from a record that never
 * existed, and that difference is clinical.
 */
test('flattenClippingEvents: an event with no readable content is set apart, it does not disappear', () => {
    const body = clipping();
    body.events.push({ occurredAt: '2026-07-19T23:00:00.000000Z', content: null });
    body.events.push({ occurredAt: '2026-07-19T23:30:00.000000Z', content: { v: 1, data: {} } });

    const { events, unreadable } = flattenClippingEvents(body);

    assert.equal(events.length, 3);
    assert.equal(unreadable.length, 2);
});

// --- Types and units -----------------------------------------------------------------------------

/**
 * Only the checkboxes of the types the clipping includes are offered. Offering "Meals" in a
 * clipping where the patient chose not to share them would invite ticking it and concluding, from
 * the silence, that they do not eat. What was left out is said in the header, in those words.
 */
test('clippingTypes: only the included types, in catalog order', () => {
    assert.deepEqual(clippingTypes(clipping()), ['glucose', 'insulin']);
});

/**
 * The display unit of the patient is their own encrypted configuration (ADR 0007) and does not
 * travel in the clipping: the unit comes from the readings. If they measured in mmol/L, it reads so.
 */
test('clippingGlucoseUnit: the unit comes from the readings of the clipping, not from any setting', () => {
    const body = clipping();
    body.events[1].content.data.unit = 'mmol/L';
    body.events[0].content.data.unit = 'mmol/L';

    assert.equal(clippingGlucoseUnit(flattenClippingEvents(body).events), 'mmol/L');
});

test('clippingGlucoseUnit: with no glucose reading, mg/dL', () => {
    assert.equal(clippingGlucoseUnit([]), 'mg/dL');
});

// --- Security invariants, checked over the code itself ----------------------------------------------

/**
 * @param {string} relativePath
 * @returns {string}
 */
function sourceOf(relativePath) {
    return readFileSync(fileURLToPath(new URL(`../../resources/js/${relativePath}`, import.meta.url)), 'utf8');
}

/**
 * The code of a module **without its comments**.
 *
 * It is needed because these files document their own prohibitions in the same words ("nothing is
 * written to `localStorage`"), and a naive search would take as broken the very rule the comment
 * is promising to keep.
 *
 * @param {string} relativePath
 * @returns {string}
 */
function codeOf(relativePath) {
    return sourceOf(relativePath)
        .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
        .replaceAll(/^\s*\/\/.*$/gm, ' ');
}

/**
 * The three files that make up the professional's screen. If a fourth ever appears, it has to go
 * into this list: it is the perimeter these checks watch.
 */
const READER_SOURCES = Object.freeze([
    'reader.js',
    'reader/readerPage.js',
    'reader/clippingExplorer.js',
    'reader/clinicalReport.js',
]);

/**
 * **The decrypted package lives only in memory.** Closing the tab wipes it, just like the master
 * key of the patient (ADR 0003). Writing it to `localStorage` or to IndexedDB would leave it on the
 * disk of a clinic computer several people use and nobody in this conversation controls, and there
 * it would outlive the expiry of the link, which is the only thing this design can promise.
 *
 * It is checked over the search and the sub-period too: storing "the last thing you searched for"
 * would be the same clinical trace through another door.
 */
test('the reader writes nothing on the device: no storage, no cookies', () => {
    for (const path of READER_SOURCES) {
        const code = codeOf(path);

        for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
            assert.equal(
                code.includes(forbidden),
                false,
                `${path} no puede usar ${forbidden}: el recorte descifrado vive solo en memoria (ADR 0003).`,
            );
        }
    }
});

/**
 * **The doctor can only narrow, never widen.** There is no way to ask for one more event: the only
 * endpoint serving clinical data is the one already behind the PIN (`open`, in `readerPage.js`),
 * and it delivers the whole package at once. The screen that paints the clipping talks to nobody.
 */
test('the clipping screen has no way of asking for data', () => {
    const code = codeOf('reader/clippingExplorer.js');

    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'new EventSource', 'sendBeacon', '$wire']) {
        assert.equal(
            code.includes(forbidden),
            false,
            `clippingExplorer.js no puede usar ${forbidden}: los subperiodos y la búsqueda trabajan `
                + 'sobre lo que ya está en memoria (ADR 0011).',
        );
    }
});

/**
 * The only two requests of the reader are the two PIN routes. Any third one would be a new way of
 * asking for data, and also a second moment at which this browser ties itself to this link in front
 * of whoever watches the traffic.
 */
test('the reader only calls the two PIN endpoints', () => {
    const source = sourceOf('reader/readerPage.js');
    const calls = [...source.matchAll(/\bfetch\(/g)];

    assert.equal(calls.length, 1, 'readerPage.js tiene un único `fetch`, el de `post()`.');
    assert.match(source, /endpoints\.challenge/);
    assert.match(source, /endpoints\.open/);
});

/**
 * **The search never leaves the browser.** It runs over the already decrypted events, and in the
 * reader there is not even a server it could be sent to: what somebody types searching a history
 * —"hypoglycaemia", a drug name— is a clinical datum in itself.
 */
test('the clipping search is the same as the panel one and runs in memory', () => {
    const source = sourceOf('reader/clippingExplorer.js');

    assert.match(source, /import \{ searchEvents \} from '\.\.\/health\/eventSearch\.js'/);
    assert.match(sourceOf('health/eventSearch.js'), /export function searchEvents/);
    assert.equal(sourceOf('health/eventSearch.js').includes('fetch('), false);
});

/**
 * The reader page is still outside the panel: extracting the shared views cannot have slipped
 * Livewire, Alpine or Filament into a document opened on somebody else's device and with no session.
 */
test('the reader drags nothing of the panel', () => {
    for (const path of READER_SOURCES) {
        const code = codeOf(path);

        /** What matters is what the module depends on, and that is its `import`s. */
        for (const specifier of [...code.matchAll(/from '([^']+)'/g)].map((match) => match[1])) {
            assert.doesNotMatch(
                specifier,
                /livewire|alpine|filament|auth\/keyring|auth\/settings/i,
                `${path} no puede depender de ${specifier}: esta página no tiene sesión (ADR 0011).`,
            );
        }

        assert.equal(code.includes('Alpine.'), false, `${path} no puede tocar Alpine.`);
    }
});


// --- What the screen states -----------------------------------------------------------------------

/**
 * The clipping header describes the whole package and is not repainted; this line describes what
 * is below **now**. Without it, narrowing to seven days left on paper —the controls are not
 * printed— a six-month heading over a seven-day table, with no trace of the filter.
 */
test('viewingText: it states the applied range, the ticked types and what was searched', () => {
    const line = viewingText(
        { from: '2026-07-13T00:00:00.000000Z', to: '2026-07-20T00:00:00.000000Z' },
        ['glucose', 'insulin'],
        { glucose: true, insulin: false },
        '  noche  ',
    );

    assert.match(line, /You are viewing/);
    assert.match(line, /from .* to /);
    assert.match(line, /only /);
    assert.match(line, /\u201cnoche\u201d/);
});

test('viewingText: with no filters it says the whole clipping and every type, and mentions no search', () => {
    const line = viewingText({ from: null, to: null }, ['glucose'], { glucose: true }, '   ');

    assert.match(line, /the whole extract/);
    assert.match(line, /every record type in the extract/);
    assert.doesNotMatch(line, /filtered by/);
});

/**
 * A custom period outside the clipping produced an empty interval: six blank cards, "0 records"
 * and no explanation of a cause fixable in two clicks.
 */
test('clippingSubrange: a period that does not overlap the clipping says so and shows the whole clipping', () => {
    const body = clipping();
    const { range, error } = clippingSubrange({
        preset: 'custom',
        fromDay: '2026-08-01',
        toDay: '2026-08-05',
        bounds: clippingBounds(body),
        events: flattenClippingEvents(body, clippingTypes(body)).events,
    });

    assert.notEqual(error, '');
    assert.match(error, /falls outside this extract/);
    assert.deepEqual(range, clippingBounds(body));
});

/**
 * The glucose unit of the clipping is that of the **majority**, not of the most recent reading:
 * two new readings in another unit cannot send two hundred to a footnote and leave the card
 * summarizing two records as if it summarized the clipping.
 */
test('clippingGlucoseUnit: the majority unit rules, not the most recent one', () => {
    const events = [
        ...Array.from({ length: 10 }, (unused, index) => ({
            type: 'glucose',
            occurredAt: `2026-06-${String(index + 1).padStart(2, '0')}T08:00:00.000000Z`,
            data: { value: '120', unit: 'mg/dL' },
        })),
        {
            type: 'glucose',
            occurredAt: '2026-07-19T08:00:00.000000Z',
            data: { value: '7.4', unit: 'mmol/L' },
        },
    ];

    assert.equal(clippingGlucoseUnit(events), 'mg/dL');
    assert.equal(clippingHasMixedGlucoseUnits(events), true);
    assert.equal(clippingHasMixedGlucoseUnits(events.slice(0, 10)), false);
});

/**
 * An event of a seventh type —a clipping made by a newer version of the panel— has readable
 * content, so it is not "unreadable", and it is not among the offered types, so it passes no
 * filter. Without a bucket of its own it disappeared from everything, clinical table included.
 */
test('flattenClippingEvents: an undeclared type does not disappear, it goes to its own bucket', () => {
    const body = clipping({
        events: [
            {
                occurredAt: '2026-07-01T08:00:00.000000Z',
                content: { v: 1, type: 'glucose', data: { value: '95', unit: 'mg/dL' } },
            },
            {
                occurredAt: '2026-07-02T08:00:00.000000Z',
                content: { v: 1, type: 'oxygenSaturation', data: { value: '97', unit: '%' } },
            },
            { occurredAt: '2026-07-03T08:00:00.000000Z', content: null },
        ],
    });

    const { events, undeclared, unreadable } = flattenClippingEvents(body, clippingTypes(body));

    assert.equal(events.length, 1);
    assert.equal(undeclared.length, 1);
    assert.equal(unreadable.length, 1);
    assert.equal(undeclared[0].content.type, 'oxygenSaturation');
});

/**
 * A clipping declaring no types cannot leave the screen saying "tick at least one" over a panel
 * with no checkbox to tick: the types actually inside are offered.
 */
test('clippingTypes: with no declared types the ones present in the events are offered', () => {
    const body = clipping({ includedTypes: [] });

    assert.deepEqual(clippingTypes(body), ['glucose', 'insulin']);
    assert.deepEqual(clippingTypes({ includedTypes: [], events: [] }), []);
});

// --- Whole mount -----------------------------------------------------------------------------------

/**
 * Minimal `document`, the same pattern as `dashboardPage.test.mjs`: exactly what the painting
 * modules touch. Here it serves for what no pure-function test covers —that the **whole** screen
 * mounts and repaints without blowing up— and to read what it ends up saying, which is what half
 * of this list of fixes is about.
 */
class MountElement {
    constructor(tagName, namespace = null) {
        this.tagName = tagName;
        this.namespace = namespace;
        this.attributes = {};
        this.children = [];
        this.className = '';
        this.textContent = '';
        this.hidden = false;
        this.value = '';
        this.classList = { add: (...names) => { this.className = `${this.className} ${names.join(' ')}`.trim(); } };
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    appendChild(child) {
        this.children.push(child);

        return child;
    }

    replaceChildren(...children) {
        this.children = children;
    }

    addEventListener() {}

    get text() {
        return [this.textContent, ...this.children.map((child) => child.text)].join(' ').trim();
    }
}

/**
 * Mounts the screen and waits for the first `repaint()`, which is async because the data source is.
 *
 * @param {object} body
 * @returns {Promise<{container: MountElement, explorer: object}>}
 */
async function mount(body) {
    globalThis.document = {
        createElement: (tagName) => new MountElement(tagName),
        createElementNS: (namespace, tagName) => new MountElement(tagName, namespace),
        createDocumentFragment: () => new MountElement('#fragment'),
        getElementById: () => null,
    };
    globalThis.window = { matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }) };

    const container = new MountElement('div');
    const explorer = renderClippingExplorer(container, { body, resolved: {}, chartPrefix: 'test' });

    await explorer.repaint();

    return { container, explorer };
}

afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
});

/**
 * The effective-state line is repainted with every change; the clipping header is not. Without it,
 * the paper that ends up in a health record declared the whole clipping over a filtered table, and
 * the controls are not printed to contradict it.
 */
test('the effective-state line is repainted on narrowing; the clipping header stays', async () => {
    const { container, explorer } = await mount(clipping());

    const headerBefore = container.children[0].text;
    const viewing = container.children[2];

    assert.match(viewing.text, /You are viewing/);
    assert.match(viewing.text, /every record type in the extract/);
    /** With declared ends, "the whole clipping" is its dates, said out loud: 20/6 to 20/7. */
    assert.match(viewing.text, /6\/20\/2026/);

    /** It narrows to the last day of the clipping, as the dropdown would. */
    const controls = container.children[1];
    findByTag(controls, 'select')[0].value = 'day';
    await explorer.repaint();

    assert.match(viewing.text, /from .+ to /);
    /** It no longer starts on 20 June: the shortcut counts from the end of the clipping. */
    assert.doesNotMatch(viewing.text, /6\/20\/2026/);
    assert.match(viewing.text, /7\/19\/2026|7\/20\/2026/);
    /** The header still describes the whole package: it is the reference, not the state. */
    assert.equal(container.children[0].text, headerBefore);

    /** And the search box appears in the line as soon as something is typed. */
    findByTag(controls, 'input').at(-1).value = 'noche';
    await explorer.repaint();

    assert.match(viewing.text, /noche/);

    explorer.destroy();
    assert.deepEqual(container.children, []);
});

/**
 * A clipping with a type it does not declare: the event is not unreadable and has no checkbox, so
 * without its own bucket it disappeared from everything. It has to be counted and said.
 */
test('an undeclared type is announced and does not disappear from the screen', async () => {
    const { container } = await mount(clipping({
        events: [
            ...clipping().events,
            {
                occurredAt: '2026-07-18T08:00:00.000000Z',
                content: { v: 1, type: 'oxygenSaturation', data: { value: '97', unit: '%' } },
            },
        ],
    }));

    assert.match(container.text, /a type this extract does not declare/);
    /** And the total count adds them up: 3 of the clipping plus the undeclared one. */
    assert.match(container.text, /of the 4 in this extract/);
});

/**
 * Glucose readings in two units deserve a warning above the card, not a footnote with less visual
 * weight than the number it contradicts.
 */
test('two glucose units are warned about at the top, with the majority one as the clipping unit', async () => {
    const base = clipping();
    const { container } = await mount(clipping({
        events: [
            ...base.events,
            {
                occurredAt: '2026-07-19T23:00:00.000000Z',
                content: { v: 1, type: 'glucose', data: { value: '7.4', unit: 'mmol/L' } },
            },
        ],
    }));

    assert.match(container.text, /recorded in more than one unit/);
    assert.match(container.text, /mg\/dL readings only/);
});

/**
 * The reader emits one block per chart of `CHART_BLOCKS`, with the four identifiers
 * `chartElementIds()` writes under its own prefix.
 *
 * It is what holds the extraction up: the two charts that cross types —the glucose curve with meal
 * and insulin markers and the 24-hour overlay— are not declared here, they are read from the
 * shared list. That is why they appear at once in the patient panel, in the professional's view
 * and in the share preview, which mounts this same module. If somebody added a chart to the panel
 * only, this test would stay green and so would the template one: what this fixes is that whoever
 * iterates the list leaves none out.
 */
test('the reader emits the block of each chart of the shared list, with its four ids', async () => {
    const { container } = await mount(clipping());

    for (const type of CHART_BLOCKS) {
        const ids = chartElementIds(type, 'test');

        assert.ok(findById(container, ids.block) !== null, `falta el bloque de ${type}`);
        assert.ok(findById(container, ids.canvas) !== null, `falta el lienzo de ${type}`);
        assert.ok(findById(container, ids.caption) !== null, `falta el pie de ${type}`);
        assert.ok(findById(container, ids.legend) !== null, `falta la leyenda de ${type}`);
    }

    /** And the canvas carries an accessible name: without it it is a graphical object with no text (Do's #3). */
    const canvas = findById(container, chartElementIds('glucoseContext', 'test').canvas);

    assert.equal(canvas.attributes.role, 'img');
    assert.ok(canvas.attributes['aria-label'].length > 0);
});

/**
 * @param {MountElement} node
 * @param {string} id
 * @returns {MountElement|null}
 */
function findById(node, id) {
    if (node.id === id) {
        return node;
    }

    for (const child of node.children) {
        const found = findById(child, id);

        if (found !== null) {
            return found;
        }
    }

    return null;
}

/**
 * @param {MountElement} node
 * @param {string} tagName
 * @returns {list<MountElement>} The nodes of the subtree with that tag, in document order.
 */
function findByTag(node, tagName) {
    const found = node.tagName === tagName ? [node] : [];

    for (const child of node.children) {
        found.push(...findByTag(child, tagName));
    }

    return found;
}

// --- The perimeter of the reader bundle ------------------------------------------------------------

/**
 * Walks the **transitive** import graph from a Vite entry point.
 *
 * It is the part that was missing. The three tests above look at the **direct** `import`s of four
 * files, and that does not watch a perimeter Vite decides by reachability: it is enough for one of
 * those four to import a module that in turn imports another for Rollup to put the whole chain in
 * the chunk the reader downloads. It really happened: `health/eventSource.js` imported
 * `health/eventEnvelope.js` → `auth/keyring.js`, and the browser of somebody else's clinic ended
 * up running the module that stores the master key in `sessionStorage`, with the tests green.
 *
 * The source is walked and not the `manifest.json` on purpose: the source is always there, and the
 * artefact only exists after `npm run build`. A guard rail that skips itself exactly when a file is
 * missing is precisely the false green this comes to close. And the source graph is what Rollup
 * uses to chunk, so what is unreachable here cannot be there.
 *
 * @param {string} entry Path relative to `resources/js/`.
 * @returns {list<string>} Every reachable module, entry point included.
 */
function reachableModules(entry) {
    const root = new URL('../../resources/js/', import.meta.url);
    const pending = [entry];
    const seen = new Set();

    while (pending.length > 0) {
        const current = pending.pop();

        if (seen.has(current)) {
            continue;
        }

        seen.add(current);

        const code = readFileSync(new URL(current, root), 'utf8');

        for (const match of code.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) {
            /** It is resolved against the current module, which is what the Vite resolver does. */
            const resolved = new URL(match[1], new URL(current, root)).href.slice(root.href.length);

            pending.push(resolved);
        }
    }

    return [...seen];
}

/**
 * **The reader does not download the master key ring, or Livewire, or Alpine.**
 *
 * The page opens on the computer of a clinic nobody in this conversation controls. That the code
 * that knows how to store and open the patient's master key does not even get downloaded is not
 * theatre: while it is in the shared chunk, the invariant "the reader drags nothing of the panel"
 * is true only by convention, and a duplicated panel tab —`sessionStorage` is copied— would put
 * the wrapper of the key and the code able to open it in the same document.
 */
test('the reader bundle does not reach the key ring, or Livewire, or Alpine', () => {
    const reachable = reachableModules('reader.js');

    for (const module of reachable) {
        assert.doesNotMatch(
            module,
            /^auth\/(keyring|settings|context|sessionBootstrap|inactivity)\.js$/,
            `reader.js alcanza ${module}: el lector no puede descargar el llavero (ADR 0011).`,
        );
    }

    for (const module of reachable) {
        const code = codeOf(module);

        for (const forbidden of ['sessionStorage', 'localStorage', 'indexedDB', 'document.cookie', 'Alpine.', 'Livewire.']) {
            assert.equal(
                code.includes(forbidden),
                false,
                `${module}, alcanzable desde reader.js, usa ${forbidden}: el recorte vive solo en memoria (ADR 0011).`,
            );
        }
    }
});

/**
 * The same perimeter, checked over the **artefact** when it exists. It does not replace the test
 * above —`public/build` is not in the repository—, it confirms it: it is the only way to see what
 * the browser really downloads after Rollup has chunked.
 */
test('if there is a build, the reader chunk does not bring the key ring either', { skip: !existsSync(MANIFEST_PATH) }, () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const entry = manifest['resources/js/reader.js'];

    assert.ok(entry !== undefined, 'el manifiesto tiene que declarar la entrada del lector.');

    for (const file of [entry.file, ...(entry.imports ?? []).map((key) => manifest[key].file)]) {
        const bundled = readFileSync(new URL(`../../public/build/${file}`, import.meta.url), 'utf8');

        for (const forbidden of ['phr.rk', 'withMasterKey', 'adoptMasterKey', 'sessionStorage']) {
            assert.equal(
                bundled.includes(forbidden),
                false,
                `${file} contiene ${forbidden}: el paquete del lector arrastra el llavero (ADR 0011).`,
            );
        }
    }
});
