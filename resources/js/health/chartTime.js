/**
 * Formato de las horas de los ejes de las gráficas que colocan cada lectura en el tiempo.
 *
 * **Por qué no vale `formatChartDate()` del módulo de idioma.** Las dos gráficas que sitúan lecturas
 * en un eje temporal —la curva con marcas de comida e insulina, y la superposición de 24 horas— no
 * trabajan con instantes absolutos: trabajan con la **hora de pared de quien registró** el evento,
 * que `eventWallClockMs()` codifica como si fuera UTC (ver `dailyBands.js`). Formatear ese número
 * con la zona del navegador lo desplazaría por segunda vez, y el pico de después de comer aparecería
 * a otra hora según desde dónde se abra la aplicación. Por eso aquí se formatea siempre en UTC.
 *
 * El idioma sí es el activo: la hora se escribe como se escriba en ese idioma (el reloj de 12 horas
 * del inglés, el de 24 del castellano), que es una convención de escritura y no un dato clínico.
 */

import { intlLocale } from '../i18n/index.js';

/**
 * Formateador de horas de pared, en el idioma activo y **siempre en UTC**.
 *
 * Se construye uno por dibujado y no uno por etiqueta: `Intl.DateTimeFormat` es caro y un eje puede
 * pedir cien etiquetas. No se memoiza a nivel de módulo porque el idioma cambia sin recargar (el
 * lector del profesional tiene selector, ADR 0011).
 *
 * @param {Intl.DateTimeFormatOptions} options
 * @returns {Intl.DateTimeFormat}
 */
export function wallClockFormat(options) {
    return new Intl.DateTimeFormat(intlLocale(), { ...options, timeZone: 'UTC' });
}
