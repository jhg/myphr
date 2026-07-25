/**
 * Traducción de las cadenas que el cliente escribe en pantalla.
 *
 * **Por qué existe.** Las pantallas del panel construyen buena parte de su texto en JavaScript
 * (historial, avisos, pies de gráfica, etapas de la barra de progreso), y ese texto no pasa por
 * `__()` de Laravel: hasta ahora estaba congelado en castellano dentro de cada módulo. Este módulo
 * es el equivalente cliente de `lang/`, con **inglés por defecto** igual que `config/app.php`, más
 * castellano y chino simplificado.
 *
 * **Por qué los tres catálogos se importan de forma estática y no con `import()` dinámico.** Casi
 * todas estas cadenas son mensajes de error que salen de funciones puras y **síncronas**
 * (`buildGlucoseContent`, `parseNumericValue`, `chartCaptionText`, ...). Con carga diferida, `t()`
 * tendría que ser asíncrona o devolver la clave mientras el catálogo viaja, y un mensaje de
 * validación clínica que aparece en inglés durante los primeros milisegundos es exactamente el
 * fallo silencioso que no queremos. Los tres catálogos juntos son unos pocos kilobytes de texto,
 * menos que un icono, así que el ahorro no compensa el riesgo.
 *
 * **De dónde sale el idioma.** De `document.documentElement.lang`, que el servidor ya emite a
 * partir de `app()->getLocale()`. No hay endpoint nuevo ni metadato nuevo. En Node (los tests) no
 * hay `document`, así que el idioma efectivo es el de por defecto, `en`; un test que quiera
 * comprobar el texto en castellano llama a `setLocale('es')`, que es también lo que hace explícito
 * en qué idioma está afirmando.
 *
 * **Plurales.** Ni `registro(s)` ni `día(s)`: el inglés pluraliza de verdad y el chino no
 * pluraliza en absoluto. Una entrada de catálogo puede ser `{one, other}` y `t()` elige con
 * `Intl.PluralRules`, que ya trae el navegador.
 */

import { EN } from './en.js';
import { ES } from './es.js';
import { ZH_CN } from './zh_CN.js';

/** Idioma de respaldo, el mismo que `config/app.php` (`APP_LOCALE=en`). */
export const DEFAULT_LOCALE = 'en';

/**
 * Lista cerrada de catálogos. Los nombres son los de las carpetas de traducción de Laravel y de
 * Filament (`zh_CN`, no `zh-CN` ni `zh`), para que los nuestros casen con los suyos.
 */
const CATALOGS = Object.freeze({ en: EN, es: ES, zh_CN: ZH_CN });

/** @type {list<string>} */
export const SUPPORTED_LOCALES = Object.freeze(Object.keys(CATALOGS));

/** Etiqueta BCP 47 de cada catálogo, la que entienden `Intl.*` y `Date.prototype.toLocaleString`. */
const INTL_TAGS = Object.freeze({ en: 'en', es: 'es', zh_CN: 'zh-CN' });

/** @type {string|null} Se resuelve la primera vez que hace falta, no al evaluar el módulo. */
let activeLocale = null;

/**
 * Normaliza cualquier etiqueta de idioma al catálogo que le corresponde.
 *
 * Acepta las dos formas que circulan por el proyecto (`zh_CN` de Laravel y `zh-CN` del atributo
 * `lang` del HTML) y cae en el idioma por defecto ante cualquier cosa que no se soporte: la lista
 * es cerrada a propósito, porque el valor acaba eligiendo catálogo.
 *
 * @param {unknown} tag
 * @returns {'en'|'es'|'zh_CN'}
 */
export function resolveLocale(tag) {
    if (typeof tag !== 'string' || tag.trim() === '') {
        return DEFAULT_LOCALE;
    }

    const normalized = tag.trim().replace('-', '_').toLowerCase();
    const [language] = normalized.split('_');

    if (language === 'zh') {
        return 'zh_CN';
    }

    if (language === 'es') {
        return 'es';
    }

    return DEFAULT_LOCALE;
}

/** @returns {'en'|'es'|'zh_CN'} */
function detectLocale() {
    if (typeof document === 'undefined' || document.documentElement === null) {
        return DEFAULT_LOCALE;
    }

    return resolveLocale(document.documentElement.getAttribute('lang'));
}

/**
 * Idioma activo. La primera llamada lo deduce del documento y lo recuerda: el idioma no cambia sin
 * recargar la página (lo fija el servidor en el `<html lang>`), así que releerlo en cada `t()`
 * sería trabajo de sobra.
 *
 * @returns {'en'|'es'|'zh_CN'}
 */
export function currentLocale() {
    if (activeLocale === null) {
        activeLocale = detectLocale();
    }

    return activeLocale;
}

/**
 * Fija el idioma a mano. Lo usan `app.js` al arrancar (para no depender del orden de evaluación de
 * los módulos) y los tests, que así declaran en qué idioma afirman.
 *
 * @param {string} locale
 * @returns {'en'|'es'|'zh_CN'} El que ha quedado activo.
 */
export function setLocale(locale) {
    activeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : resolveLocale(locale);

    return activeLocale;
}

/** @returns {string} Etiqueta BCP 47 del idioma activo, para `Intl` y `toLocaleString`. */
export function intlLocale() {
    return INTL_TAGS[currentLocale()];
}

/**
 * Sustituye los marcadores `{nombre}` por sus valores.
 *
 * Las frases se traducen **enteras y con marcador**, nunca por concatenación: en chino el orden de
 * los fragmentos y la puntuación (`。`, `，`) no son los del castellano, y una frase armada a
 * trozos no se puede traducir sin reescribir el código.
 *
 * @param {string} template
 * @param {Record<string, string|number>} params
 * @returns {string}
 */
function interpolate(template, params) {
    return template.replace(/\{(\w+)\}/g, (placeholder, name) => (
        Object.hasOwn(params, name) ? String(params[name]) : placeholder
    ));
}

/** @type {Map<string, Intl.PluralRules>} */
const pluralRulesCache = new Map();

/**
 * @param {number} count
 * @returns {string} Categoría de plural (`one`, `other`, ...) del idioma activo.
 */
function pluralCategory(count) {
    const tag = intlLocale();

    if (!pluralRulesCache.has(tag)) {
        pluralRulesCache.set(tag, new Intl.PluralRules(tag));
    }

    return pluralRulesCache.get(tag).select(count);
}

/**
 * Traduce una clave.
 *
 * Una clave que falta en el idioma activo cae en el catálogo inglés, y una que tampoco esté allí se
 * devuelve tal cual: un identificador con puntos en pantalla es feo, pero es visible, mientras que
 * devolver cadena vacía escondería el hueco. `tests/js/i18n.test.mjs` comprueba que los tres
 * catálogos tienen exactamente el mismo juego de claves, para que ese respaldo no llegue a usarse.
 *
 * @param {string} key
 * @param {Record<string, string|number>} [params] Valores de los marcadores; `count` elige además
 *        la forma de plural cuando la entrada tiene variantes.
 * @returns {string}
 */
export function t(key, params = {}) {
    const entry = CATALOGS[currentLocale()][key] ?? CATALOGS[DEFAULT_LOCALE][key];

    if (entry === undefined) {
        return key;
    }

    if (typeof entry === 'object') {
        const variant = entry[pluralCategory(Number(params.count ?? 0))] ?? entry.other;

        return interpolate(variant, params);
    }

    return interpolate(entry, params);
}

/**
 * Une una lista de etiquetas con el separador del idioma (`, ` en occidente, `、` en chino).
 *
 * @param {list<string>} items
 * @returns {string}
 */
export function joinList(items) {
    return items.join(t('common.listSeparator'));
}

/** @type {Map<string, Intl.NumberFormat>} */
const numberFormatCache = new Map();

/**
 * Número con la separación decimal y de millares del idioma activo. En castellano `7,8`; en inglés
 * y en chino `7.8`, que es lo que dice el glucómetro de quien lee en esos idiomas.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatNumber(value) {
    const tag = intlLocale();

    if (!numberFormatCache.has(tag)) {
        numberFormatCache.set(tag, new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }));
    }

    return numberFormatCache.get(tag).format(value);
}

/**
 * Fecha y hora completas para el historial, en el idioma activo.
 *
 * @param {Date|string|number} value
 * @returns {string}
 */
export function formatDateTime(value) {
    return new Date(value).toLocaleString(intlLocale());
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const chartDayFormatCache = new Map();

/**
 * Solo la fecha, sin hora, para el eje de la gráfica de insulina, que agrupa por día.
 *
 * @param {Date|string|number} value
 * @returns {string}
 */
export function formatChartDay(value) {
    const tag = intlLocale();

    if (!chartDayFormatCache.has(tag)) {
        chartDayFormatCache.set(tag, new Intl.DateTimeFormat(tag, { dateStyle: 'short' }));
    }

    return chartDayFormatCache.get(tag).format(new Date(value));
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const chartDateFormatCache = new Map();

/**
 * Fecha y hora abreviadas para el eje de categorías de las gráficas (no hay adaptador de fechas de
 * Chart.js instalado: las etiquetas se formatean aquí).
 *
 * @param {Date|string|number} value
 * @returns {string}
 */
export function formatChartDate(value) {
    const tag = intlLocale();

    if (!chartDateFormatCache.has(tag)) {
        chartDateFormatCache.set(tag, new Intl.DateTimeFormat(tag, { dateStyle: 'short', timeStyle: 'short' }));
    }

    return chartDateFormatCache.get(tag).format(new Date(value));
}
