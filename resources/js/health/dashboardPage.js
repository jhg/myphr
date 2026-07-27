/**
 * Componente Alpine del panel de inicio (ADR 0002, ADR 0004, ADR 0006, ADR 0007, ADR 0008).
 *
 * **Qué queda aquí después de la extracción.** Solo lo que es del panel del paciente: el componente
 * Alpine, los `x-ref` de su plantilla, las rutas de sus estados vacíos y la **única** llamada a
 * Livewire de todo el camino de visualización. Lo que se pinta —línea temporal, tarjetas de
 * estadísticas y gráficas— vive ahora en módulos que reciben un array de eventos descifrados y
 * devuelven nodos (`timelineView.js`, `statsView.js`, `chartsView.js`), y de dónde salen esos
 * eventos lo decide un origen intercambiable (`eventSource.js`, `livewireEventSource.js`). Esa es la condición para que el
 * profesional que abre un recorte compartido vea la misma interfaz sin cuenta y sin sesión: si el
 * pintado siguiera atado a este componente, el lector tendría que reimplementarlo y las dos copias
 * divergirían.
 *
 * **Nada de esto pasa por un componente Livewire**, y no es negociable: todo lo que toca una
 * propiedad pública acaba en el snapshot, que viaja al servidor y se queda ahí (ADR 0002, con
 * `App\Livewire\Hooks\EncryptedPayloadGuardHook` y los tests de arquitectura vigilándolo). El único
 * dato que sube es la petición de lectura `fetchEvents`; el descifrado ocurre aquí, en el navegador.
 *
 * **El periodo se elige y por defecto es el último día.** El rango sí lo aplica el servidor y por
 * eso viaja a `fetchEvents`: `occurred_at` es una de las tres columnas en claro del ADR 0006. Es la
 * mejora que importa, porque descifrar un año de eventos en el navegador se nota: con «último día»
 * se abren los sobres de 24 horas, no los de un mes. El control de rango es el compartido con las
 * pantallas de historial (`health/dateRange.js`), no uno propio.
 *
 * **El servidor no puede filtrar por tipo ni buscar texto** (ADR 0006), así que las dos cosas se
 * hacen aquí, sobre lo ya descifrado, y son gratis: marcar un tipo o teclear en el buscador repinta
 * sin pedir ni descifrar nada ({@see filterBySelectedTypes}, {@see searchEvents}). **No son el mismo
 * filtro**: los tipos eligen la población que resumen las tarjetas y las gráficas, y la búsqueda solo
 * estrecha la línea temporal (ver {@see dashboardPage}, `render()`). Un sobre que no abre no tumba el
 * panel: se cuenta y se avisa (ADR 0004).
 */

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { settings } from '../auth/settings.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { t } from '../i18n/index.js';
import { observeThemeChange } from './chartTheme.js';
import { destroyCharts, renderCharts } from './chartsView.js';
import { dateRangeControl } from './dateRange.js';
import { searchEvents } from './eventSearch.js';
import { defaultSelectedTypes, filterBySelectedTypes } from './eventTypes.js';
import { createCallout } from './eventVisuals.js';
import { livewireEventSource } from './livewireEventSource.js';
import { renderStatsSections, resolveGlucoseTargetRange, targetRangeUnitMismatch } from './statsView.js';
import { renderTimelineSection } from './timelineView.js';

/** Unidad de presentación de glucemia por defecto, igual que en `glucosePage.js` (ADR 0006). */
const DEFAULT_UNIT = 'mg/dL';

/**
 * Nombre del `data-*` con la ruta de la pantalla de cada tipo, para el botón del estado vacío. Los
 * pinta Blade en el contenedor porque la ruta la decide `PhrPanelProvider` y una ruta duplicada a
 * mano en el cliente se queda obsoleta sin que nadie lo note hasta que alguien pulsa el botón.
 *
 * @type {Record<string, string>}
 */
const TYPE_URL_KEYS = Object.freeze({
    glucose: 'glucoseUrl',
    bloodPressure: 'bloodPressureUrl',
    insulin: 'insulinUrl',
    meal: 'mealsUrl',
    bodyWeight: 'bodyWeightUrl',
    temperature: 'temperatureUrl',
});

/**
 * Destino de una pantalla, leído del contenedor que pinta Blade.
 *
 * Devuelve `null` si no hay documento con `querySelector` —los tests montan un `document` mínimo— o
 * si el atributo falta. En ese caso el estado vacío se pinta igual, solo que sin botón: la frase,
 * que es lo que informa, no depende de encontrar la ruta.
 *
 * @param {string} type
 * @returns {string|null}
 */
function urlForType(type) {
    const key = TYPE_URL_KEYS[type];

    if (key === undefined || typeof document?.querySelector !== 'function') {
        return null;
    }

    return document.querySelector('[data-glucose-url]')?.dataset?.[key] ?? null;
}

/**
 * @param {unknown} failure
 * @returns {string}
 */
function describeError(failure) {
    if (failure instanceof EnvelopeError) {
        return t('common.undecryptable');
    }

    if (failure instanceof Error && failure.message !== '') {
        return failure.message;
    }

    return t('dashboard.generic');
}

/**
 * Factoría del componente Alpine. Se registra como `phrDashboardPage`.
 *
 * @returns {object}
 */
export function dashboardPage() {
    return {
        /**
         * El control de periodo compartido con las pantallas de historial: aporta `rangePreset`,
         * `rangeFromDay`, `rangeToDay` y `rangeError` (los tres primeros con `x-model` en la
         * plantilla común) y llama a `loadHistory()` al aplicar.
         *
         * Arranca en `day` y no en `all` como el historial: el panel es la pantalla de entrada, tiene
         * que abrir rápido y enseñar lo de hoy. El historial, en cambio, se abre para buscar, y allí
         * acotar de oficio escondería registros antiguos que nadie ha pedido esconder.
         */
        ...dateRangeControl({ preset: 'day' }),

        /**
         * Tipos de evento marcados. Es estado de interfaz del cliente (`x-model`, nunca
         * `wire:model`: ADR 0002) y no viaja a ninguna parte.
         */
        selectedTypes: defaultSelectedTypes(),

        /**
         * Lo tecleado en el buscador. Igual que las casillas: `x-model`, jamás `wire:model`. El
         * texto de búsqueda de alguien sobre su propio historial es un dato clínico por sí mismo
         * («hipoglucemia», el nombre de un fármaco) y no tiene por qué salir del dispositivo; ver el
         * encabezado de `eventSearch.js`.
         */
        searchQuery: '',

        /**
         * Los eventos ya descifrados de la última carga.
         *
         * No es caché ni un atajo: es lo que permite que el filtro por tipo y la búsqueda repinten
         * **sin volver a pedir ni a descifrar nada**. Mismo patrón que `chartEvents` en
         * `glucosePage.js`, y con el mismo límite: se vacía al bloquearse la sesión, porque son
         * valores en claro de una sesión que ya no está desbloqueada (ADR 0003).
         *
         * @type {list<object>}
         */
        decryptedEvents: [],

        /** Estado de la última carga, para poder repintar sin volver a pedir. */
        failedToOpen: 0,
        truncated: false,

        /**
         * Instancias vivas de Chart.js, una por tipo con gráfica. Se guardan para poder destruirlas
         * antes de repintar: dos gráficas sobre el mismo lienzo dejan la vieja debajo y los tooltips
         * de las dos respondiendo al ratón.
         *
         * @type {Record<string, object>}
         */
        charts: {},

        init() {
            /**
             * DESIGN.md § Charts — Dark: «a chart must also re-read them and redraw when the `.dark`
             * class on `<html>` changes». Chart.js congela los colores al construir el lienzo, así
             * que la única forma de conmutar de tema es rehacer la gráfica con los mismos datos, y
             * repintar aquí no cuesta ni una petición ni un descifrado: los eventos ya están
             * abiertos en memoria. Sin datos no hay nada que repintar.
             */
            observeThemeChange(() => {
                if (this.decryptedEvents.length > 0) {
                    this.render();
                }
            });

            if (isUnlocked()) {
                void this.loadSummary();

                return;
            }

            this.renderLocked();
            document.addEventListener(SESSION_READY_EVENT, () => void this.loadSummary(), { once: true });
        },

        /**
         * Contrato de `dateRangeControl`: al aplicar un periodo se vuelve a cargar por aquí. Es una
         * carga de verdad —el rango lo aplica el servidor— a diferencia del filtro de tipos y de la
         * búsqueda, que solo repintan.
         */
        loadHistory() {
            return this.loadSummary();
        },

        /**
         * El origen de datos del panel: pide páginas a Livewire y las abre aquí.
         *
         * Es la **única** frontera con el servidor de toda la visualización. El lector del
         * profesional monta en su lugar `memoryEventSource(...)` sobre el paquete ya descifrado y
         * las vistas no notan la diferencia; por eso la petición se pasa como función y no se
         * escribe dentro de los módulos de pintado.
         *
         * @param {string} userId
         * @returns {(range: object) => Promise<{events: list<object>, failedToOpen: number, truncated: boolean}>}
         */
        eventSource(userId) {
            return livewireEventSource({
                userId,
                /** Mismo orden de argumentos que `HealthEventPage::fetchEvents(?string, int, ?string, ?string)`. */
                fetchPage: (cursor, limit, range) => this.$wire.fetchEvents(cursor, limit, range.from, range.to),
            });
        },

        /** Descarga y descifra los eventos del periodo elegido, y pinta con lo que haya marcado. */
        async loadSummary() {
            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    this.renderLocked();

                    return;
                }

                const { events, failedToOpen, truncated } = await this.eventSource(userId)(this.historyRange());

                this.decryptedEvents = events;
                this.failedToOpen = failedToOpen;
                this.truncated = truncated;

                this.render();
            } catch (failure) {
                this.renderNoticeError(failure);
            }
        },

        /**
         * Repinta con lo ya descifrado. Lo llaman la carga, el filtro de tipos y el buscador; los dos
         * últimos no piden ni descifran nada, que es lo que permite marcar, desmarcar y teclear sin
         * esperas.
         */
        render() {
            const userSettings = settings();
            const unit = userSettings?.glucoseUnit ?? DEFAULT_UNIT;
            const targetRange = resolveGlucoseTargetRange(userSettings, unit);
            const unitMismatch = targetRangeUnitMismatch(userSettings, unit);

            /**
             * **El periodo y los tipos son la población; la búsqueda no.** Las gráficas y las
             * tarjetas se calculan sobre `selected`, y lo tecleado solo estrecha la línea temporal,
             * que es donde buscar significa «localiza esto».
             *
             * Mientras la búsqueda fue el último filtro de todo, teclear «mañana» —o «140»—
             * reescribía la media, la mediana y el tiempo en rango sobre el subconjunto de registros
             * cuyo **texto** contenía esa cadena, con el rótulo «Media» intacto. Una media sobre una
             * coincidencia de cadena no es una población clínica.
             */
            const selected = filterBySelectedTypes(this.decryptedEvents, this.selectedTypes);
            const shown = searchEvents(selected, this.searchQuery);

            this.renderNotice(this.failedToOpen, this.truncated, selected.length, selected.length - shown.length);
            /**
             * Las tres vistas se pintan con la **misma** lista de eventos ya descifrados: ni una
             * petición ni un descifrado de más.
             */
            this.$refs.timeline.replaceChildren(renderTimelineSection(shown, {
                emptyStateUrl: urlForType('glucose'),
                /**
                 * Si lo que vacía la lista es el buscador, se dice que es el buscador: «no hay
                 * registros en este periodo» sobre registros que están y solo están filtrados es una
                 * ausencia leída como un cero clínico.
                 */
                emptyText: this.searchQuery.trim() === '' ? undefined : t('dashboard.empty.search'),
            }));
            this.$refs.stats.replaceChildren(renderStatsSections(selected, {
                selectedTypes: this.selectedTypes,
                unit,
                targetRange,
                unitMismatch,
                urlForType,
            }));
            /**
             * Los bloques de gráfica los pinta Blade y viven **fuera** de los islands, con
             * `wire:ignore`: dentro de un `@island`, el servidor los reemite tras cualquier petición
             * de Livewire y el `<canvas>` desaparece con todo lo dibujado.
             */
            renderCharts(selected, {
                glucoseUnit: unit,
                charts: this.charts,
                includesType: (type) => this.selectedTypes[type] === true,
                /**
                 * El rango objetivo pinta la banda de fondo de la superposición de 24 horas, que es
                 * lo que convierte esa nube de puntos en información. Llega ya resuelto y ya
                 * comprobado en la unidad de presentación (ADR 0007: no se convierte), así que si
                 * está en otra unidad llega `undefined` y la gráfica se dibuja sin banda, en vez de
                 * con una referencia falsa.
                 */
                targetRange,
            });
        },

        /**
         * Marcar o desmarcar un tipo, o teclear en el buscador, solo repinta: los datos ya están
         * descifrados en memoria. Sin sesión desbloqueada no hay nada que repintar y se deja el aviso
         * de bloqueo en pantalla.
         */
        applyFilters() {
            if (!isUnlocked()) {
                this.renderLocked();

                return;
            }

            this.render();
        },

        /** Nombre que usa la plantilla para las casillas de tipo desde antes del buscador. */
        applyTypeFilter() {
            this.applyFilters();
        },

        /**
         * Sin clave no se puede descifrar nada: se dice en las dos regiones, no se pinta un resumen
         * vacío que se confundiría con «no tienes registros» (ADR 0003: perder la clave es normal).
         *
         * Los eventos descifrados de la carga anterior se tiran: son valores en claro de una sesión
         * que ya no está desbloqueada.
         */
        renderLocked() {
            this.decryptedEvents = [];
            this.failedToOpen = 0;
            this.truncated = false;
            /** Las gráficas dibujan valores en claro: con la sesión bloqueada no pueden quedarse. */
            destroyCharts(this.charts);

            this.$refs.notice.replaceChildren();
            this.$refs.timeline.replaceChildren(createCallout('info', t('common.locked.summary')));
            this.$refs.stats.replaceChildren(createCallout('info', t('common.locked.summary')));
        },

        /**
         * Avisos de la carga: sobres que no abrieron, resumen recortado, cuántos registros hay
         * detrás de lo que se está enseñando y cuántos ha dejado fuera la búsqueda.
         *
         * El recuento se dice siempre, no solo cuando algo se recorta: es la referencia que permite
         * leer «100 entradas» de la línea temporal sabiendo cuántas había. Y lo que esconde el
         * buscador también se dice, por lo mismo: una lista acortada sin explicación se lee como «no
         * hay más registros».
         *
         * @param {number} failedToOpen
         * @param {boolean} truncated
         * @param {number} shownCount Eventos del periodo que pasan el filtro de tipos.
         * @param {number} hiddenBySearch Cuántos de esos deja fuera el texto buscado.
         */
        renderNotice(failedToOpen, truncated, shownCount, hiddenBySearch = 0) {
            const callouts = [];

            if (failedToOpen > 0) {
                callouts.push(createCallout(
                    'warning',
                    t('dashboard.recordsUndecrypted', { count: failedToOpen }),
                ));
            }

            if (truncated) {
                callouts.push(createCallout('warning', t('dashboard.truncated')));
            }

            if (shownCount > 0) {
                callouts.push(createCallout('info', t('dashboard.loadedCount', { count: shownCount })));
            }

            if (hiddenBySearch > 0) {
                callouts.push(createCallout('info', t('dashboard.search.hidden', { count: hiddenBySearch })));
            }

            for (const callout of callouts.slice(0, -1)) {
                callout.classList.add('mb-4');
            }

            this.$refs.notice.replaceChildren(...callouts);
        },

        /** @param {unknown} failure */
        renderNoticeError(failure) {
            this.$refs.notice.replaceChildren(createCallout('warning', describeError(failure)));
        },
    };
}
