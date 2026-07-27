/**
 * Etiqueta legible de una unidad de medida a partir del catálogo que emite el servidor.
 *
 * UCUM reserva los corchetes a las unidades no métricas: la libra es `[lb_av]` y el Fahrenheit es
 * `[degF]`. En el sobre se guarda ese código, porque es lo que exige el ADR 0005, pero enseñarlo
 * tal cual en el historial sería pedirle a la persona que lea notación de intercambio. Ante un
 * código desconocido devuelve el propio código, que es feo pero cierto: preferible a esconder un
 * registro.
 *
 * Estaba duplicada en `bodyWeightPage.js` y `temperaturePage.js`, y el precio de que divergieran
 * era que la misma unidad se enseñara distinta según la pantalla; se lee del mismo catálogo y con
 * la misma clave, así que no hay nada que la pantalla tenga que decidir.
 *
 * Vive aparte de `datetimeLocal.js` a propósito: aquello produce dato asociado del AEAD y esto es
 * texto de pantalla. Juntarlas en un módulo «de utilidades» mezclaría dos cosas sin riesgo ni
 * motivo de cambio comunes, que es lo que `eventCommonFields.js` evita al ser de un solo concepto.
 *
 * `heightUnitLabel` (peso) y `siteLabel` (temperatura) tienen esta forma pero leen otra lista del
 * catálogo y no están duplicadas: se quedan en su pantalla en lugar de forzar aquí un buscador
 * genérico por clave.
 *
 * @param {{units: list<{code: string, label: string}>}} catalog
 * @param {string} code
 * @returns {string}
 */
export function unitLabel(catalog, code) {
    return catalog.units.find((row) => row.code === code)?.label ?? code;
}
