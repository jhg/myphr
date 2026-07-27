/**
 * Etiquetas legibles de los tokens de catálogo y formato de las cifras clínicas (ADR 0005, ADR 0008).
 *
 * **Por qué está aquí y no en cada pantalla.** Estas etiquetas están duplicadas a conciencia
 * respecto de `app/Catalog/*`: ni el panel de inicio ni el lector del profesional reciben el
 * catálogo del servidor —el lector no tiene servidor al que pedírselo, y el panel pinta tarjetas que
 * el servidor no sabe cuáles son—, así que traducen los tokens por su cuenta. Lo que no puede haber
 * es una copia por pantalla: «Capilar» y «Izquierdo, sentado» tienen que decir exactamente lo mismo
 * en el resumen del paciente y en el informe que lee el médico, o los dos están mirando datos que
 * parecen distintos.
 *
 * Un token que este módulo no conoce **nunca rompe la pantalla ni se traga**: se humaniza y se
 * enseña tal cual venía en el sobre, que es información verdadera aunque no esté traducida.
 *
 * Módulo puro: sin Livewire, sin `$wire`, sin DOM.
 */

import { formatNumber as formatLocalizedNumber, t } from '../i18n/index.js';

/**
 * Claves de catálogo de los métodos de glucemia (`App\Catalog\GlucoseMeasurementMethod`, ADR 0008).
 * La lista de tokens es la del servidor y no puede cambiar: son los que viajan dentro del sobre.
 */
const GLUCOSE_METHOD_KEYS = Object.freeze({
    capillary: 'dashboard.method.capillary',
    interstitial: 'dashboard.method.interstitial',
});

/** Claves de brazo de tensión (`App\Catalog\BloodPressureArm`, ADR 0008). */
const BLOOD_PRESSURE_ARM_KEYS = Object.freeze({
    left: 'dashboard.arm.left',
    right: 'dashboard.arm.right',
});

/** Claves de postura de tensión (`App\Catalog\BloodPressurePosture`, ADR 0008). */
const BLOOD_PRESSURE_POSTURE_KEYS = Object.freeze({
    sitting: 'dashboard.posture.sitting',
    lying: 'dashboard.posture.lying',
    standing: 'dashboard.posture.standing',
});

/** Claves de tipo de insulina (`App\Catalog\InsulinType`). */
export const INSULIN_TYPE_KEYS = Object.freeze({
    rapid: 'dashboard.timeline.insulinType.rapid',
    long: 'dashboard.timeline.insulinType.long',
    mixed: 'dashboard.timeline.insulinType.mixed',
});

/** Claves de tipo de comida (`App\Catalog\MealType`). */
export const MEAL_TYPE_KEYS = Object.freeze({
    breakfast: 'dashboard.timeline.mealType.breakfast',
    lunch: 'dashboard.timeline.mealType.lunch',
    dinner: 'dashboard.timeline.mealType.dinner',
    snack: 'dashboard.timeline.mealType.snack',
});

/** Claves de sitio de medición de temperatura (`App\Catalog\TemperatureMeasurementSite`). */
export const TEMPERATURE_SITE_KEYS = Object.freeze({
    axillary: 'dashboard.timeline.site.axillary',
    oral: 'dashboard.timeline.site.oral',
    tympanic: 'dashboard.timeline.site.tympanic',
    temporal: 'dashboard.timeline.site.temporal',
    rectal: 'dashboard.timeline.site.rectal',
});

/**
 * Último recurso para un token de catálogo que este módulo no sabe traducir: se capitaliza cada
 * palabra separada por `_`. Nunca devuelve cadena vacía ni inventa una etiqueta clínica.
 *
 * @param {string} token
 * @returns {string}
 */
export function humanizeToken(token) {
    if (typeof token !== 'string') {
        return '';
    }

    return token
        .split('_')
        .filter((word) => word !== '')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Etiqueta de un token de catálogo, con el humanizado genérico como respaldo.
 *
 * @param {Record<string, string>} keys
 * @param {unknown} token
 * @returns {string}
 */
export function catalogLabel(keys, token) {
    if (typeof token !== 'string' || token === '') {
        return '';
    }

    return keys[token] !== undefined ? t(keys[token]) : humanizeToken(token);
}

/**
 * Etiqueta legible de un token de método (ADR 0008): glucemia (`capillary`, `interstitial`) o
 * tensión (`${brazo}_${postura}`, p. ej. `left_sitting`).
 *
 * Un token que no reconoce (una magnitud o combinación futura) no rompe nada: se humaniza, para que
 * la pantalla siga diciendo qué incluye aunque no sepa traducirlo con precisión clínica.
 *
 * @param {string} token
 * @returns {string}
 */
export function formatMethodLabel(token) {
    if (GLUCOSE_METHOD_KEYS[token] !== undefined) {
        return t(GLUCOSE_METHOD_KEYS[token]);
    }

    const [arm, posture] = token.split('_');

    if (BLOOD_PRESSURE_ARM_KEYS[arm] !== undefined && BLOOD_PRESSURE_POSTURE_KEYS[posture] !== undefined) {
        return t('dashboard.method.combined', {
            arm: t(BLOOD_PRESSURE_ARM_KEYS[arm]),
            posture: t(BLOOD_PRESSURE_POSTURE_KEYS[posture]),
        });
    }

    return humanizeToken(token);
}

/**
 * Nombre del tipo de evento, la etiqueta que encabeza su tarjeta y su línea temporal.
 *
 * @param {string} type
 * @returns {string}
 */
export function typeLabel(type) {
    return t(`dashboard.timeline.type.${type}`);
}

/**
 * Da forma de número localizado a un valor ya calculado por `statistics.js`. Los valores que llegan
 * aquí son siempre números JavaScript (media, mediana, mínimo, máximo, porcentaje), nunca la cadena
 * en reposo del ADR 0004: ver el JSDoc de `statistics.js` sobre precisión de presentación.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatNumber(value) {
    return formatLocalizedNumber(value);
}

/**
 * Da forma localizada a un valor clínico en reposo (ADR 0004: siempre cadena, con el punto como
 * separador decimal).
 *
 * Si la cadena no representa un número finito se devuelve **tal cual**, sin tocarla: es el dato que
 * la persona guardó, y sustituirlo por un guion o por `NaN` sería esconder o inventar.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function formatMeasuredValue(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
        return '';
    }

    const value = Number(raw);

    return Number.isFinite(value) ? formatNumber(value) : raw;
}
