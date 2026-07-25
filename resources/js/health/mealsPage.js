/**
 * Componente Alpine de la pantalla de comidas (ADR 0002, ADR 0004, ADR 0005, ADR 0006).
 *
 * El contrato del DOM lo fija `resources/views/phr/pages/meals.blade.php`: nada de `wire:model`
 * (ADR 0002), los campos comunes se leen por `x-ref`, y la lista de alimentos vive en un
 * contenedor `wire:ignore` cuyas filas se clonan desde un `<template>` renderizado por Blade (así
 * el `<select>` de unidad de cada fila nueva sigue siendo HTML escrito por el servidor, no por
 * Alpine, tal y como exige el ADR 0002). El sobre cifrado sube como argumento de `storeEvent` de
 * `HealthEventPage`, nunca como propiedad de Livewire.
 *
 * **El servidor no puede filtrar por tipo** (ADR 0006, ver JSDoc de `HealthEventPage::fetchEvents()`):
 * `fetchEvents` trae todos los eventos del usuario y aquí se descifra cada uno y se descarta el que
 * no sea `type === 'meal'`. Un sobre que no abre no tumba la pantalla: se cuenta y se avisa, porque
 * un fallo de descifrado silencioso es justo lo que el ADR 0004 prohíbe.
 *
 * **No hay selector de "origen del dato".** Hoy toda comida se teclea a mano: no existe ninguna
 * integración con un aparato que registre comidas, así que un `<select>` "¿manual o aparato?" no
 * tendría una segunda respuesta real y solo invitaría a contestarlo mal. `origin` (token de
 * `App\Catalog\DataOrigin`) sigue viajando en el sobre cifrado porque el ADR 0006 lo exige y no se
 * puede añadir después sin re-cifrar todo lo ya guardado, pero aquí se fija siempre a `manual`
 * dejando que `buildCommonEventFields()` use su valor por defecto (ver `eventCommonFields.js`,
 * ampliado con esta misma explicación): el día que exista una importación automática, será ella
 * quien escriba `origin: 'device'`, no este formulario.
 *
 * **La lista de alimentos es un dato ordenado** (ADR 0006): el orden en que aparecen las filas en
 * el DOM es el orden que se guarda, y `buildMealContent` lo respeta tal cual porque nunca reordena
 * ni el DOM ni el array que construye a partir de él.
 *
 * **Los alimentos NO se codifican contra ningún vocabulario** (excepción consciente al ADR 0005,
 * justificada en el ADR propio de esta pantalla): el nombre de cada alimento es texto libre. La
 * cantidad de cada alimento viaja siempre como cadena, nunca como número (ADR 0004: decimales como
 * cadena), y la unidad sí va codificada en UCUM (`App\Catalog\FoodQuantityUnit`).
 *
 * **La cantidad es un campo numérico clínico**, así que pasa por `numericValue.js` como el valor de
 * glucemia o la dosis de insulina: dos decimales como mucho, nunca negativa y la coma normalizada a
 * punto antes de sellar el sobre. Sin esa normalización, «250,5 g» y «250.5 g» acabarían guardados
 * como dos cadenas distintas dentro de un dato ya cifrado, imposible de corregir después.
 *
 * **Una fila totalmente vacía no cuenta como alimento.** El formulario siempre arranca con una fila
 * en blanco para que quien no tiene nada que anotar no tenga que "añadir" nada; `buildMealContent`
 * la descarta sin más. Una fila a medias (con nombre pero sin cantidad, o al revés) sí es un error:
 * silenciarla guardaría un alimento incompleto sin que la persona se diera cuenta.
 *
 * Las funciones exportadas antes de `mealsPage()` son la lógica pura del componente, para poder
 * probarlas sin montar Alpine (`tests/js/mealsPage.test.mjs`).
 */

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { canonicalDate } from '../crypto/canonicalDate.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { formatDateTime, t } from '../i18n/index.js';
import { buildCommonEventFields } from './eventCommonFields.js';
import { openEvent, sealEvent } from './eventEnvelope.js';
import { parseNumericValue } from './numericValue.js';

/**
 * Patrón de un `<input type="datetime-local" step="1">`: sin desfase, porque es hora local del
 * dispositivo (`YYYY-MM-DDTHH:MM` o `YYYY-MM-DDTHH:MM:SS`).
 */
const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Descompone el valor de un `datetime-local` en sus campos de calendario, sin interpretarlo
 * todavía en ninguna zona horaria.
 *
 * @param {string} value
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number}}
 * @throws {Error} Si el valor no tiene la forma esperada.
 */
export function parseDatetimeLocalFields(value) {
    const match = DATETIME_LOCAL_PATTERN.exec(value);

    if (match === null) {
        throw new Error(t('common.badDatetime', { value }));
    }

    const [, year, month, day, hour, minute, second = '00'] = match;

    return {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
    };
}

/**
 * Da forma `±HH:MM` a un desfase, con el mismo convenio de signo que el campo `tz` del ADR 0006
 * (positivo cuando la hora local va por delante de UTC).
 *
 * @param {number} offsetMinutes Local menos UTC, en minutos.
 * @returns {string}
 */
export function formatTzOffset(offsetMinutes) {
    const sign = offsetMinutes < 0 ? '-' : '+';
    const absolute = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
    const minutes = String(absolute % 60).padStart(2, '0');

    return `${sign}${hours}:${minutes}`;
}

/**
 * Convierte un `datetime-local` (hora local sin desfase) al instante correcto y a su forma
 * canónica (ADR 0004), junto con el desfase para el campo `tz` del ADR 0006.
 *
 * @param {string} value Valor crudo del `<input type="datetime-local">`.
 * @param {object} [options]
 * @param {number} [options.timezoneOffsetMinutes] Desfase a usar en vez del de `Date` (minutos,
 *        convenio de `getTimezoneOffset`: UTC menos local).
 * @returns {{occurredAt: string, tz: string}}
 */
export function datetimeLocalToCanonical(value, { timezoneOffsetMinutes } = {}) {
    const fields = parseDatetimeLocalFields(value);

    const offsetMinutes = timezoneOffsetMinutes
        ?? new Date(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second)
            .getTimezoneOffset();

    const utcMilliseconds = Date.UTC(
        fields.year,
        fields.month - 1,
        fields.day,
        fields.hour,
        fields.minute,
        fields.second
    ) + offsetMinutes * 60_000;

    return {
        occurredAt: canonicalDate(new Date(utcMilliseconds)),
        tz: formatTzOffset(-offsetMinutes),
    };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function trimmedOrEmpty(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Reduce la lista cruda de filas de alimento (tal cual se leen del DOM) a la lista ordenada que
 * entra en `data.foods`. Una fila totalmente vacía se descarta en silencio (no es un alimento); una
 * fila a medias es un error, porque guardarla completaría el dato con un valor que nadie escribió.
 *
 * La cantidad pasa por `parseNumericValue` (ver `numericValue.js`): rechaza negativos y más de dos
 * decimales, y normaliza la coma a punto. El resultado sigue siendo cadena, nunca `Number`
 * (ADR 0004).
 *
 * @param {list<{name: string, quantity: string, unit: string}>} rawFoods En el mismo orden en que
 *        aparecen en el DOM.
 * @returns {list<{name: string, quantity: string, unit: string}>} Cantidad siempre como cadena
 *          (ADR 0004).
 * @throws {Error} Si alguna fila tiene solo parte de sus campos rellenados o la cantidad no es un
 *         número válido.
 */
export function normalizeFoods(rawFoods) {
    const foods = [];

    for (const rawFood of rawFoods) {
        const name = trimmedOrEmpty(rawFood.name);
        const quantity = trimmedOrEmpty(rawFood.quantity);
        const unit = trimmedOrEmpty(rawFood.unit);

        const filledCount = [name, quantity, unit].filter((field) => field !== '').length;

        if (filledCount === 0) {
            continue;
        }

        if (filledCount < 3) {
            throw new Error(t('meals.incompleteFood'));
        }

        foods.push({ name, quantity: parseNumericValue(quantity, t('field.quantity')), unit });
    }

    return foods;
}

/**
 * Construye el contenido en claro de un evento de comida, con la forma del ADR 0006.
 *
 * `common` son los campos que comparte cualquier tipo de evento (aparato, quién registra, nota) y
 * van en el nivel superior del contenido, no dentro de `data`. Esta función nunca los recibe con
 * `origin`: el origen del dato es siempre `manual` en un formulario de entrada a mano (ver JSDoc del
 * módulo), así que se deja que `common` traiga el valor por defecto de `buildCommonEventFields()`.
 *
 * @param {object} params
 * @param {string} params.mealType Token de `App\Catalog\MealType`.
 * @param {list<{name: string, quantity: string, unit: string}>} params.rawFoods Filas del DOM, en
 *        orden, sin normalizar todavía.
 * @param {string} params.tz Desfase `±HH:MM` del momento del registro.
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Ya construido por `buildCommonEventFields`, con `origin` en su valor por defecto (`manual`).
 * @returns {{v: 1, type: 'meal', tz: string, origin: string, recordedBy: string, device?: string,
 *           note?: string, data: {mealType: string, foods: list<{name: string, quantity: string, unit: string}>}}}
 * @throws {Error} Si falta el tipo de comida o alguna fila de alimento está a medias.
 */
export function buildMealContent({ mealType, rawFoods, tz, common }) {
    if (typeof mealType !== 'string' || mealType.trim() === '') {
        throw new Error(t('meals.missingMealType'));
    }

    const foods = normalizeFoods(rawFoods);

    return {
        v: 1,
        type: 'meal',
        tz,
        ...common,
        data: { mealType, foods },
    };
}

/**
 * Descarta los eventos descifrados que no son de tipo `meal`. El servidor no puede hacer este
 * filtro porque el tipo va cifrado dentro del sobre (ADR 0006): es responsabilidad del cliente.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Ya descifrados.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterMealEvents(events) {
    return events.filter((event) => event.content?.type === 'meal');
}

/**
 * Resuelve la etiqueta de un token de catálogo (tipo de comida o unidad), tolerando un token que ya
 * no esté en el catálogo actual: se muestra el token tal cual en vez de romper la vista.
 *
 * @param {list<{token?: string, code?: string, label: string}>} entries
 * @param {string} token
 * @param {'token'|'code'} key
 * @returns {string}
 */
function resolveCatalogLabel(entries, token, key) {
    return entries.find((entry) => entry[key] === token)?.label ?? token;
}

/**
 * Da forma legible a un evento de comida ya descifrado, para pintar el historial sin volcar JSON
 * (lo pide la pantalla: "el historial debe mostrar la comida con su lista de alimentos legible").
 * Tolera un evento sin nota y sin aparato (ADR 0006: ambos son opcionales y se omiten del contenido
 * cuando no se indicaron), sin lanzar ni inventar un valor por defecto para ellos.
 *
 * Tolera también un sobre que abre pero cuyo contenido no tiene la forma esperada (`data` ausente o
 * `foods` que no es una lista): se pinta lo que haya en vez de lanzar. Un solo registro raro no
 * puede dejar el historial entero en blanco, que es lo mismo que persigue el recuento de sobres que
 * no abren.
 *
 * @param {{mealTypes: list<{token: string, label: string}>, units: list<{code: string, label: string}>}} catalog
 * @param {{data: {mealType: string, foods: list<{name: string, quantity: string, unit: string}>}, note?: string, device?: string}} content
 * @returns {{mealTypeLabel: string, foods: list<{name: string, quantity: string, unitLabel: string}>, note: string|null, device: string|null}}
 */
export function describeMealEvent(catalog, content) {
    const data = content.data ?? {};
    const rawFoods = Array.isArray(data.foods) ? data.foods : [];

    return {
        mealTypeLabel: resolveCatalogLabel(catalog.mealTypes, data.mealType ?? '', 'token'),
        foods: rawFoods.map((food) => ({
            name: food.name,
            quantity: food.quantity,
            unitLabel: resolveCatalogLabel(catalog.units, food.unit, 'code'),
        })),
        note: typeof content.note === 'string' && content.note !== '' ? content.note : null,
        device: typeof content.device === 'string' && content.device !== '' ? content.device : null,
    };
}

/** @returns {string} Ahora mismo, en la forma que espera un `<input type="datetime-local" step="1">`. */
function nowAsDatetimeLocalValue() {
    return toDatetimeLocalValue(new Date());
}

/**
 * @param {Date} date
 * @returns {string}
 */
function toDatetimeLocalValue(date) {
    const pad = (value) => String(value).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Trazado de Heroicons v2 (outline, 24×24), el mismo pastel de `Meals::$navigationIcon`, para que
 * el icono guía de cada registro sea el mismo que el de la sección.
 */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    cake: 'M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.87c1.355 '
        + '0 2.697.055 4.024.165C17.155 8.51 18 9.473 18 10.608v2.513m-12 0v6.635m12-6.635v6.635m-12 0v-.108c0-1.135.845-2.098 '
        + '1.976-2.192a48.424 48.424 0 0 1 8.048 0c1.131.094 1.976 1.057 1.976 2.192v.108m-12 0v.108c0 1.135.845 2.098 1.976 '
        + '2.192a48.424 48.424 0 0 0 8.048 0c1.131-.094 1.976-1.057 1.976-2.192v-.108M12 4.875a1.125 1.125 0 1 0 0-2.25 1.125 1.125 0 0 0 0 2.25Z',
});

/**
 * Icono decorativo de 20px (DESIGN.md § Lists: «20px icon»). Va con `aria-hidden`.
 *
 * @param {'warning'|'info'|'cake'} name
 * @param {string} className
 * @returns {SVGSVGElement}
 */
function createIcon(name, className) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');

    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);

    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', ICON_PATHS[name]);
    svg.appendChild(path);

    return svg;
}

/**
 * Aviso en bloque con icono (DESIGN.md § Chips (Status Chip): color + icono + texto, nunca color a
 * secas, Do's #3).
 *
 * @param {object} params
 * @param {'error'|'info'} params.tone
 * @param {string} params.message
 * @returns {HTMLDivElement}
 */
function createCallout({ tone, message }) {
    const callout = document.createElement('div');

    /**
     * Los dos tonos salen de los tokens de aviso (`error-*` / `info-*`, ver `theme.css`), no de las
     * rampas `danger-*` / `primary-*`: los tokens ya llevan dentro el par corregido a AA y su
     * equivalente de § Dark Mode, mientras que `bg-danger-50` no conmuta con el tema y dejaría el
     * aviso ilegible en oscuro. Mismos tonos que la pantalla de glucemia.
     */
    callout.className = tone === 'error'
        ? 'flex items-start gap-3 rounded-control border border-error-outline bg-error-surface p-pad-md '
            + 'text-body text-error-ink shadow-large'
        : 'flex items-start gap-3 rounded-control border border-info-outline bg-info-surface p-pad-md '
            + 'text-body-lg text-info-ink';

    if (tone === 'error') {
        callout.setAttribute('role', 'alert');
    }

    callout.appendChild(createIcon(tone === 'error' ? 'warning' : 'info', 'size-5 shrink-0'));

    const text = document.createElement('p');
    text.textContent = message;
    callout.appendChild(text);

    return callout;
}

/**
 * Chip de filtro (DESIGN.md § Chips · Filter Chip): píldora #F0F7FF con borde #CBD5E1 y texto
 * #475569 de 13px semibold, 6px/14px de relleno. Se usa para cada alimento de la lista.
 *
 * El nombre del alimento es prosa y va en la tipografía de texto; la cantidad y su unidad son un
 * valor de medida y van en IBM Plex Mono (Do's #7), en su propio `<span>`: mezclarlos en una sola
 * cadena dejaría el número en la tipografía de prosa, que es justo lo que la regla evita.
 *
 * @param {string} name Nombre del alimento, texto libre.
 * @param {string} measurement Cantidad y unidad ya compuestas, p. ej. «250 g».
 * @returns {HTMLSpanElement}
 */
function createFoodChip(name, measurement) {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center gap-1.5 rounded-full border border-chip-outline '
        + 'bg-chip-surface px-3.5 py-1.5 text-helper font-semibold text-chip-ink';

    const nameText = document.createElement('span');
    nameText.textContent = name;
    chip.appendChild(nameText);

    const measurementText = document.createElement('span');
    measurementText.className = 'font-mono';
    measurementText.textContent = measurement;
    chip.appendChild(measurementText);

    return chip;
}

/**
 * Chip de estado (DESIGN.md § Chips · Status Chip, variante info): 12px bold en mayúsculas, 4px de
 * radio, 4px/12px de relleno. Se usa para el tipo de comida.
 *
 * El tamaño va en `text-status-chip` y no en `text-caption`: los dos son 12px, pero el segundo es
 * el papel de las marcas de tiempo y arrastra su tracking de 0.01em, que aquí no pinta nada.
 *
 * @param {string} label
 * @returns {HTMLSpanElement}
 */
function createStatusChip(label) {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center rounded-chip border border-info-outline bg-info-surface '
        + 'px-3 py-1 text-status-chip uppercase text-info-ink';
    chip.textContent = label;

    return chip;
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

    return t('common.saveFailed');
}

/**
 * Factoría del componente Alpine. Se registra como `phrMealsPage`.
 *
 * @returns {object}
 */
export function mealsPage() {
    return {
        error: '',
        catalog: null,
        loading: false,

        /** Sobres descifrados que fallaron al abrir en la última carga (no tumban la pantalla). */
        failedToOpenCount: 0,

        init() {
            this.catalog = JSON.parse(document.querySelector('[data-phr-meals-catalog]').textContent);

            /**
             * Las opciones de `mealType`, `recordedBy` y de la unidad de cada fila de alimento las
             * renderiza el servidor en Blade (ADR 0002, ADR 0005): no se rellenan aquí. Ver el
             * comentario al inicio de `meals.blade.php`.
             */
            this.$refs.occurredAt.value = nowAsDatetimeLocalValue();

            /** El formulario arranca con una fila de alimento en blanco, lista para rellenar. */
            this.addFoodRow();

            if (isUnlocked()) {
                void this.loadHistory();

                return;
            }

            this.renderLocked();
            document.addEventListener(SESSION_READY_EVENT, () => void this.loadHistory(), { once: true });
        },

        /**
         * Clona la fila de `x-ref="foodRowTemplate"` (HTML escrito por Blade, con sus `<option>`
         * de unidad ya puestos) y la añade al final de `x-ref="foods"`, para que el orden en el DOM
         * sea el orden de guardado (ADR 0006).
         */
        addFoodRow() {
            const row = this.$refs.foodRowTemplate.content.firstElementChild.cloneNode(true);

            row.querySelector('[data-food-remove]').addEventListener('click', () => {
                row.remove();
            });

            this.$refs.foods.appendChild(row);
        },

        /** Lee las filas de alimento del DOM, en orden, tal cual las tecleó la persona. */
        readFoodRows() {
            return [...this.$refs.foods.querySelectorAll('[data-food-row]')].map((row) => ({
                name: row.querySelector('[data-food-name]').value,
                quantity: row.querySelector('[data-food-quantity]').value,
                unit: row.querySelector('[data-food-unit]').value,
            }));
        },

        /**
         * Guarda el registro.
         *
         * `loading` cubre TODA la operación, no solo la descarga del historial: entre el clic y el
         * repintado hay derivación de clave, sellado AEAD e ida y vuelta a Livewire, y sin señal
         * alguna la persona vuelve a pulsar el botón y guarda la misma comida dos veces. La
         * plantilla lo usa para deshabilitarlo, marcar `aria-busy` y cambiar el texto (Do's #3),
         * igual que la pantalla de glucemia y las de acceso.
         *
         * @param {SubmitEvent} [event]
         */
        async submit() {
            this.error = '';
            this.loading = true;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    throw new Error(t('common.noSession'));
                }

                const localDatetime = this.$refs.occurredAt.value;

                if (localDatetime === '') {
                    throw new Error(t('common.missingDate'));
                }

                const { occurredAt, tz } = datetimeLocalToCanonical(localDatetime);

                /**
                 * Sin `origin`: en un formulario de entrada manual siempre vale `manual`, así que
                 * `buildCommonEventFields()` lo fija con su valor por defecto (ver JSDoc del
                 * módulo). No hay ningún `x-ref="origin"` que leer.
                 */
                const common = buildCommonEventFields({
                    device: this.$refs.device.value,
                    recordedBy: this.$refs.recordedBy.value,
                    note: this.$refs.note.value,
                });

                const content = buildMealContent({
                    mealType: this.$refs.mealType.value,
                    rawFoods: this.readFoodRows(),
                    tz,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.foods.replaceChildren();
                this.addFoodRow();
                this.$refs.device.value = '';
                this.$refs.note.value = '';

                await this.loadHistory();
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /** Descarga, descifra, filtra y pinta el historial. */
        async loadHistory() {
            this.loading = true;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    this.renderLocked();

                    return;
                }

                const rawEvents = await this.$wire.fetchEvents();

                let failedToOpen = 0;
                const opened = [];

                for (const rawEvent of rawEvents) {
                    try {
                        const content = openEvent({
                            userId,
                            occurredAt: rawEvent.occurredAt,
                            envelope: rawEvent.payload,
                        });

                        opened.push({ id: rawEvent.id, occurredAt: rawEvent.occurredAt, content });
                    } catch {
                        /** Un sobre que no abre no tumba la pantalla (ADR 0004): se cuenta y se avisa. */
                        failedToOpen += 1;
                    }
                }

                this.failedToOpenCount = failedToOpen;

                const mealEvents = filterMealEvents(opened);

                this.renderList(mealEvents);
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /** Sin clave no se puede descifrar nada: se dice, no se pinta una lista vacía. */
        renderLocked() {
            this.$refs.list.replaceChildren(createCallout({ tone: 'info', message: t('common.locked.history') }));
        },

        /** @param {list<{id: string, occurredAt: string, content: object}>} mealEvents */
        renderList(mealEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (mealEvents.length === 0) {
                const empty = document.createElement('p');
                /** El papel de texto secundario, no un tono de la rampa; nunca un gris apagado (Don'ts #10). */
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('meals.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                /** El borde va en cada item (DESIGN.md § Lists), no en un divisor del contenedor. */
                list.className = 'flex flex-col';

                for (const event of mealEvents) {
                    list.appendChild(this.renderListItem(event));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * Item de historial con la forma de DESIGN.md § Lists: borde inferior #E2E8F0, 14px/16px de
         * relleno, 48px de alto mínimo (objetivo táctil, Do's #2), icono guía de 20px en #0077B6.
         *
         * La comida se pinta legible, no como volcado de JSON: un chip con el tipo de comida y, por
         * cada alimento, un chip con «nombre» y, en monoespaciada, «cantidad unidad», porque son
         * valor de medida (Do's #7).
         *
         * El `<li>` NO lleva `hover:` ni `active:`: DESIGN.md § Lists reserva esos dos estados a un
         * elemento de lista pulsable, y este no es enlace ni botón —no tiene destino, ni manejador,
         * ni foco—. Prometer una interacción que no ocurre es peor que no prometerla. Mismo criterio
         * que la lista de glucemia.
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @returns {HTMLLIElement}
         */
        renderListItem(event) {
            const described = describeMealEvent(this.catalog, event.content);

            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('cake', 'mt-0.5 size-5 shrink-0 text-accent'));

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-2';

            /** Un contenido sin tipo de comida no pinta un chip vacío: se omite. */
            if (described.mealTypeLabel !== '') {
                const header = document.createElement('div');
                header.className = 'flex flex-wrap items-center gap-2';
                header.appendChild(createStatusChip(described.mealTypeLabel));
                body.appendChild(header);
            }

            if (described.foods.length === 0) {
                const noFoods = document.createElement('p');
                noFoods.className = 'text-body-sm text-ink-secondary';
                noFoods.textContent = t('meals.noFoods');
                body.appendChild(noFoods);
            } else {
                const foods = document.createElement('div');
                foods.className = 'flex flex-wrap items-center gap-2';

                for (const food of described.foods) {
                    /** Cantidad y unidad son valor de medida: van en monoespaciada (Do's #7). */
                    foods.appendChild(createFoodChip(food.name, `${food.quantity} ${food.unitLabel}`));
                }

                body.appendChild(foods);
            }

            if (described.note !== null) {
                const note = document.createElement('p');
                note.className = 'text-body-sm text-ink-secondary';
                note.textContent = described.note;
                body.appendChild(note);
            }

            /**
             * Texto secundario: marca de tiempo (numérica → monoespaciada, en el tamaño Code de
             * § Typography) y, si lo hay, el aparato. Mismo formato de fecha que el resto de
             * historiales: `formatDateTime`, en el idioma activo.
             */
            const meta = document.createElement('p');
            meta.className = 'font-mono text-code text-ink-secondary';
            meta.textContent = described.device !== null
                ? `${formatDateTime(event.occurredAt)} · ${described.device}`
                : formatDateTime(event.occurredAt);
            body.appendChild(meta);

            item.appendChild(body);

            return item;
        },
    };
}
