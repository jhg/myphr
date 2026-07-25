/**
 * Campos comunes a todo evento clínico (ADR 0006, párrafo «Campos que se capturan aunque hoy no se
 * usen»): si el dato es manual o de un aparato, el aparato si lo hay, si lo registra la propia
 * persona o alguien que la cuida, y una nota libre opcional.
 *
 * **Van en el nivel superior del contenido descifrado**, junto a `v`, `type` y `tz`, nunca dentro de
 * `data`: no son propios de la glucemia, los va a reutilizar cualquier pantalla de evento (tensión,
 * comidas, insulina), así que esta función vive fuera de `glucosePage.js`.
 *
 * `origin` (token de `App\Catalog\DataOrigin`) distingue **cómo entró el dato en la aplicación**:
 * tecleado por una persona (`manual`) frente a importado automáticamente desde un aparato
 * (`device`). NO es cómo se midió la glucosa — eso es el campo `device` de más abajo, con qué
 * aparato se hizo la lectura. Esta confusión ya ocurrió una vez en este proyecto (se preguntaba
 * "origen del dato" con un selector manual/aparato en el formulario, cuando la inserción siempre es
 * manual: la persona lee el valor en su glucómetro o sensor y lo teclea), así que queda anotado
 * aquí para que no se repita. Por eso `buildCommonEventFields()` fija `origin` a `manual` sin
 * preguntarlo — hoy no existe ninguna integración ni sincronización automática con ningún aparato.
 * El día que exista una importación, será ella quien construya el evento con `origin: 'device'`,
 * no un `<select>` en un formulario de entrada manual.
 *
 * `origin` y `recordedBy` sí traen un valor por defecto razonable (`manual` y `self`, tokens de
 * `App\Catalog\DataOrigin` y `App\Catalog\RecordedBy`): no son afirmaciones clínicas, son hechos
 * sobre cómo entró el dato. `device` y `note` son texto libre y se omiten del contenido cuando están
 * vacíos, con el mismo criterio que el contexto de comida de `buildGlucoseContent`: ausencia tiene
 * que significar ausencia, nunca una cadena vacía guardada como si fuera un dato.
 */

/** Token de `App\Catalog\DataOrigin` que usa esta función cuando no se indica `origin`. */
export const DEFAULT_ORIGIN = 'manual';

/** Token de `App\Catalog\RecordedBy` que usa esta función cuando no se indica `recordedBy`. */
export const DEFAULT_RECORDED_BY = 'self';

/**
 * @param {unknown} value
 * @returns {string} `value` recortado, o cadena vacía si no era una cadena con contenido.
 */
function trimmedOrEmpty(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Construye los campos comunes a todo evento, listos para desplegar en el nivel superior del
 * contenido en claro (`{v, type, tz, ...commonFields, data}`).
 *
 * @param {object} [params]
 * @param {string} [params.origin] Token de `DataOrigin`: cómo entró el dato (tecleado o importado),
 *     no con qué se midió. Por defecto `DEFAULT_ORIGIN`; ningún formulario de captura manual debe
 *     preguntarlo, solo lo fijará la futura importación automática con `device`.
 * @param {string} [params.device] Aparato en texto libre. Se omite si está vacío.
 * @param {string} [params.recordedBy] Token de `RecordedBy`. Por defecto `DEFAULT_RECORDED_BY`.
 * @param {string} [params.note] Nota libre. Se omite si está vacía.
 * @returns {{origin: string, recordedBy: string, device?: string, note?: string}}
 */
export function buildCommonEventFields({ origin, device, recordedBy, note } = {}) {
    const fields = {
        origin: trimmedOrEmpty(origin) || DEFAULT_ORIGIN,
        recordedBy: trimmedOrEmpty(recordedBy) || DEFAULT_RECORDED_BY,
    };

    const trimmedDevice = trimmedOrEmpty(device);

    if (trimmedDevice !== '') {
        fields.device = trimmedDevice;
    }

    const trimmedNote = trimmedOrEmpty(note);

    if (trimmedNote !== '') {
        fields.note = trimmedNote;
    }

    return fields;
}
