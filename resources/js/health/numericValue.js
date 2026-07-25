/**
 * Lógica pura y compartida para validar y normalizar campos numéricos clínicos (glucemia,
 * sistólica, diastólica, pulso, ...). Toda pantalla con un valor de medida usa este módulo en vez
 * de repetir la validación cinco veces.
 *
 * **Por qué existe** (criterio de seguridad del paciente): con un `<input type="text">` se puede
 * teclear tanto `7,8` como `7.8`, y esa ambigüedad de separador decimal es un error de lectura y de
 * parseo que, en un dato clínico ya cifrado, no se puede corregir después.
 *
 * **El patrón del campo en Blade** es `type="number" min="0" step="any" inputmode="decimal"`: con
 * `step="1"` el navegador marcaría `7.5` como inválido (y media unidad es un valor real), mientras
 * que `step="any"` deja que las flechas incrementen de uno en uno y a la vez acepte decimales. Ese
 * `step` no impone un límite de decimales por sí solo, así que el límite de 2 decimales lo impone
 * este módulo, en el cliente, con un mensaje claro en el idioma de la persona, ANTES de sellar el
 * sobre (ADR 0004).
 *
 * El valor sigue viajando como **cadena** en el payload (ADR 0004, "decimales como cadena"): estas
 * funciones nunca convierten a `Number`, solo validan la forma y normalizan el separador.
 */

import { t } from '../i18n/index.js';

/** Como mucho 2 decimales, sin signo (la validación de negativos va aparte, para dar un mensaje propio). */
const NUMERIC_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Sustituye una coma decimal por un punto. No toca nada más: si `rawValue` trae varias comas o
 * cualquier otro carácter, `parseNumericValue` es quien lo rechaza después.
 *
 * @param {string} rawValue
 * @returns {string}
 */
export function normalizeDecimalSeparator(rawValue) {
    return rawValue.replace(',', '.');
}

/**
 * Valida y normaliza un valor numérico clínico tecleado por la persona.
 *
 * La cadena vacía se devuelve tal cual: la obligatoriedad de cada campo la decide quien llama
 * (`buildGlucoseContent`, `buildBloodPressureContent`, ...), igual que hoy hacen con sus propios
 * mensajes de "falta el valor". Para cualquier cadena no vacía, exige en este orden: (1) que no sea
 * negativa, (2) que tenga como mucho 2 decimales, (3) que, ya con la coma normalizada a punto, sea
 * un número reconocible.
 *
 * @param {string} rawValue Tal cual lo escribió la persona en el `<input type="number">`.
 * @param {string} fieldLabel Nombre del campo **ya traducido**, para el mensaje de error: quien
 *        llama lo saca del catálogo (`t('field.value')`, `t('field.systolic')`, ...). Va como
 *        marcador `{field}` dentro de la frase, no concatenado, porque en chino el sustantivo no
 *        lleva artículo y la frase no se arma en el mismo orden.
 * @returns {string} El valor normalizado (coma → punto), listo para entrar en el payload como
 *          cadena (ADR 0004). Cadena vacía si `rawValue` estaba vacío o solo tenía espacios.
 * @throws {Error} Con mensaje en el idioma activo si no es numérico, es negativo, o tiene más de 2
 *         decimales.
 */
export function parseNumericValue(rawValue, fieldLabel) {
    if (typeof rawValue !== 'string') {
        throw new Error(t('numeric.notANumber', { field: fieldLabel }));
    }

    const trimmed = rawValue.trim();

    if (trimmed === '') {
        return '';
    }

    if (trimmed.startsWith('-')) {
        throw new Error(t('numeric.negative', { field: fieldLabel }));
    }

    const normalized = normalizeDecimalSeparator(trimmed);

    if (/^\d+\.\d{3,}$/.test(normalized)) {
        throw new Error(t('numeric.tooManyDecimals', { field: fieldLabel }));
    }

    if (!NUMERIC_PATTERN.test(normalized)) {
        throw new Error(t('numeric.notANumberHint', { field: fieldLabel }));
    }

    return normalized;
}
