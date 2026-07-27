/**
 * La pantalla de un recorte compartido (`resources/js/reader/clippingExplorer.js`, ADR 0011).
 *
 * Es el módulo que ven las dos puntas de la compartición: el profesional que abre el enlace y el
 * paciente que previsualiza antes de enviarlo. Aquí se comprueban dos cosas distintas:
 *
 * 1. **La lógica pura**: qué periodo se aplica, cómo se aplana el paquete y qué tipos se ofrecen.
 * 2. **Los invariantes de seguridad**, que no son un detalle de implementación sino la razón de que
 *    esta pantalla pueda existir sin cuenta y sin sesión. Se comprueban leyendo el propio código
 *    fuente del lector: no hay forma de escribir una aserción de comportamiento para «no existe
 *    ninguna vía para pedir un evento más», porque lo que hay que demostrar es una **ausencia**.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

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

/** Manifiesto de Vite. Solo existe tras `npm run build`, y no está en el repositorio. */
const MANIFEST_PATH = new URL('../../public/build/manifest.json', import.meta.url);

/**
 * Un recorte como el que arma `buildSharePackageBody()`: eventos con `occurredAt` y `content`, el
 * rango declarado, el recuento y las dos listas de tipos.
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

// --- Acotar, jamás ampliar -----------------------------------------------------------------------

/**
 * El invariante central del lector: el profesional puede estrechar lo que mira dentro del recorte,
 * y no hay forma de que pida un solo día más de historial del que el paciente decidió compartir.
 */
test('narrowToClipping: un periodo más ancho que el recorte se corta a los extremos del recorte', () => {
    const bounds = clippingBounds(clipping());

    const widened = narrowToClipping(
        { from: '2020-01-01T00:00:00.000000Z', to: '2030-01-01T00:00:00.000000Z' },
        bounds,
    );

    assert.deepEqual(widened, bounds);
});

test('narrowToClipping: un periodo abierto por los dos lados se queda en el recorte entero', () => {
    const bounds = clippingBounds(clipping());

    assert.deepEqual(narrowToClipping({ from: null, to: null }, bounds), bounds);
});

test('narrowToClipping: un periodo más estrecho sí se respeta, que es para lo que existe', () => {
    const bounds = clippingBounds(clipping());
    const inner = { from: '2026-07-01T00:00:00.000000Z', to: '2026-07-10T00:00:00.000000Z' };

    assert.deepEqual(narrowToClipping(inner, bounds), inner);
});

/**
 * Con un recorte sin extremos declarados no hay nada que cortar, y tampoco hace falta: el origen de
 * datos es la lista que ya está en memoria, así que un rango abierto no amplía nada.
 */
test('narrowToClipping: sin extremos declarados, lo pedido pasa tal cual', () => {
    const asked = { from: '2026-01-01T00:00:00.000000Z', to: null };

    assert.deepEqual(narrowToClipping(asked, { from: null, to: null }), asked);
});

/**
 * Los atajos cuentan desde el final del recorte y no desde el reloj de hoy. Con «hoy», un recorte
 * generado la semana pasada saldría vacío al pulsar «último día», y una pantalla vacía en consulta
 * se lee como «este paciente no tiene registros».
 */
test('clippingEnd: el final del recorte es el declarado, no el instante actual', () => {
    const body = clipping();

    assert.equal(clippingEnd(clippingBounds(body), []).toISOString(), '2026-07-20T00:00:00.000Z');
});

test('clippingEnd: sin extremo declarado, el registro más reciente del propio recorte', () => {
    const body = clipping({ range: { from: null, to: null } });
    const { events } = flattenClippingEvents(body);

    /** El `+1` deja dentro al propio evento, que es el que se quiere ver. */
    assert.equal(clippingEnd(clippingBounds(body), events).toISOString(), '2026-07-19T22:00:00.001Z');
});

test('clippingSubrange: «último día» se cuenta desde el final del recorte y sale dentro de él', () => {
    const body = clipping();
    const { events } = flattenClippingEvents(body);

    const { range, error } = clippingSubrange({ preset: 'day', bounds: clippingBounds(body), events });

    assert.equal(error, '');
    assert.equal(range.from, '2026-07-19T00:00:00.000000Z');
    /** La punta superior la pone el recorte: el atajo la deja abierta y aquí no puede estarlo. */
    assert.equal(range.to, '2026-07-20T00:00:00.000000Z');
});

/**
 * Un rango a medida que se sale del recorte se acepta y se recorta, en vez de rechazarse: quien lo
 * teclea está pidiendo «todo lo que haya por aquí», y darle el recorte entero es la respuesta
 * honesta. Lo que no puede pasar es que se enseñe algo de fuera, porque no hay nada de fuera.
 */
test('clippingSubrange: un rango a medida que desborda el recorte se recorta a él', () => {
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
 * Un rango mal tecleado no deja la pantalla en blanco: se devuelve el recorte entero y el porqué,
 * que quien llama pinta como aviso. En una consulta, una pantalla vacía sin explicación es peor que
 * un periodo más ancho del que se pidió.
 */
test('clippingSubrange: un rango incompleto devuelve el recorte entero y un motivo', () => {
    const bounds = clippingBounds(clipping());

    const { range, error } = clippingSubrange({ preset: 'custom', fromDay: '2026-07-01', toDay: '', bounds, events: [] });

    assert.deepEqual(range, bounds);
    assert.notEqual(error, '');
});

// --- Aplanado del paquete ------------------------------------------------------------------------

test('flattenClippingEvents: el contenido y la fecha quedan al mismo nivel, como espera statistics.js', () => {
    const { events, unreadable } = flattenClippingEvents(clipping());

    assert.equal(events.length, 3);
    assert.equal(unreadable.length, 0);
    assert.equal(events[0].type, 'glucose');
    assert.equal(events[0].occurredAt, '2026-06-21T08:00:00.000000Z');
    assert.equal(events[0].data.value, '95');
});

/**
 * ADR 0004: un registro que no se puede leer se cuenta y se enseña, nunca se traga. En un recorte
 * que va a leer otra persona, un registro que falta es indistinguible de un registro que no existió,
 * y esa diferencia es clínica.
 */
test('flattenClippingEvents: un evento sin contenido legible se aparta, no desaparece', () => {
    const body = clipping();
    body.events.push({ occurredAt: '2026-07-19T23:00:00.000000Z', content: null });
    body.events.push({ occurredAt: '2026-07-19T23:30:00.000000Z', content: { v: 1, data: {} } });

    const { events, unreadable } = flattenClippingEvents(body);

    assert.equal(events.length, 3);
    assert.equal(unreadable.length, 2);
});

// --- Tipos y unidades ----------------------------------------------------------------------------

/**
 * Solo se ofrecen las casillas de los tipos que el recorte incluye. Ofrecer «Comidas» en un recorte
 * donde el paciente decidió no compartirlas invitaría a marcarla y a concluir, del silencio, que no
 * come. Lo que se dejó fuera se dice en la cabecera, con esas palabras.
 */
test('clippingTypes: solo los tipos incluidos, en el orden del catálogo', () => {
    assert.deepEqual(clippingTypes(clipping()), ['glucose', 'insulin']);
});

/**
 * La unidad de presentación del paciente es configuración cifrada suya (ADR 0007) y no viaja en el
 * recorte, así que la unidad sale de las propias lecturas: si midió en mmol/L, en mmol/L se lee.
 */
test('clippingGlucoseUnit: la unidad sale de las lecturas del recorte, no de ningún ajuste', () => {
    const body = clipping();
    body.events[1].content.data.unit = 'mmol/L';
    body.events[0].content.data.unit = 'mmol/L';

    assert.equal(clippingGlucoseUnit(flattenClippingEvents(body).events), 'mmol/L');
});

test('clippingGlucoseUnit: sin ninguna glucemia, mg/dL', () => {
    assert.equal(clippingGlucoseUnit([]), 'mg/dL');
});

// --- Invariantes de seguridad, comprobados sobre el propio código ---------------------------------

/**
 * @param {string} relativePath
 * @returns {string}
 */
function sourceOf(relativePath) {
    return readFileSync(fileURLToPath(new URL(`../../resources/js/${relativePath}`, import.meta.url)), 'utf8');
}

/**
 * El código de un módulo **sin sus comentarios**.
 *
 * Hace falta porque estos ficheros documentan sus propias prohibiciones con las mismas palabras
 * («no se escribe en `localStorage`»), y un buscador ingenuo daría por infringida justo la regla que
 * el comentario está prometiendo cumplir.
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
 * Los tres ficheros que componen la pantalla del profesional. Si algún día aparece un cuarto, tiene
 * que entrar en esta lista: es el perímetro que estas comprobaciones vigilan.
 */
const READER_SOURCES = Object.freeze([
    'reader.js',
    'reader/readerPage.js',
    'reader/clippingExplorer.js',
    'reader/clinicalReport.js',
]);

/**
 * **El paquete descifrado vive solo en memoria.** Cerrar la pestaña lo borra, igual que la clave
 * maestra del paciente (ADR 0003). Escribirlo en `localStorage` o en IndexedDB lo dejaría en el disco
 * de un ordenador de consulta que usan varias personas y que nadie de esta conversación controla, y
 * ahí sobreviviría a la caducidad del enlace, que es lo único que este diseño puede prometer.
 *
 * Se comprueba también sobre la búsqueda y el subperiodo: guardar «lo último que buscaste» sería el
 * mismo rastro clínico por otra puerta.
 */
test('el lector no escribe nada en el dispositivo: ni almacenamiento, ni cookies', () => {
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
 * **El médico solo puede acotar, jamás ampliar.** No hay ninguna vía para pedir un evento más: el
 * único endpoint que sirve datos clínicos es el que ya está tras el PIN (`open`, en `readerPage.js`),
 * y entrega el paquete entero de una vez. La pantalla que pinta el recorte no habla con nadie.
 */
test('la pantalla del recorte no tiene ninguna vía para pedir datos', () => {
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
 * Las dos únicas peticiones del lector son las dos rutas del PIN. Cualquier tercera sería una vía
 * nueva por la que pedir datos, y además un segundo momento en el que este navegador se ata a este
 * enlace ante quien mire el tráfico.
 */
test('el lector solo llama a los dos endpoints del PIN', () => {
    const source = sourceOf('reader/readerPage.js');
    const calls = [...source.matchAll(/\bfetch\(/g)];

    assert.equal(calls.length, 1, 'readerPage.js tiene un único `fetch`, el de `post()`.');
    assert.match(source, /endpoints\.challenge/);
    assert.match(source, /endpoints\.open/);
});

/**
 * **La búsqueda nunca sale del navegador.** Corre sobre los eventos ya descifrados, y en el lector no
 * hay ni siquiera un servidor al que pudiera mandarse: lo que alguien teclea buscando en un historial
 * —«hipoglucemia», el nombre de un fármaco— es un dato clínico por sí mismo.
 */
test('la búsqueda del recorte es la misma del panel y corre en memoria', () => {
    const source = sourceOf('reader/clippingExplorer.js');

    assert.match(source, /import \{ searchEvents \} from '\.\.\/health\/eventSearch\.js'/);
    assert.match(sourceOf('health/eventSearch.js'), /export function searchEvents/);
    assert.equal(sourceOf('health/eventSearch.js').includes('fetch('), false);
});

/**
 * La página del lector sigue fuera del panel: extraer las vistas compartidas no puede haber colado
 * Livewire, Alpine ni Filament en un documento que se abre en un dispositivo ajeno y sin sesión.
 */
test('el lector no arrastra nada del panel', () => {
    for (const path of READER_SOURCES) {
        const code = codeOf(path);

        /** Lo que importa es de qué depende el módulo, y eso son sus `import`. */
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


// --- Lo que la pantalla afirma -------------------------------------------------------------------

/**
 * La cabecera del recorte describe el paquete entero y no se repinta; esta línea describe lo que hay
 * debajo **ahora**. Sin ella, acotar a siete días dejaba en papel —los controles no se imprimen— un
 * encabezado de seis meses sobre una tabla de siete días, sin ninguna huella del filtro.
 */
test('viewingText: declara el rango aplicado, los tipos marcados y lo buscado', () => {
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

test('viewingText: sin filtros dice el recorte entero y todos los tipos, y no menciona búsqueda', () => {
    const line = viewingText({ from: null, to: null }, ['glucose'], { glucose: true }, '   ');

    assert.match(line, /the whole extract/);
    assert.match(line, /every record type in the extract/);
    assert.doesNotMatch(line, /filtered by/);
});

/**
 * Un periodo a medida fuera del recorte producía un intervalo vacío: seis tarjetas en blanco, «0
 * registros» y ninguna explicación de una causa que se arregla en dos clics.
 */
test('clippingSubrange: un periodo que no solapa con el recorte lo dice y enseña el recorte entero', () => {
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
 * La unidad de glucemia del recorte es la de la **mayoría**, no la de la lectura más reciente: dos
 * lecturas nuevas en otra unidad no pueden mandar a doscientas a una nota al pie y dejar la tarjeta
 * resumiendo dos registros como si resumiera el recorte.
 */
test('clippingGlucoseUnit: manda la unidad mayoritaria, no la más reciente', () => {
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
 * Un evento de un séptimo tipo —recorte hecho por una versión más nueva del panel— tiene contenido
 * legible, así que no es «ilegible», y no está entre los tipos ofrecidos, así que no pasa ningún
 * filtro. Sin un cubo propio desaparecía de todo, tabla clínica incluida.
 */
test('flattenClippingEvents: un tipo no declarado no desaparece, va a su propio cubo', () => {
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
 * Un recorte que no declara tipos no puede dejar la pantalla diciendo «marca al menos uno» sobre un
 * panel sin ninguna casilla que marcar: se ofrecen los tipos que de verdad hay dentro.
 */
test('clippingTypes: sin tipos declarados se ofrecen los que hay en los eventos', () => {
    const body = clipping({ includedTypes: [] });

    assert.deepEqual(clippingTypes(body), ['glucose', 'insulin']);
    assert.deepEqual(clippingTypes({ includedTypes: [], events: [] }), []);
});

// --- Montaje entero ------------------------------------------------------------------------------

/**
 * `document` mínimo, el mismo patrón que `dashboardPage.test.mjs`: lo justo que tocan los módulos de
 * pintado. Aquí sirve para lo que ningún test de función pura cubre —que la pantalla **entera** se
 * monte y se repinte sin reventar— y para leer lo que acaba diciendo, que es de lo que va la mitad
 * de esta lista de arreglos.
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
 * Monta la pantalla y espera al primer `repaint()`, que es asíncrono porque el origen de datos lo es.
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
 * La línea de estado efectivo se repinta con cada cambio; la cabecera del recorte no. Sin ella, el
 * papel que acaba en una historia clínica declaraba el recorte entero sobre una tabla filtrada, y los
 * controles no se imprimen para desmentirlo.
 */
test('la línea de estado efectivo se repinta al acotar; la cabecera del recorte se queda', async () => {
    const { container, explorer } = await mount(clipping());

    const headerBefore = container.children[0].text;
    const viewing = container.children[2];

    assert.match(viewing.text, /You are viewing/);
    assert.match(viewing.text, /every record type in the extract/);
    /** Con extremos declarados, «todo el recorte» son sus fechas, dichas: 20/6 a 20/7. */
    assert.match(viewing.text, /6\/20\/2026/);

    /** Se acota al último día del recorte, como haría el desplegable. */
    const controls = container.children[1];
    findByTag(controls, 'select')[0].value = 'day';
    await explorer.repaint();

    assert.match(viewing.text, /from .+ to /);
    /** Ya no empieza el 20 de junio: el atajo cuenta desde el final del recorte. */
    assert.doesNotMatch(viewing.text, /6\/20\/2026/);
    assert.match(viewing.text, /7\/19\/2026|7\/20\/2026/);
    /** La cabecera sigue describiendo el paquete entero: es la referencia, no el estado. */
    assert.equal(container.children[0].text, headerBefore);

    /** Y el buscador aparece en la línea en cuanto hay algo tecleado. */
    findByTag(controls, 'input').at(-1).value = 'noche';
    await explorer.repaint();

    assert.match(viewing.text, /noche/);

    explorer.destroy();
    assert.deepEqual(container.children, []);
});

/**
 * Un recorte con un tipo que no declara: el evento no es ilegible y no tiene casilla, así que sin su
 * propio cubo desaparecía de todo. Tiene que quedar contado y dicho.
 */
test('un tipo no declarado se anuncia y no desaparece de la pantalla', async () => {
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
    /** Y el recuento total los suma: 3 del recorte más el no declarado. */
    assert.match(container.text, /of the 4 in this extract/);
});

/**
 * Las glucemias en dos unidades merecen un aviso por encima de la tarjeta, no una nota al pie con
 * menos peso visual que el número al que desmiente.
 */
test('dos unidades de glucemia se advierten arriba, con la mayoritaria como unidad del recorte', async () => {
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
 * @param {MountElement} node
 * @param {string} tagName
 * @returns {list<MountElement>} Los nodos del subárbol con esa etiqueta, en orden de documento.
 */
function findByTag(node, tagName) {
    const found = node.tagName === tagName ? [node] : [];

    for (const child of node.children) {
        found.push(...findByTag(child, tagName));
    }

    return found;
}

// --- El perímetro del paquete del lector ---------------------------------------------------------

/**
 * Recorre el grafo de importaciones **transitivo** desde una entrada de Vite.
 *
 * Es la parte que faltaba. Los tres tests de arriba miran los `import` **directos** de cuatro
 * ficheros, y eso no vigila un perímetro que Vite decide por alcanzabilidad: basta con que uno de
 * esos cuatro importe un módulo que a su vez importe otro para que Rollup meta la cadena entera en
 * el trozo que descarga el lector. Pasó de verdad: `health/eventSource.js` importaba
 * `health/eventEnvelope.js` → `auth/keyring.js`, y el navegador de una consulta ajena acababa
 * ejecutando el módulo que guarda la clave maestra en `sessionStorage`, con los tests en verde.
 *
 * Se recorre el fuente y no el `manifest.json` a propósito: el fuente está siempre ahí, y el
 * artefacto solo existe después de `npm run build`. Un guardarraíl que se salta solo cuando falta un
 * fichero es exactamente el falso verde que esto viene a cerrar. Y el grafo del fuente es lo que
 * Rollup usa para trocear, así que lo que no es alcanzable aquí no puede estar allí.
 *
 * @param {string} entry Ruta relativa a `resources/js/`.
 * @returns {list<string>} Todos los módulos alcanzables, incluida la entrada.
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
            /** Se resuelve contra el módulo actual, que es lo que hace el resolvedor de Vite. */
            const resolved = new URL(match[1], new URL(current, root)).href.slice(root.href.length);

            pending.push(resolved);
        }
    }

    return [...seen];
}

/**
 * **El lector no descarga el llavero de la clave maestra, ni Livewire, ni Alpine.**
 *
 * La página se abre en el ordenador de una consulta que nadie de esta conversación controla. Que el
 * código que sabe guardar y abrir la clave maestra del paciente no llegue siquiera a descargarse no
 * es teatro: mientras esté en el trozo compartido, el invariante «el lector no arrastra nada del
 * panel» es cierto solo por convención, y una pestaña duplicada del panel —`sessionStorage` se
 * copia— pondría el envoltorio de la clave y el código capaz de abrirlo en el mismo documento.
 */
test('el paquete del lector no alcanza el llavero, ni Livewire, ni Alpine', () => {
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
 * El mismo perímetro, comprobado sobre el **artefacto** cuando existe. No sustituye al test de
 * arriba —`public/build` no está en el repositorio—, lo confirma: es la única forma de ver lo que de
 * verdad descarga el navegador después de que Rollup haya troceado.
 */
test('si hay build, el trozo del lector tampoco trae el llavero', { skip: !existsSync(MANIFEST_PATH) }, () => {
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
