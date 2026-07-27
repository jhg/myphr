/**
 * Rango de fechas del historial, común a las cuatro pantallas de eventos (ADR 0002, ADR 0004,
 * ADR 0006).
 *
 * **Por qué el rango sí puede acotarlo el servidor.** `occurred_at` es una de las tres columnas en
 * claro del ADR 0006 y el servidor ya la usa para ordenar y paginar, así que filtrar por ella no le
 * revela nada nuevo; el tipo del evento, en cambio, va dentro del sobre y se sigue descartando aquí.
 * El rango se calcula en el navegador y viaja como argumento de `fetchEvents`, nunca como propiedad
 * de Livewire: una propiedad pública entraría en el snapshot, que es lo que el ADR 0002 prohíbe.
 *
 * **El rango NO va en la URL, y no es un olvido.** Spec 0001 §9 y `App\Filament\Pages\PhrPage`
 * prohíben las propiedades `#[Url]` en las pantallas del panel, hasta el punto de redeclarar sin el
 * atributo las seis que trae Filament, y `tests/Feature/PanelUrlPropertiesTest.php` falla si alguna
 * vuelve a aparecer. El motivo es exactamente el que aplica aquí: una URL queda escrita en el
 * historial del navegador, en el registro de acceso del proveedor y en el `Referer` de cualquier
 * recurso externo que cargue la página. Y `?from=2026-03-03&to=2026-03-10` en la pantalla de
 * insulina no es un detalle de interfaz: dice que esa persona registra insulina y qué tramo estaba
 * revisando, sin descifrar nada. Además, publicar en la URL exige una propiedad pública de Livewire,
 * que es justo lo que el ADR 0002 quiere fuera del snapshot. El precio de no hacerlo es que el rango
 * no se puede compartir por enlace ni sobrevive a un F5, y ninguna de las dos cosas vale ese riesgo:
 * volver a elegir «última semana» cuesta un clic.
 *
 * **El rango es semiabierto `[from, to)`**, igual que en `HealthEventPage::fetchEvents()`: el
 * inicio entra y el fin no. Por eso «hasta el 20 de marzo» se traduce a la medianoche del 21 en
 * hora local, y no a un `23:59:59.999999` que dejaría fuera cualquier registro de la última
 * fracción de segundo del día.
 *
 * **Las dos puntas son medianoches LOCALES**, convertidas al instante UTC que les corresponde. La
 * persona elige un día de calendario en su reloj, no un instante en UTC: acotar por medianoche UTC
 * le movería el corte varias horas y le escondería —o le colaría— los registros del borde.
 *
 * **Los atajos hablan el mismo vocabulario que el panel de inicio**: «último día», «última semana»
 * y «último mes» son las mismas ventanas de `statistics.js` (`WINDOW_DAYS`), importadas de allí y no
 * copiadas, para que un resumen y un historial que dicen lo mismo cuenten los mismos días.
 *
 * Las funciones exportadas antes de `dateRangeControl()` son lógica pura, probable sin Alpine ni
 * DOM (`tests/js/dateRange.test.mjs`).
 */

import { canonicalDate } from '../crypto/canonicalDate.js';
import { t } from '../i18n/index.js';
import { WINDOW_DAYS } from './statistics.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Valor de un `<input type="date">`: día de calendario, sin hora ni desfase. */
const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Atajos del desplegable, en el orden en que se ofrecen. Los tokens son el contrato con el
 * `<option value="...">` que renderiza `resources/views/phr/partials/date-range.blade.php`.
 *
 * @type {Readonly<list<string>>}
 */
export const RANGE_PRESETS = Object.freeze(['all', 'day', 'week', 'month', 'custom']);

/**
 * Atajo por defecto **del historial**: `day`, las últimas 24 horas.
 *
 * **Por qué se acota de oficio.** Sin acotar, abrir una pantalla de historial se trae y descifra
 * todo lo que quepa en la página, y aquí el descifrado ocurre en el navegador: con un historial de
 * años eso es descarga, memoria y CPU del dispositivo de quien mira, y el coste crece solo con el
 * tiempo. El periodo por defecto tiene que ser el barato, y el caro se pide.
 *
 * **La objeción que llevó al `all` original sigue siendo válida y no se descarta, se mitiga.** Ante
 * un historial clínico, «no aparece» se lee como «se ha perdido», así que un filtro puesto de
 * oficio solo es aceptable si es imposible no verlo. De ahí las dos condiciones que cumple
 * `resources/views/phr/partials/date-range.blade.php` y que fija
 * `tests/Feature/HealthEventRangeTest.php`:
 *
 * 1. El periodo en vigor se lee **junto al historial**, en un aviso permanente y en palabras («se
 *    está mostrando: último día»), no solo como opción elegida dentro de un desplegable, que es
 *    justo lo que nadie mira.
 * 2. Llegar a todo el historial es **un botón visible** («ver todos los registros», ver
 *    {@see dateRangeControl}), no una opción escondida en ese desplegable, y el aviso dice
 *    explícitamente que lo que falta está oculto por el periodo, no perdido.
 *
 * `day` y no `week` ni `month` porque es el mismo periodo con el que arranca el panel de inicio, y
 * dos pantallas que se abren solas no deberían discrepar sobre qué es «lo reciente»; subir el
 * defecto es un clic, y el clic está a la vista.
 */
export const DEFAULT_RANGE_PRESET = 'day';

/**
 * Error de rango, distinguible de un fallo de cripto o de red: lo provoca lo que se ha tecleado en
 * el control, así que la pantalla lo enseña junto al control y no como fallo de carga.
 */
export class DateRangeError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'DateRangeError';
    }
}

/**
 * Instante UTC de la medianoche local de un día de calendario, con el desfase **de ese día** y no
 * el de hoy, para que el horario de verano no desplace el corte.
 *
 * `dayOffset` se suma al día antes de resolver el desfase (`Date.UTC` normaliza el desbordamiento
 * de mes y de año), que es como se obtiene la punta superior excluida: la medianoche del día
 * siguiente.
 *
 * @param {string} value Valor de un `<input type="date">` (`YYYY-MM-DD`).
 * @param {object} [options]
 * @param {number} [options.dayOffset] Días a sumar al día indicado.
 * @param {number} [options.timezoneOffsetMinutes] Desfase a usar en vez del del dispositivo, con el
 *        convenio de `Date.prototype.getTimezoneOffset()` (UTC menos local). Solo existe para poder
 *        probar esto con un desfase distinto de cero sin depender de la zona de quien ejecuta.
 * @returns {string} Fecha canónica del ADR 0004.
 * @throws {DateRangeError} Si el valor no es un día de calendario válido.
 */
export function localDayStartToCanonical(value, { dayOffset = 0, timezoneOffsetMinutes } = {}) {
    const match = DATE_INPUT_PATTERN.exec(value ?? '');

    if (match === null) {
        throw new DateRangeError(t('range.error.badDate'));
    }

    const [, year, month, day] = match.map(Number);

    /**
     * `Date.UTC` normaliza en silencio un mes 13 o un día 32, así que un día imposible se rechaza
     * aquí, antes de convertirlo: aceptar la normalización significaría enseñar el rango de otro
     * mes sin decirlo.
     */
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        throw new DateRangeError(t('range.error.badDate'));
    }

    const shiftedDay = day + dayOffset;

    const offsetMinutes = timezoneOffsetMinutes
        ?? new Date(year, month - 1, shiftedDay).getTimezoneOffset();

    const utcMilliseconds = Date.UTC(year, month - 1, shiftedDay) + offsetMinutes * 60_000;

    return canonicalDate(new Date(utcMilliseconds));
}

/**
 * Rango de un atajo relativo (`day`, `week`, `month`) o de la ausencia de atajo (`all`).
 *
 * Los dos relativos dejan la punta superior abierta (`to === null`) en vez de fijarla en «ahora»:
 * un registro con fecha unos minutos por delante del reloj del servidor —relojes que no coinciden,
 * o una toma que se apunta antes de hacerla— desaparecería del historial justo después de
 * guardarlo, que es la peor forma posible de estrenar un filtro.
 *
 * @param {string} preset
 * @param {Date} [referenceInstant] «Ahora», parametrizable para poder probarlo.
 * @returns {{from: string|null, to: string|null}}
 * @throws {DateRangeError} Si el atajo no es uno de los relativos ni `all`.
 */
export function presetRange(preset, referenceInstant = new Date()) {
    if (preset === 'all') {
        return { from: null, to: null };
    }

    const days = WINDOW_DAYS[preset];

    if (days === undefined) {
        throw new DateRangeError(t('range.error.badPreset', { preset }));
    }

    return { from: canonicalDate(new Date(referenceInstant.getTime() - days * MS_PER_DAY)), to: null };
}

/**
 * Rango a medida a partir de los dos `<input type="date">`.
 *
 * Las dos fechas son obligatorias: con una sola, «desde el 3» y «hasta el 3» son peticiones
 * distintas y adivinar cuál se quiso decir produce un historial que no es el que se pidió.
 *
 * @param {string} fromDay `YYYY-MM-DD`, incluido.
 * @param {string} toDay `YYYY-MM-DD`, incluido (se traduce a la medianoche del día siguiente).
 * @param {object} [options]
 * @param {number} [options.timezoneOffsetMinutes] Ver {@see localDayStartToCanonical}.
 * @returns {{from: string, to: string}}
 * @throws {DateRangeError} Si falta alguna fecha, no es válida, o el inicio va después del fin.
 */
export function customRange(fromDay, toDay, { timezoneOffsetMinutes } = {}) {
    if (typeof fromDay !== 'string' || typeof toDay !== 'string' || fromDay === '' || toDay === '') {
        throw new DateRangeError(t('range.error.incomplete'));
    }

    /** Comparación de cadenas: `YYYY-MM-DD` ordena igual como texto que como fecha. */
    if (fromDay > toDay) {
        throw new DateRangeError(t('range.error.order'));
    }

    return {
        from: localDayStartToCanonical(fromDay, { timezoneOffsetMinutes }),
        to: localDayStartToCanonical(toDay, { dayOffset: 1, timezoneOffsetMinutes }),
    };
}

/**
 * Rango efectivo del control, sea cual sea el atajo elegido.
 *
 * @param {object} params
 * @param {string} params.preset Uno de {@see RANGE_PRESETS}.
 * @param {string} [params.fromDay] Solo se lee con el atajo `custom`.
 * @param {string} [params.toDay] Solo se lee con el atajo `custom`.
 * @param {Date} [params.referenceInstant]
 * @param {number} [params.timezoneOffsetMinutes]
 * @returns {{from: string|null, to: string|null}}
 * @throws {DateRangeError}
 */
export function resolveRange({ preset, fromDay, toDay, referenceInstant, timezoneOffsetMinutes }) {
    if (preset === 'custom') {
        return customRange(fromDay, toDay, { timezoneOffsetMinutes });
    }

    return presetRange(preset, referenceInstant);
}

/**
 * Estado y comportamiento del control de rango, para mezclar en el componente Alpine de cada
 * pantalla de historial (`...dateRangeControl()`).
 *
 * **Contrato con la pantalla que lo mezcla**: tiene que exponer un `loadHistory()`, que es lo que
 * `applyRange()` vuelve a llamar, y su `loadHistory()` tiene que pasar `historyRange()` a
 * `fetchEvents`. A cambio, este objeto aporta las tres propiedades que la plantilla común
 * `phr.partials.date-range` enlaza con `x-model` (`rangePreset`, `rangeFromDay`, `rangeToDay`) y el
 * hueco de error `rangeError`.
 *
 * Las tres van con `x-model` y no con `x-ref`: son estado del cliente, no dato clínico, y hace
 * falta que sean reactivas para que los dos campos de fecha aparezcan solo con el atajo `custom`.
 * `x-model` es de Alpine y no sube nada al servidor; el que el ADR 0002 prohíbe es `wire:model`.
 *
 * @param {object} [options]
 * @param {string} [options.preset] Atajo con el que arranca la pantalla. Las de historial y el
 *        panel de inicio se quedan con el defecto (ver {@see DEFAULT_RANGE_PRESET}); solo la
 *        pantalla de compartir pide otro, porque allí el rango es lo que se va a compartir.
 * @returns {object}
 */
export function dateRangeControl({ preset = DEFAULT_RANGE_PRESET } = {}) {
    return {
        rangePreset: preset,
        rangeFromDay: '',
        rangeToDay: '',

        /** Mensaje del último rango mal formado; se limpia en cuanto uno vale. */
        rangeError: '',

        /**
         * Rango que toca aplicar ahora mismo. Si lo tecleado no vale, devuelve el rango abierto y
         * deja dicho el porqué en `rangeError`: más vale enseñar el historial entero con un aviso
         * que dejar la pantalla en blanco.
         *
         * @returns {{from: string|null, to: string|null}}
         */
        historyRange() {
            try {
                const range = resolveRange({
                    preset: this.rangePreset,
                    fromDay: this.rangeFromDay,
                    toDay: this.rangeToDay,
                });

                this.rangeError = '';

                return range;
            } catch (failure) {
                this.rangeError = failure instanceof DateRangeError ? failure.message : t('range.error.badDate');

                return { from: null, to: null };
            }
        },

        /**
         * Vuelve a cargar el historial con el rango en vigor. Lo llaman tanto el desplegable (al
         * cambiar de atajo) como el botón de aplicar del rango a medida.
         */
        applyRange() {
            void this.loadHistory();
        },

        /**
         * Salida a «todo el historial» en un solo gesto.
         *
         * Es la mitad ejecutable de la mitigación que justifica acotar de oficio (ver
         * {@see DEFAULT_RANGE_PRESET}): como el defecto ya no es `all`, quitar el recorte no puede
         * costar abrir un desplegable y buscar la opción correcta. La plantilla lo saca como botón
         * visible en el propio aviso de periodo, junto al historial.
         *
         * Limpia también el rango a medida: dejar dos fechas escritas en los campos después de
         * decir «ver todos los registros» invita a creer que siguen aplicándose.
         */
        showAllRecords() {
            this.rangePreset = 'all';
            this.rangeFromDay = '';
            this.rangeToDay = '';

            this.applyRange();
        },
    };
}
