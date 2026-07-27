/**
 * De dónde salen los eventos descifrados de un periodo (ADR 0002, ADR 0004, ADR 0006).
 *
 * **La abstracción es una sola función asíncrona**, no una clase ni una interfaz con métodos:
 *
 *     (range) => Promise<{events, failedToOpen, truncated}>
 *
 * y `range` es el `{from, to}` que ya produce `dateRange.js`. Se ha elegido la forma más pequeña que
 * responde a la única pregunta que las vistas hacen —«dame los eventos de este rango»— porque
 * cualquier método de más volvería a atar las pantallas a un origen concreto: un `hasMore()` o un
 * `refresh()` solo tienen sentido con servidor detrás, y el lector del profesional no tiene ninguno.
 * Con una función, montar un origen nuevo es escribir una función.
 *
 * Las tres claves de la respuesta son las que la pantalla **tiene que poder decir en voz alta**:
 * cuántos eventos hay, cuántos sobres no abrieron (ADR 0004: un sobre roto se cuenta y se avisa,
 * nunca se traga) y si la lectura se quedó corta. Un resumen recortado que se presenta como completo
 * es el peor fallo posible en un historial clínico.
 *
 * Dos implementaciones, en **dos ficheros distintos**:
 *
 * - {@see memoryEventSource}, aquí: la del lector del profesional y la de la vista previa de
 *   compartir. Los eventos ya están descifrados en memoria (vienen del paquete `s1.` o de la
 *   pantalla que lo va a crear), así que solo hay que acotarlos por rango. Ni una petición.
 * - `livewireEventSource`, en `livewireEventSource.js`: la del panel, que pide páginas al servidor y
 *   **descifra en el navegador**.
 *
 * **Están separadas por una razón de perímetro, no de orden.** Este fichero es alcanzable desde la
 * entrada de Vite del lector (`reader.js`), y Rollup mete en el trozo común todo lo que alcanzan las
 * dos entradas, con su cadena entera de importaciones. Mientras el origen del panel vivió aquí, el
 * lector arrastraba `eventEnvelope.js` → `auth/keyring.js`, es decir el módulo que guarda y abre la
 * clave maestra en `sessionStorage`, hasta el navegador de una consulta ajena. No era explotable
 * —allí no hay clave que abrir—, pero el invariante declarado del ADR 0011 («el lector no arrastra
 * nada del panel», «no escribe nada en el dispositivo») dejaba de ser estructural.
 *
 * Por eso **este fichero no importa nada**: ni `eventEnvelope.js`, ni Livewire, ni el DOM. Lo vigila
 * `tests/js/clippingExplorer.test.mjs`, que recorre el grafo de importaciones **transitivo** desde
 * `reader.js`; un test de importaciones directas no puede vigilar un perímetro que Vite decide por
 * alcanzabilidad.
 */

/**
 * Tamaño de página: el techo duro de `HealthEventPage::MAX_FETCH_LIMIT`, que recorta cualquier valor
 * mayor. Pedir menos solo multiplicaría las idas y vueltas.
 */
export const FETCH_PAGE_SIZE = 500;

/**
 * Tope de páginas por carga. Con 500 eventos por página son 5.000 eventos, muy por encima de lo que
 * cabe en 30 días de registro humano; existe solo para que un cursor que no avanzara no dejara al
 * navegador pidiendo páginas sin fin.
 */
export const MAX_FETCH_PAGES = 10;

/**
 * Aplana un evento descifrado a la forma que espera `statistics.js`: el contenido en claro
 * (`{v, type, tz, data, ...}`) más `occurredAt` en el mismo nivel (ver JSDoc del módulo
 * `statistics.js`, «Forma de entrada»).
 *
 * @param {{occurredAt: string}} rawEvent Tal cual lo devuelve `fetchEvents` (sin descifrar).
 * @param {object} content Contenido ya descifrado con `openEvent`.
 * @returns {object}
 */
export function flattenDecryptedEvent(rawEvent, content) {
    return { ...content, occurredAt: rawEvent.occurredAt };
}

/**
 * Instante en que empieza el rango pedido, en milisegundos desde epoch, o `-Infinity` cuando el
 * rango está abierto por abajo («todos los registros»).
 *
 * @param {{from: string|null}} range
 * @returns {number}
 */
export function rangeStartMs(range) {
    if (range?.from === null || range?.from === undefined) {
        return -Infinity;
    }

    const startMs = Date.parse(range.from);

    return Number.isNaN(startMs) ? -Infinity : startMs;
}

/**
 * Fin del rango pedido, exclusivo, o `Infinity` cuando está abierto por arriba.
 *
 * @param {{to: string|null}} range
 * @returns {number}
 */
export function rangeEndMs(range) {
    if (range?.to === null || range?.to === undefined) {
        return Infinity;
    }

    const endMs = Date.parse(range.to);

    return Number.isNaN(endMs) ? Infinity : endMs;
}

/**
 * ¿Hace falta pedir otra página de eventos?
 *
 * `fetchEvents` devuelve **todos** los tipos de evento del usuario (el servidor no puede filtrar por
 * tipo, ADR 0006) ordenados de más reciente a más antiguo y con un límite. Con una sola página de
 * 100 —el valor por defecto del servidor— quien registra glucemia, tensión, comidas e insulina
 * varias veces al día no llega ni a diez días atrás, y el resumen de un periodo largo saldría
 * recortado sin decirlo. Así que se pagina con cursor hasta cubrir el rango elegido.
 *
 * Se para cuando la página viene incompleta (ya no hay más eventos) o cuando el más antiguo de la
 * página ya cae antes del inicio del rango. Una fecha ilegible también para el bucle, en vez de
 * dejarlo pidiendo páginas a ciegas.
 *
 * @param {list<{occurredAt: string}>} page Tal cual la devuelve `fetchEvents` (sin descifrar).
 * @param {number} pageSize Límite pedido al servidor.
 * @param {number} windowStartMs Ver {@see rangeStartMs}.
 * @returns {boolean}
 */
export function needsAnotherPage(page, pageSize, windowStartMs) {
    if (page.length < pageSize) {
        return false;
    }

    const oldestMs = Date.parse(page[page.length - 1].occurredAt);

    return Number.isNaN(oldestMs) ? false : oldestMs >= windowStartMs;
}

/**
 * Origen del lector y de la vista previa de compartir: los eventos ya están descifrados en memoria.
 *
 * Acota con el **mismo criterio que el servidor**, `[from, to)` (ver `HealthEventPage::fetchEvents`,
 * que aplica `>=` al inicio y `<` al final), y devuelve el mismo orden, de más reciente a más
 * antiguo. Es lo que hace que las vistas no noten la diferencia: cambiar de origen no puede cambiar
 * qué eventos entran en un resumen, o el paciente y el médico verían medias distintas del mismo
 * periodo.
 *
 * `failedToOpen` llega como parámetro y no se calcula: en el lector los sobres se abren al deshacer
 * el paquete, mucho antes de esta función, y el recuento de los que fallaron tiene que sobrevivir
 * hasta la pantalla (ADR 0004).
 *
 * @param {list<object>} events Eventos ya descifrados y aplanados.
 * @param {{failedToOpen?: number}} [options]
 * @returns {(range: {from: string|null, to: string|null}) => Promise<{events: list<object>, failedToOpen: number, truncated: boolean}>}
 */
export function memoryEventSource(events, { failedToOpen = 0 } = {}) {
    return async (range) => {
        const startMs = rangeStartMs(range);
        const endMs = rangeEndMs(range);

        const inRange = events
            .filter((event) => {
                const occurredMs = Date.parse(event?.occurredAt);

                /**
                 * Una fecha ilegible no se descarta: se deja pasar. Descartarla escondería un
                 * registro que existe, y esconder es peor que enseñar algo mal colocado.
                 */
                return Number.isNaN(occurredMs) || (occurredMs >= startMs && occurredMs < endMs);
            })
            .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

        /** Nada se trunca: no hay paginación que agotar, están todos delante. */
        return { events: inRange, failedToOpen, truncated: false };
    };
}
