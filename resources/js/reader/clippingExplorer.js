/**
 * La interfaz de un recorte ya descifrado (ADR 0011, ADR 0002, ADR 0004, ADR 0006).
 *
 * **Qué es.** El profesional que abre un enlace compartido ve lo mismo que ve el paciente en su
 * panel —gráficas, estadísticas, línea temporal, búsqueda y selección de subperiodos— sobre los
 * eventos del recorte. Este módulo es esa pantalla: recibe el cuerpo en claro del paquete y un
 * contenedor, y lo pinta entero. No sabe de dónde salió el paquete, y por eso vale igual para el
 * lector del profesional (donde el paquete viene del PIN) y para la vista previa de la pantalla de
 * compartir (donde el paciente ve, antes de enviar nada, exactamente lo que verá el médico).
 *
 * **Los tres invariantes de seguridad que este módulo tiene que cumplir**, y que
 * `tests/js/clippingExplorer.test.mjs` comprueba:
 *
 * 1. **Acotar, jamás ampliar.** El subperiodo y la búsqueda trabajan contra
 *    {@see memoryEventSource}, que solo puede devolver eventos de la lista que ya tiene delante.
 *    No hay aquí ni un `fetch`, ni un `$wire`, ni una URL: no existe la vía para pedir un evento
 *    más, y el rango elegido se corta además contra los extremos del recorte
 *    ({@see narrowToClipping}) para que ni siquiera se pueda *decir* un periodo mayor.
 * 2. **El paquete vive solo en memoria.** No se escribe en `localStorage`, ni en `sessionStorage`,
 *    ni en IndexedDB, ni en una cookie. Cerrar la pestaña lo borra, igual que la clave maestra del
 *    paciente (ADR 0003). Tampoco se guarda la preferencia de idioma, ni el subperiodo, ni el texto
 *    buscado: en un ordenador de consulta, cualquiera de esas tres cosas es un rastro clínico que
 *    sobrevive a quien lo dejó.
 * 3. **La búsqueda no sale del navegador.** Corre entera sobre lo descifrado
 *    ({@see searchEvents}); lo tecleado no viaja a ninguna parte, y en el lector no hay ninguna
 *    parte a la que pudiera viajar.
 *
 * **Sin Livewire y sin Alpine**, y no por gusto: todo lo que toca una propiedad pública de Livewire
 * acaba en su snapshot, que viaja al servidor y se queda ahí (ADR 0002, con
 * `App\Livewire\Hooks\EncryptedPayloadGuardHook` y los tests de arquitectura vigilándolo). Además el
 * lector no tiene sesión. Los controles son DOM corriente con `addEventListener`, que es lo que
 * hace que este módulo se pueda montar en las dos pantallas sin arrastrar nada del panel.
 *
 * **Lo que se conserva del informe estático anterior**, porque era lo mejor que tenía: la cabecera
 * con «N eventos, del X al Y, generado el Z» —que es lo único que permite ver que un recorte llegó
 * truncado— y la tabla clínica con el término oficial LOINC, que no se traduce (ADR 0005) y que es
 * lo que acaba copiado en una historia clínica de papel.
 */

import { formatDateTime, joinList, t } from '../i18n/index.js';
import { chartElementIds, CHART_SECTIONS, destroyCharts, renderCharts } from '../health/chartsView.js';
import { observeColorSchemeChange } from '../health/chartTheme.js';
import { customRange, DateRangeError, presetRange } from '../health/dateRange.js';
import { typeLabel } from '../health/eventLabels.js';
import { searchEvents } from '../health/eventSearch.js';
import { flattenDecryptedEvent, memoryEventSource } from '../health/eventSource.js';
import { EVENT_TYPES, filterBySelectedTypes } from '../health/eventTypes.js';
import { createCallout } from '../health/eventVisuals.js';
import { majorityUnit, unitCount } from '../health/statistics.js';
import { renderStatsSections } from '../health/statsView.js';
import { renderTimelineSection } from '../health/timelineView.js';
import { describeEvent, reportHeadline, typeSummary } from './clinicalReport.js';

/**
 * Unidad con la que se enseñan las glucemias cuando el recorte no trae ninguna.
 *
 * **La unidad de presentación del paciente no viaja en el recorte, y es deliberado**: es
 * configuración cifrada suya (ADR 0007) y no dice nada clínico que el médico necesite. Así que la
 * unidad sale de las propias lecturas ({@see clippingGlucoseUnit}), que es el dato de verdad: si midió en
 * mmol/L, en mmol/L se lee.
 */
const DEFAULT_GLUCOSE_UNIT = 'mg/dL';

/** Atajos de subperiodo, todos relativos al **final del recorte**, nunca al reloj de hoy. */
export const CLIP_RANGE_PRESETS = Object.freeze(['all', 'day', 'week', 'month', 'custom']);

/**
 * Los dos extremos del recorte, tal como los declara su propio cuerpo.
 *
 * Es el techo de todo lo que esta pantalla puede enseñar. Un extremo `null` es un extremo abierto
 * («desde siempre», «hasta el final»), y no hay que rellenarlo: el origen de datos es la lista que
 * ya está en memoria, así que un rango abierto no amplía nada, solo deja de recortar.
 *
 * @param {object} body Cuerpo en claro del paquete.
 * @returns {{from: string|null, to: string|null}}
 */
export function clippingBounds(body) {
    return {
        from: typeof body?.range?.from === 'string' ? body.range.from : null,
        to: typeof body?.range?.to === 'string' ? body.range.to : null,
    };
}

/**
 * @param {string|null} value
 * @returns {number} `NaN` si no se puede leer, que aquí siempre significa «no acota».
 */
function instantOf(value) {
    return typeof value === 'string' ? Date.parse(value) : NaN;
}

/**
 * Intersección de lo pedido con lo que el recorte contiene: **el resultado nunca es más ancho que
 * los extremos del recorte**.
 *
 * Esta función es la mitad declarativa del invariante «acotar, jamás ampliar». La otra mitad es
 * estructural y más fuerte: aunque esto devolviera un rango de diez años, {@see memoryEventSource}
 * seguiría sin tener de dónde sacar un evento que no esté en el paquete. Las dos existen porque la
 * primera es la que hace que la pantalla no *afirme* cubrir un periodo que no cubre.
 *
 * @param {{from: string|null, to: string|null}} range Lo que se ha pedido.
 * @param {{from: string|null, to: string|null}} bounds Salida de {@see clippingBounds}.
 * @returns {{from: string|null, to: string|null}}
 */
export function narrowToClipping(range, bounds) {
    const requestedFrom = instantOf(range?.from ?? null);
    const boundFrom = instantOf(bounds?.from ?? null);
    const requestedTo = instantOf(range?.to ?? null);
    const boundTo = instantOf(bounds?.to ?? null);

    return {
        from: Number.isNaN(boundFrom) || (!Number.isNaN(requestedFrom) && requestedFrom > boundFrom)
            ? (range?.from ?? null)
            : bounds.from,
        to: Number.isNaN(boundTo) || (!Number.isNaN(requestedTo) && requestedTo < boundTo)
            ? (range?.to ?? null)
            : bounds.to,
    };
}

/**
 * Instante desde el que cuentan los atajos relativos: el final del recorte.
 *
 * **No es «ahora», y esa es toda la gracia.** Un recorte generado hace una semana con «último día»
 * contado desde hoy saldría vacío, y una pantalla vacía se lee como «este paciente no tiene
 * registros». Contando desde el final del recorte, «último día» es el último día *del recorte*, que
 * es lo que quiere decir quien lo pulsa.
 *
 * @param {{from: string|null, to: string|null}} bounds
 * @param {list<{occurredAt?: string}>} events
 * @returns {Date}
 */
export function clippingEnd(bounds, events) {
    const declaredEnd = instantOf(bounds?.to ?? null);

    if (!Number.isNaN(declaredEnd)) {
        return new Date(declaredEnd);
    }

    /** Sin extremo declarado, el registro más reciente; el `+1` deja el propio evento dentro. */
    let newest = -Infinity;

    for (const event of events) {
        const occurredMs = instantOf(event?.occurredAt ?? null);

        if (!Number.isNaN(occurredMs) && occurredMs > newest) {
            newest = occurredMs;
        }
    }

    return newest === -Infinity ? new Date() : new Date(newest + 1);
}

/**
 * El subperiodo que toca aplicar, ya acotado al recorte.
 *
 * Un rango mal tecleado **no deja la pantalla en blanco**: devuelve el recorte entero y el porqué
 * en `error`, que quien llama pinta como aviso. En una consulta, una pantalla vacía sin explicación
 * es peor que un periodo más ancho del que se pidió.
 *
 * @param {object} params
 * @param {string} params.preset Uno de {@see CLIP_RANGE_PRESETS}.
 * @param {string} [params.fromDay] `YYYY-MM-DD`, solo con `custom`.
 * @param {string} [params.toDay] `YYYY-MM-DD`, solo con `custom`.
 * @param {{from: string|null, to: string|null}} params.bounds
 * @param {list<object>} params.events
 * @returns {{range: {from: string|null, to: string|null}, error: string}}
 */
export function clippingSubrange({ preset, fromDay, toDay, bounds, events }) {
    try {
        const requested = preset === 'custom'
            ? customRange(fromDay, toDay)
            : presetRange(preset, clippingEnd(bounds, events));

        const range = narrowToClipping(requested, bounds);

        /**
         * Un periodo que no solapa con el recorte —«del 1 al 5 de julio» sobre un recorte de junio—
         * sale de la intersección como un intervalo vacío o invertido. Sin esta comprobación la
         * pantalla se queda con seis tarjetas vacías y ni un aviso: el recuento diría «0 registros»
         * y la causa, que se arregla en dos clics, no estaría escrita en ninguna parte.
         */
        if (instantOf(range.from) >= instantOf(range.to)) {
            return {
                range: { ...bounds },
                error: t('clip.range.outside', {
                    from: formatDateTime(bounds.from),
                    to: formatDateTime(bounds.to),
                }),
            };
        }

        return { range, error: '' };
    } catch (failure) {
        return {
            range: { ...bounds },
            error: failure instanceof DateRangeError ? failure.message : t('range.error.badDate'),
        };
    }
}

/**
 * Aplana los eventos del paquete a la forma que esperan las vistas (`{...content, occurredAt}`), y
 * cuenta los que no tienen esa forma.
 *
 * **Un evento ilegible no desaparece**: sale del recuento aquí y quien llama lo dice en voz alta y
 * lo sigue enseñando en la tabla clínica, con su fecha (ADR 0004). En un recorte que va a leer otra
 * persona, un registro que falta es indistinguible de un registro que no existió, y esa diferencia
 * es clínica.
 *
 * **Y tampoco desaparece un evento de un tipo que este recorte no declara.** Un recorte generado por
 * una versión más nueva del panel puede traer un séptimo tipo: su contenido se lee, así que no es
 * ilegible, pero no está entre los tipos ofrecidos y por tanto no pasa ningún filtro. Sin este tercer
 * cubo se caía de las gráficas, de las estadísticas, de la línea temporal **y de la tabla clínica**,
 * sin aparecer en ningún recuento, que es una regresión respecto al informe estático que sí lo
 * pintaba como fila «no se entiende».
 *
 * @param {object} body Cuerpo en claro del paquete.
 * @param {list<string>} types Tipos que la pantalla ofrece ({@see clippingTypes}).
 * @returns {{events: list<object>, raws: list<object>, unreadable: list<object>,
 *           undeclared: list<object>}}
 */
export function flattenClippingEvents(body, types = EVENT_TYPES) {
    const packaged = Array.isArray(body?.events) ? body.events : [];
    const events = [];
    const raws = [];
    const unreadable = [];
    const undeclared = [];

    for (const raw of packaged) {
        const content = raw?.content;

        if (content === null || typeof content !== 'object' || typeof content.type !== 'string') {
            unreadable.push(raw);

            continue;
        }

        if (!types.includes(content.type)) {
            undeclared.push(raw);

            continue;
        }

        events.push(flattenDecryptedEvent({ occurredAt: raw.occurredAt }, content));
        raws.push(raw);
    }

    return { events, raws, unreadable, undeclared };
}

/**
 * Tipos que este recorte declara incluir, en el orden de {@see EVENT_TYPES}.
 *
 * Las casillas se pintan **solo** para esos tipos: ofrecer «Comidas» en un recorte donde el paciente
 * decidió no compartirlas invitaría a marcarla y a concluir, del silencio, que no come. Lo que se
 * dejó fuera se dice aparte, en la cabecera, con esas palabras.
 *
 * **Si el recorte no declara ningún tipo pero trae eventos**, se ofrecen los tipos que de verdad hay
 * dentro y se dice que el recorte no los declara ({@see renderClippingExplorer}). Lo otro era dejar
 * la pantalla diciendo «marca al menos un tipo» sobre un panel sin ninguna casilla que marcar: un
 * callejón sin salida sobre datos que sí están.
 *
 * @param {object} body
 * @returns {list<string>}
 */
export function clippingTypes(body) {
    const included = Array.isArray(body?.includedTypes) ? body.includedTypes : [];
    const declared = EVENT_TYPES.filter((type) => included.includes(type));

    if (declared.length > 0) {
        return declared;
    }

    const present = new Set(
        (Array.isArray(body?.events) ? body.events : [])
            .map((raw) => raw?.content?.type)
            .filter((type) => typeof type === 'string'),
    );

    return EVENT_TYPES.filter((type) => present.has(type));
}

/**
 * Unidad con la que se enseñan las glucemias del recorte: la de la **mayoría** de las lecturas.
 *
 * Se eligió por mayoría y no por recencia ({@see majorityUnit} frente a `dominantUnit`) porque aquí
 * quien lee no sabe si el paciente acaba de cambiar de medidor. Con la unidad de la última lectura,
 * dos lecturas nuevas en mmol/L mandan doscientas en mg/dL a una nota al pie y el resumen de la
 * tarjeta describe a dos registros, no al recorte.
 *
 * @param {list<object>} events
 * @returns {string}
 */
export function clippingGlucoseUnit(events) {
    return majorityUnit(events, 'glucose', 'value') ?? DEFAULT_GLUCOSE_UNIT;
}

/**
 * ¿Hay glucemias en más de una unidad?
 *
 * Cuando las hay, el número de la tarjeta describe a una parte del recorte y hace falta decirlo
 * arriba, con peso de aviso: la nota de excluidos que ya pinta `statsView.js` va en `text-caption`,
 * es decir con menos peso visual que el número al que desmiente.
 *
 * @param {list<object>} events
 * @returns {boolean}
 */
export function clippingHasMixedGlucoseUnits(events) {
    return unitCount(events, 'glucose', 'value') > 1;
}

// --- Pintado -------------------------------------------------------------------------------------

/** @param {string} tagName @param {string} className @param {string} [text] */
function element(tagName, className, text) {
    const node = document.createElement(tagName);

    node.className = className;

    if (text !== undefined) {
        node.textContent = text;
    }

    return node;
}

/**
 * Tarjeta con título, del mismo juego que las del panel (DESIGN.md § Cards).
 *
 * @param {string} title
 * @returns {{card: HTMLElement, body: HTMLElement}}
 */
function card(title) {
    const node = element('section', 'rounded-card border border-border bg-surface p-card shadow-sm');

    node.appendChild(element('h2', 'font-display text-subhead text-ink', title));

    const body = element('div', 'mt-4');
    node.appendChild(body);

    return { card: node, body };
}

/**
 * Cabecera obligatoria del recorte: cuántos eventos, de cuándo a cuándo y cuándo se generó, más las
 * dos listas de tipos.
 *
 * **Se enseña siempre y no se pliega.** Es la referencia contra la que se lee todo lo de abajo: sin
 * ella, un recorte al que le falte la peor semana se lee como un historial completo. Y los tipos
 * excluidos se dicen en voz alta porque una ausencia se lee como un cero clínico.
 *
 * @param {object} resolved Vocabulario ya resuelto ({@see resolveCatalog}).
 * @param {object} body
 * @returns {HTMLElement}
 */
export function renderClippingHeader(resolved, body) {
    const headline = reportHeadline(body);
    const types = typeSummary(resolved, body);

    const section = element('section', 'rounded-card border border-border bg-surface p-card shadow-sm');
    section.appendChild(element('h2', 'font-display text-headline text-ink', headline.count));

    for (const line of [headline.range, headline.generatedAt, types.included, types.excluded]) {
        if (line === null) {
            continue;
        }

        section.appendChild(element('p', 'mt-1 text-body text-ink-secondary', line));
    }

    section.appendChild(element('p', 'mt-3 text-body-sm text-ink-secondary', t('reader.header.snapshot')));

    return section;
}

/**
 * La segunda línea de la cabecera: **qué se está mirando ahora mismo**, después de acotar.
 *
 * La cabecera del recorte se pinta una vez y describe el paquete entero, que es su función: es la
 * referencia contra la que se ve que un recorte llegó truncado. Pero mientras fue lo único, acotar a
 * siete días y desmarcar la tensión dejaba en pantalla —y sobre todo **en papel**, porque los
 * controles llevan `data-phr-reader-screen-only` y no se imprimen— un encabezado que declaraba seis
 * meses y todos los tipos encima de una tabla de siete días filtrada. La defensa contra un historial
 * truncado se convertía en la causa del error.
 *
 * Por eso esta línea se repinta en cada `repaint()` y **sí se imprime**: dice el rango realmente
 * aplicado, los tipos marcados y el texto buscado. La de arriba dice qué hay en el recorte; esta
 * dice qué hay debajo.
 *
 * @param {{from: string|null, to: string|null}} range Rango ya acotado ({@see clippingSubrange}).
 * @param {list<string>} types Todos los tipos que ofrece el recorte.
 * @param {Record<string, boolean>} selected
 * @param {string} query Texto buscado.
 * @returns {string}
 */
export function viewingText(range, types, selected, query) {
    /**
     * El rango se compone aquí y no con `rangeText`: aquella frase está escrita para la cabecera
     * («Cubriendo del X al Y») y esta habla en presente («del X al Y»). Lo que sí se copia de ella
     * es el criterio de los extremos abiertos ({@see describeRange}).
     */
    const parts = [describeRange(range)];

    const marked = types.filter((type) => selected[type] === true);

    if (marked.length === 0) {
        parts.push(t('clip.viewing.noTypes'));
    } else if (marked.length === types.length) {
        parts.push(t('clip.viewing.allTypes'));
    } else {
        parts.push(t('clip.viewing.types', { types: joinList(marked.map(typeLabel)) }));
    }

    if (query.trim() !== '') {
        parts.push(t('clip.viewing.search', { query: query.trim() }));
    }

    return `${t('clip.viewing.label')} ${parts.join(' · ')}`;
}

/**
 * Un rango abierto se dice con palabras, nunca con un hueco: es el criterio de `rangeText`, el
 * mismo criterio en `clinicalReport.js`.
 *
 * @param {{from: string|null, to: string|null}} range
 * @returns {string}
 */
function describeRange(range) {
    if (range.from === null && range.to === null) {
        return t('clip.viewing.rangeAll');
    }

    if (range.to === null) {
        return t('clip.viewing.rangeFrom', { from: formatDateTime(range.from) });
    }

    if (range.from === null) {
        return t('clip.viewing.rangeTo', { to: formatDateTime(range.to) });
    }

    return t('clip.viewing.rangeBetween', {
        from: formatDateTime(range.from),
        to: formatDateTime(range.to),
    });
}

/**
 * Tabla clínica: una fila por registro, con el valor, el método, la nota y el código LOINC.
 *
 * **No la sustituyen ni la línea temporal ni las gráficas.** Es una `<table>` de verdad porque se
 * lee en columnas, se compara de un vistazo y sale en papel como sale una tabla, que es donde acaba
 * esto cuando alguien lo mete en una historia clínica; y es el único sitio donde aparece el término
 * oficial LOINC, que no se traduce (ADR 0005) y que es lo que permite copiar una magnitud a un
 * sistema ajeno sin reinterpretarla.
 *
 * @param {object} resolved
 * @param {list<{occurredAt: string, content: object}>} events Eventos **del paquete**, sin aplanar.
 * @returns {HTMLElement}
 */
export function renderClinicalTable(resolved, events) {
    const wrapper = element('div', 'overflow-x-auto rounded-card border border-border bg-surface');
    const table = element('table', 'w-full border-collapse text-body-sm');

    const head = document.createElement('thead');
    const headRow = document.createElement('tr');

    for (const key of [
        'reader.table.when',
        'reader.table.what',
        'reader.table.value',
        'reader.table.details',
        'reader.table.loinc',
    ]) {
        const cell = element(
            'th',
            'border-b border-border px-4 py-3 text-left text-overline text-ink-secondary uppercase',
            t(key),
        );
        cell.scope = 'col';
        headRow.appendChild(cell);
    }

    head.appendChild(headRow);
    table.appendChild(head);

    const tbody = document.createElement('tbody');

    for (const event of events) {
        tbody.appendChild(renderClinicalRow(describeEvent(resolved, event)));
    }

    if (events.length === 0) {
        const row = document.createElement('tr');
        const cell = element('td', 'px-4 py-3 text-body text-ink-secondary', t('reader.table.empty'));
        cell.colSpan = 5;
        row.appendChild(cell);
        tbody.appendChild(row);
    }

    table.appendChild(tbody);
    wrapper.appendChild(table);

    return wrapper;
}

/**
 * @param {object} row Salida de {@see describeEvent}.
 * @returns {HTMLTableRowElement}
 */
function renderClinicalRow(row) {
    const tableRow = element('tr', 'border-b border-border last:border-b-0 break-inside-avoid');

    const when = element(
        'td',
        'px-4 py-3 align-top font-mono text-body-sm text-ink whitespace-nowrap',
        row.tz === null ? row.occurredAtLabel : `${row.occurredAtLabel} (${row.tz})`,
    );

    const what = element('td', 'px-4 py-3 align-top text-body-sm text-ink', row.typeLabel);

    const value = element(
        'td',
        row.unreadable
            ? 'px-4 py-3 align-top text-body-sm text-error-ink'
            : 'px-4 py-3 align-top font-mono text-body text-ink whitespace-nowrap',
        row.value,
    );

    const details = element('td', 'px-4 py-3 align-top text-body-sm text-ink-secondary');

    if (row.details.length > 0 || row.note !== null) {
        const list = element('ul', 'flex flex-col gap-0.5');

        for (const detail of row.details) {
            list.appendChild(element('li', '', detail));
        }

        if (row.note !== null) {
            list.appendChild(element('li', 'text-ink', t('reader.detail.note', { note: row.note })));
        }

        details.appendChild(list);
    }

    const loinc = element('td', 'px-4 py-3 align-top text-caption text-ink-secondary');

    for (const entry of row.loinc) {
        const item = element('p', '');

        /**
         * El código va en monoespaciada (Do's #7) y el término oficial **no se traduce** (ADR 0005):
         * es el nombre con el que esta magnitud se identifica fuera de aquí.
         */
        item.appendChild(element('span', 'font-mono text-ink', entry.code));

        if (entry.name !== null) {
            item.appendChild(document.createTextNode(` ${entry.name}`));
        }

        loinc.appendChild(item);
    }

    for (const cell of [when, what, value, details, loinc]) {
        tableRow.appendChild(cell);
    }

    return tableRow;
}

/**
 * Los bloques de gráfica, uno por tipo con magnitud que promediar.
 *
 * Los pinta este módulo y no una plantilla, al revés que en el panel del paciente: allí el marcado
 * lo emite Blade porque el morph de Livewire borraría cualquier lienzo escrito por JavaScript
 * (ADR 0002), y aquí no hay Livewire que morfe nada. `chartsView.js` los encuentra por `id`, con el
 * prefijo que recibe, para que dos pantallas montadas a la vez nunca se peleen por el mismo
 * `<canvas>`.
 *
 * @param {string} prefix
 * @returns {HTMLElement}
 */
function renderChartBlocks(prefix) {
    const container = element('div', 'space-y-8');

    for (const section of CHART_SECTIONS) {
        const ids = chartElementIds(section.type, prefix);
        const label = typeLabel(section.type);

        /** Oculto de salida: lo descubre `renderCharts()` si hay algo que dibujar. */
        const block = element('div', 'hidden');
        block.id = ids.block;

        block.appendChild(element('h3', 'font-display text-body-sm font-semibold text-ink', label));

        const frame = element('div', 'mt-2 h-80');
        const canvas = document.createElement('canvas');
        canvas.id = ids.canvas;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', t('dashboard.chart.ariaLabel', { type: label }));
        canvas.setAttribute('aria-describedby', `${ids.caption} ${ids.legend}`);
        frame.appendChild(canvas);
        block.appendChild(frame);

        const legend = element('ul', 'mt-3 flex flex-wrap gap-x-4 gap-y-1');
        legend.id = ids.legend;
        block.appendChild(legend);

        const caption = element('p', 'mt-2 text-caption text-ink-secondary');
        caption.id = ids.caption;
        block.appendChild(caption);

        container.appendChild(block);
    }

    return container;
}

/**
 * Los controles: subperiodo, tipos y búsqueda.
 *
 * Van marcados con `data-phr-reader-screen-only`, que la hoja del lector esconde al imprimir: un
 * desplegable y un campo de búsqueda en papel son tinta que no se puede pulsar.
 *
 * @param {object} params
 * @param {list<string>} params.types Tipos que el recorte incluye.
 * @param {Record<string, boolean>} params.selected
 * @param {string} params.idPrefix
 * @param {() => void} params.onChange
 * `cancelPendingSearch` sale hacia fuera porque el rebote tiene que morir con la pantalla: un
 * `repaint()` pendiente que corre después de `destroy()` recalcula estadísticas y **mantiene vivos en
 * memoria los eventos en claro** un rato después de que la pantalla se haya dado por cerrada, que es
 * justo lo contrario del invariante «solo memoria, y se va cuando se va».
 *
 * @returns {{section: HTMLElement, presetSelect: HTMLElement, fromInput: HTMLElement,
 *           toInput: HTMLElement, customRow: HTMLElement, searchInput: HTMLElement,
 *           rangeError: HTMLElement, cancelPendingSearch: () => void}}
 */
function renderControls({ types, selected, idPrefix, onChange }) {
    const { card: section, body } = card(t('clip.controls.title'));
    section.setAttribute('data-phr-reader-screen-only', '');

    // --- Subperiodo ------------------------------------------------------------------------------

    const rangeLabel = element('label', 'mb-1.5 block text-body-sm font-semibold text-ink', t('clip.range.label'));
    rangeLabel.htmlFor = `${idPrefix}-clip-range`;
    body.appendChild(rangeLabel);

    const presetSelect = element(
        'select',
        'block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 '
            + 'text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none sm:w-72',
    );
    presetSelect.id = `${idPrefix}-clip-range`;

    for (const preset of CLIP_RANGE_PRESETS) {
        const option = document.createElement('option');
        option.value = preset;
        option.textContent = t(`clip.range.${preset}`);
        presetSelect.appendChild(option);
    }

    presetSelect.value = 'all';
    body.appendChild(presetSelect);

    const customRow = element('div', 'mt-3 hidden flex-wrap items-end gap-3');
    const fromInput = renderDayInput(`${idPrefix}-clip-from`, t('clip.range.from'), customRow);
    const toInput = renderDayInput(`${idPrefix}-clip-to`, t('clip.range.to'), customRow);
    body.appendChild(customRow);

    /** El error del rango no se auto-descarta (Don'ts #6) y lleva texto además de color (Do's #3). */
    const rangeError = element('p', 'mt-2 text-body-sm text-error-ink');
    rangeError.hidden = true;
    rangeError.setAttribute('role', 'alert');
    body.appendChild(rangeError);

    body.appendChild(element('p', 'mt-1.5 text-helper text-ink-secondary', t('clip.range.help')));

    const syncCustomRow = () => {
        customRow.className = presetSelect.value === 'custom'
            ? 'mt-3 flex flex-wrap items-end gap-3'
            : 'mt-3 hidden flex-wrap items-end gap-3';
    };

    presetSelect.addEventListener('change', () => {
        syncCustomRow();
        onChange();
    });

    for (const input of [fromInput, toInput]) {
        input.addEventListener('change', onChange);
    }

    // --- Tipos -----------------------------------------------------------------------------------

    const fieldset = element('fieldset', 'mt-4');
    fieldset.appendChild(element('legend', 'mb-1.5 block text-body-sm font-semibold text-ink', t('clip.types.label')));

    const chips = element('div', 'flex flex-wrap gap-2');

    for (const type of types) {
        const label = element('label', 'inline-flex min-h-11 cursor-pointer items-center');

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'peer sr-only';
        input.checked = selected[type] === true;
        input.addEventListener('change', () => {
            selected[type] = input.checked;
            onChange();
        });

        label.appendChild(input);
        label.appendChild(element(
            'span',
            'inline-flex min-h-11 items-center rounded-chip border border-chip-outline bg-chip-surface px-3.5 '
                + 'py-1.5 text-body-sm font-semibold text-chip-ink peer-checked:border-accent '
                + 'peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:shadow-focus-blue',
            typeLabel(type),
        ));

        chips.appendChild(label);
    }

    fieldset.appendChild(chips);
    body.appendChild(fieldset);

    // --- Búsqueda --------------------------------------------------------------------------------

    const searchWrapper = element('div', 'mt-4');
    const searchLabel = element('label', 'mb-1.5 block text-body-sm font-semibold text-ink', t('clip.search.label'));
    searchLabel.htmlFor = `${idPrefix}-clip-search`;
    searchWrapper.appendChild(searchLabel);

    /**
     * `type="search"` y no `type="text"`: el navegador añade el botón de borrar y lo anuncia como
     * campo de búsqueda. `autocomplete="off"` porque esto se teclea en un ordenador de consulta que
     * usan varias personas, y lo que alguien busca en un historial ajeno —«hipoglucemia», el nombre
     * de un fármaco— no tiene por qué quedarse en el autocompletado del siguiente.
     */
    const searchInput = document.createElement('input');
    searchInput.id = `${idPrefix}-clip-search`;
    searchInput.type = 'search';
    searchInput.autocomplete = 'off';
    searchInput.placeholder = t('clip.search.placeholder');
    searchInput.setAttribute('aria-describedby', `${idPrefix}-clip-search-help`);
    searchInput.className = 'block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface '
        + 'px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none';

    /**
     * Rebote de 200 ms a mano, que es lo que hace `@input.debounce.200ms` en el panel: repintar
     * cinco gráficas y seis tarjetas en cada pulsación se nota, y 200 ms es lo que tarda en
     * percibirse una pausa al teclear. Aquí no hay Alpine que lo ponga.
     */
    let debounce = null;
    const cancelPendingSearch = () => {
        if (debounce !== null) {
            clearTimeout(debounce);
            debounce = null;
        }
    };

    searchInput.addEventListener('input', () => {
        cancelPendingSearch();

        debounce = setTimeout(onChange, 200);
    });

    searchWrapper.appendChild(searchInput);

    const help = element('p', 'mt-1.5 text-helper text-ink-secondary', t('clip.search.help'));
    help.id = `${idPrefix}-clip-search-help`;
    searchWrapper.appendChild(help);

    body.appendChild(searchWrapper);

    return { section, presetSelect, fromInput, toInput, customRow, searchInput, rangeError, cancelPendingSearch };
}

/**
 * @param {string} id
 * @param {string} labelText
 * @param {HTMLElement} row
 * @returns {HTMLInputElement}
 */
function renderDayInput(id, labelText, row) {
    const wrapper = element('div', '');
    const label = element('label', 'mb-1.5 block text-body-sm font-semibold text-ink', labelText);
    label.htmlFor = id;
    wrapper.appendChild(label);

    const input = document.createElement('input');
    input.id = id;
    input.type = 'date';
    input.className = 'block min-h-11 rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 '
        + 'text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none';
    wrapper.appendChild(input);
    row.appendChild(wrapper);

    return input;
}

/**
 * Monta la pantalla entera del recorte dentro de `container`.
 *
 * @param {HTMLElement} container Se vacía y se rellena.
 * @param {object} params
 * @param {object} params.body Cuerpo en claro del paquete.
 * @param {object} params.resolved Vocabulario resuelto ({@see resolveCatalog}).
 * @param {string} params.chartPrefix Prefijo de los `id` de los bloques de gráfica.
 * @returns {{repaint: () => Promise<void>, destroy: () => void}}
 */
export function renderClippingExplorer(container, { body, resolved, chartPrefix }) {
    const bounds = clippingBounds(body);
    const types = clippingTypes(body);
    const { events: allEvents, raws, unreadable, undeclared } = flattenClippingEvents(body, types);
    const glucoseUnit = clippingGlucoseUnit(allEvents);
    const mixedGlucoseUnits = clippingHasMixedGlucoseUnits(allEvents);

    /** El recorte trae eventos pero no dice de qué tipos son: se ofrecen los que hay y se declara. */
    const undeclaredTypes = types.length > 0
        && !EVENT_TYPES.some((type) => (body?.includedTypes ?? []).includes(type));

    /**
     * Emparejamiento entre el evento aplanado que ven las vistas y el evento del paquete que lee la
     * tabla clínica. Es un `WeakMap` y no un campo dentro del evento porque los filtros
     * (`filterBySelectedTypes`, `searchEvents`, el origen en memoria) devuelven **los mismos
     * objetos**, así que la identidad basta y no hay que ensuciar el contenido descifrado.
     */
    const rawOf = new WeakMap();

    for (const [index, event] of allEvents.entries()) {
        rawOf.set(event, raws[index]);
    }

    /** Todos marcados de salida: estrenar la pantalla con un tipo fuera escondería registros. */
    const selected = Object.fromEntries(types.map((type) => [type, true]));
    const source = memoryEventSource(allEvents);

    /** @type {Record<string, object>} Instancias vivas de Chart.js, para poder destruirlas. */
    const charts = {};

    const controls = renderControls({
        types,
        selected,
        idPrefix: chartPrefix,
        onChange: () => void repaint(),
    });

    const notice = element('div', '');

    /**
     * La línea de estado efectivo. Va fuera de la tarjeta de controles a propósito: aquella lleva
     * `data-phr-reader-screen-only` y desaparece al imprimir, y esta tiene que salir en papel.
     */
    const viewing = element('p', 'text-body text-ink-secondary');
    const chartsCard = card(t('clip.charts.title'));
    const statsCard = card(t('clip.stats.title'));
    const timelineCard = card(t('clip.timeline.title'));
    const tableCard = card(t('clip.table.title'));

    chartsCard.body.appendChild(renderChartBlocks(chartPrefix));

    /**
     * Las gráficas no se imprimen. Un `<canvas>` sale en papel tal como se dibujó, y dibujado en
     * tema oscuro son líneas claras sobre fondo transparente: en blanco, invisibles. Lo que de
     * verdad acaba dentro de una historia clínica es texto (ADR 0011), y ese texto —las tarjetas de
     * estadísticas y la tabla— sí se imprime entero.
     */
    chartsCard.card.setAttribute('data-phr-reader-screen-only', '');

    container.replaceChildren(
        renderClippingHeader(resolved, body),
        controls.section,
        viewing,
        notice,
        chartsCard.card,
        statsCard.card,
        timelineCard.card,
        tableCard.card,
    );

    /**
     * DESIGN.md § Charts — Dark: la gráfica tiene que releer los colores y redibujarse al cambiar el
     * tema. En el panel el tema es una clase en `<html>` que pone Filament; aquí no hay panel ni
     * conmutador —guardar una preferencia sería escribir en el dispositivo del profesional, que es
     * justo lo que esta ruta evita—, así que manda el sistema operativo.
     */
    const stopObserving = observeColorSchemeChange(() => void repaint());

    async function repaint() {
        const { range, error } = clippingSubrange({
            preset: controls.presetSelect.value,
            fromDay: controls.fromInput.value,
            toDay: controls.toInput.value,
            bounds,
            events: allEvents,
        });

        controls.rangeError.textContent = error;
        controls.rangeError.hidden = error === '';

        const query = controls.searchInput.value;

        viewing.textContent = viewingText(range, types, selected, query);

        const { events: inRange } = await source(range);

        /**
         * **El periodo y los tipos son la población; la búsqueda no.** Las gráficas y las
         * estadísticas se calculan sobre `selectedEvents`, y la búsqueda solo estrecha la línea
         * temporal y la tabla, que es donde buscar significa «localiza esto».
         *
         * Mientras la búsqueda fue el último filtro de todo, teclear «noche» —o «140»— reescribía la
         * media, la mediana y el tiempo en rango sobre el subconjunto de registros cuyo **texto**
         * contenía esa cadena, con el rótulo «Media» intacto. Una media sobre una coincidencia de
         * cadena no es una población clínica: es un número inventado con aspecto de dato, y aquí lo
         * lee alguien que no tiene forma de saber cómo salió.
         */
        const selectedEvents = filterBySelectedTypes(inRange, selected);
        const shown = searchEvents(selectedEvents, query);

        renderNotice(selectedEvents.length, selectedEvents.length - shown.length);

        renderCharts(selectedEvents, {
            glucoseUnit,
            charts,
            includesType: (type) => selected[type] === true,
            prefix: chartPrefix,
        });

        statsCard.body.replaceChildren(renderStatsSections(selectedEvents, {
            selectedTypes: selected,
            unit: glucoseUnit,
            targetRange: undefined,
            unitMismatch: false,
            /**
             * Ni botones a pantallas del panel ni invitación a configurar un rango objetivo: quien
             * mira esto no tiene cuenta aquí y no puede configurar nada. Un botón que no lleva a
             * ninguna parte es peor que ningún botón.
             */
            urlForType: () => null,
            inviteTargetRange: false,
            /**
             * «Todavía no hay registros en este periodo» habla en voz de paciente y afirma una
             * ausencia clínica sobre un historial que no es el de quien lee. Aquí lo que hay es un
             * recorte cerrado, y eso es lo que se dice.
             */
            emptyText: t('clip.empty.type'),
        }));

        timelineCard.body.replaceChildren(renderTimelineSection(shown, {
            /**
             * Si lo que vacía la línea temporal es el buscador, se dice que es el buscador. Decir
             * «no hay registros» sobre registros que están en el recorte y solo están filtrados es
             * exactamente la lectura que este proyecto no puede permitirse.
             */
            emptyText: query.trim() === '' ? t('clip.empty.type') : t('dashboard.empty.search'),
        }));

        /**
         * La tabla enseña lo mismo que las vistas **más los ilegibles y los de tipo no declarado**,
         * que no pasan por ningún filtro: de los primeros no se puede leer ni el tipo ni la fecha con
         * garantías, y los segundos no tienen casilla que marcar. Esconder cualquiera de los dos
         * sería omitir un registro que existe (ADR 0004), y `describeEvent` ya sabe pintarlos.
         */
        tableCard.body.replaceChildren(renderClinicalTable(resolved, [
            ...shown.map((event) => rawOf.get(event)),
            ...undeclared,
            ...unreadable,
        ]));
    }

    /**
     * @param {number} shownCount Registros del periodo que pasan el filtro de tipos.
     * @param {number} hiddenBySearch Cuántos de esos deja fuera el texto buscado.
     */
    function renderNotice(shownCount, hiddenBySearch) {
        const callouts = [];

        if (unreadable.length > 0) {
            callouts.push(createCallout('warning', t('clip.notice.unreadable', { count: unreadable.length })));
        }

        if (undeclared.length > 0) {
            callouts.push(createCallout('warning', t('clip.notice.undeclared', { count: undeclared.length })));
        }

        if (undeclaredTypes) {
            callouts.push(createCallout('info', t('clip.notice.noDeclaredTypes')));
        }

        /**
         * Las glucemias en dos unidades merecen un aviso, no una nota al pie: la nota que ya pinta
         * `statsView.js` va en `text-caption`, con menos peso visual que el número al que desmiente.
         */
        if (mixedGlucoseUnits) {
            callouts.push(createCallout('warning', t('clip.notice.mixedUnits', { unit: glucoseUnit })));
        }

        callouts.push(createCallout('info', t('clip.notice.shown', {
            count: shownCount,
            total: allEvents.length + undeclared.length + unreadable.length,
        })));

        if (hiddenBySearch > 0) {
            callouts.push(createCallout('info', t('dashboard.search.hidden', { count: hiddenBySearch })));
        }

        for (const callout of callouts.slice(0, -1)) {
            callout.classList.add('mb-4');
        }

        notice.replaceChildren(...callouts);
    }

    void repaint();

    return {
        repaint,
        /**
         * Desmonta: destruye las gráficas y deja de observar el tema. Sin esto, volver a montar la
         * vista previa dejaría la instancia anterior de Chart.js atada a un lienzo que ya no está.
         */
        destroy() {
            controls.cancelPendingSearch();
            stopObserving();
            destroyCharts(charts, chartPrefix);
            container.replaceChildren();
        },
    };
}
