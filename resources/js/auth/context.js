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
 *
 * `eventContext` de más abajo es harina de otro costal: no nace del alta sino del ADR 0006 (modelo
 * de eventos clínicos), pero vive aquí por el mismo motivo, un único sitio para cadenas que no se
 * pueden cambiar sin invalidar el histórico.
 */

import { canonicalDate } from '../crypto/canonicalDate.js';

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

/**
 * Dato asociado y contexto de derivación de un evento clínico (ADR 0006, párrafo "Lo que
 * identifica a un evento").
 *
 * Lo que ata el sobre a su fila es `user_id` y `occurred_at`, nada más: **el tipo clínico no
 * entra aquí**, porque va cifrado dentro del propio sobre y no puede participar en su propia
 * autenticación (si `glucose` entrara en el dato asociado, el servidor lo leería en claro y se
 * rompería justo la propiedad que el ADR busca). Como en `envelopeContext`, la cadena se fija en
 * este único sitio: cambiarla después de que exista el primer sobre invalida el tag de todo el
 * histórico y no hay forma de re-cifrar desde el servidor.
 *
 * `occurredAt` entra en su forma canónica del ADR 0004 (`canonicalDate.js`), nunca formateada a
 * mano: tiene que ser byte a byte la misma cadena que produce el servidor a partir de la columna
 * `occurred_at`, y eso solo lo garantiza pasar por el mismo formateador siempre.
 *
 * @param {string} userId UUID del usuario, tal cual lo devuelve el servidor.
 * @param {Date|number|string} occurredAt Instante del evento (columna `occurred_at`).
 * @returns {string} Contexto que entra a la vez en el `info` de la derivación de la clave por
 *          registro y en el dato asociado del AEAD.
 */
export function eventContext(userId, occurredAt) {
    if (typeof userId !== 'string' || userId === '') {
        throw new TypeError('userId must be a non-empty string.');
    }

    return `${userId.toLowerCase()}/event/${canonicalDate(occurredAt)}`;
}
