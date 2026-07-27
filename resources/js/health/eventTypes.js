/**
 * Vocabulario de tipos de evento y filtro por tipo (ADR 0006).
 *
 * **Por qué vive fuera de cualquier pantalla.** Los mismos seis tipos gobiernan el panel del
 * paciente, el lector del profesional y la vista previa de la pantalla de compartir. Mientras la
 * lista y el filtro estuvieron dentro de `dashboardPage.js`, cualquier consumidor nuevo tenía que
 * copiarlos, y dos copias de una lista de tipos clínicos divergen en cuanto se añade el séptimo:
 * una pantalla dejaría de enseñar un tipo de registro sin que nadie lo note, que es la peor clase de
 * fallo en un historial (una ausencia se lee como «no hay», no como «no se pinta»).
 *
 * Aquí no se importa nada de Livewire, ni de `$wire`, ni del DOM: son datos y funciones puras.
 */

/**
 * Tipos de evento conocidos, en el orden en que se ofrecen en los filtros.
 *
 * Los tokens son los que viajan dentro del sobre cifrado (ADR 0006) y son el contrato con los
 * `<input type="checkbox">` que renderiza `resources/views/phr/pages/dashboard.blade.php`: allí se
 * escribe el mismo token en el `x-model`, porque las opciones las pinta el servidor (el morph del
 * DOM borraría cualquier opción escrita por JavaScript).
 *
 * @type {Readonly<list<string>>}
 */
export const EVENT_TYPES = Object.freeze([
    'glucose',
    'bloodPressure',
    'insulin',
    'meal',
    'bodyWeight',
    'temperature',
]);

/**
 * Estado inicial del filtro: **todos los tipos marcados**.
 *
 * Estrenar una pantalla con algún tipo desmarcado escondería registros que existen sin que nadie lo
 * haya pedido, y en un historial clínico «no aparece» se lee como «se ha perdido». Quien quiera
 * mirar un solo tipo lo desmarca; nadie tiene que descubrir por qué le falta algo.
 *
 * @returns {Record<string, boolean>}
 */
export function defaultSelectedTypes() {
    return Object.fromEntries(EVENT_TYPES.map((type) => [type, true]));
}

/**
 * Tipos marcados ahora mismo, en el orden de {@see EVENT_TYPES}.
 *
 * @param {Record<string, boolean>} selectedTypes
 * @returns {list<string>}
 */
export function selectedTypeTokens(selectedTypes) {
    return EVENT_TYPES.filter((type) => selectedTypes?.[type] === true);
}

/**
 * Deja solo los eventos de los tipos marcados.
 *
 * No cuesta ninguna petición ni ningún descifrado: los eventos llegan aquí ya abiertos, porque el
 * servidor no puede filtrar por tipo (ADR 0006) y baja de todos modos todos los del rango. Por eso
 * el filtro se aplica al pintar y no al pedir, y por eso vale igual para el lector, que no tiene
 * servidor al que pedir nada.
 *
 * @param {list<{type?: string}>} events
 * @param {Record<string, boolean>} selectedTypes
 * @returns {list<object>}
 */
export function filterBySelectedTypes(events, selectedTypes) {
    return events.filter((event) => selectedTypes?.[event?.type] === true);
}
