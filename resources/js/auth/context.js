/**
 * Dato asociado de los sobres que nacen en el alta (Spec 0001 §5, pasos 9 y 10).
 *
 * La spec escribe ese contexto como `ctx(userId, "umk")` y `ctx(userId, "settings")`, pero **no
 * fija la cadena exacta**: ni el separador ni el orden aparecen en la spec ni en el ADR 0004. Aquí
 * se fija en un único sitio, y no repartido por los módulos que cifran, porque cambiarlo después
 * de que exista el primer sobre invalida el tag de todo el histórico y no hay forma de re-cifrar
 * desde el servidor.
 *
 * Del ADR 0004 sí viene la parte que no se inventa: el identificador de usuario entra en su forma
 * textual canónica en minúsculas, nunca como bytes crudos.
 *
 * Pendiente de confirmar en la spec antes del primer registro real.
 */

/** Propósitos que hoy existen. Congelado para que un typo no produzca un contexto nuevo. */
export const ENVELOPE_PURPOSES = Object.freeze({
    /** Sobre que envuelve la clave maestra bajo la KEK derivada del `exportKey`. */
    UserMasterKey: 'umk',
    /** Sobre de configuración del usuario (ADR 0007). */
    Settings: 'settings',
});

/**
 * @param {string} userId UUID del usuario, tal cual lo devuelve el servidor.
 * @param {string} purpose Uno de `ENVELOPE_PURPOSES`.
 * @returns {string} Contexto que entra a la vez en el `info` de la derivación y en el dato
 *          asociado del AEAD.
 */
export function envelopeContext(userId, purpose) {
    if (typeof userId !== 'string' || userId === '') {
        throw new TypeError('userId must be a non-empty string.');
    }

    if (!Object.values(ENVELOPE_PURPOSES).includes(purpose)) {
        throw new TypeError(`Unknown envelope purpose: ${purpose}.`);
    }

    return `${userId.toLowerCase()}/${purpose}`;
}
