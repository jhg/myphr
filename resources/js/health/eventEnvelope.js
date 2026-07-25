/**
 * Sella y abre el sobre de un evento clínico (ADR 0006).
 *
 * Un evento es un solo sobre, no uno por campo: `content` es el objeto `{v, type, tz, data}` en
 * claro entero, tal cual se guarda en la columna `payload`. Lo que ata ese sobre a su fila es
 * `user_id` y `occurred_at` (`eventContext` de `auth/context.js`), nunca el `type`, porque el tipo
 * va cifrado dentro del propio sobre y no puede participar en su propia autenticación.
 *
 * La clave no es la maestra directamente: es una clave por registro derivada de ella con
 * `KDF_LABELS.RECORD` y el mismo contexto, y solo vive el tiempo de esta llamada, borrada en un
 * `finally` (ADR 0004).
 *
 * **`occurredAt` tiene que ser exactamente el mismo instante que el servidor guarda en
 * `occurred_at`.** Un microsegundo de diferencia produce un contexto distinto y el descifrado
 * falla, no un dato atribuido al día equivocado (ese es justo el punto del ADR 0006). Por eso la
 * canonicalización vive en un solo sitio (`crypto/canonicalDate.js`, vía `eventContext`) y aquí no
 * se formatea nada a mano: quien llama pasa el valor que recibió del servidor (o que va a enviarle)
 * tal cual.
 */

import { eventContext } from '../auth/context.js';
import { withMasterKey } from '../auth/keyring.js';
import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { openText, sealText } from '../crypto/envelope.js';
import { zeroize } from '../crypto/zeroize.js';

/**
 * Cierra el sobre de un evento.
 *
 * @param {object} params
 * @param {string} params.userId UUID del usuario, tal cual lo devuelve el servidor.
 * @param {Date|number|string} params.occurredAt Mismo instante que va a la columna `occurred_at`.
 * @param {object} params.content Contenido en claro del evento: `{v, type, tz, data}`.
 * @returns {string} `v1.` + base64url, listo para guardar en `payload`.
 * @throws {Error} Si no hay clave maestra en memoria (`withMasterKey`).
 */
export function sealEvent({ userId, occurredAt, content }) {
    const context = eventContext(userId, occurredAt);
    let recordKey = null;

    try {
        return withMasterKey((masterKey) => {
            recordKey = deriveKey({ ikm: masterKey, label: KDF_LABELS.RECORD, context });

            return sealText({
                key: recordKey,
                plaintext: JSON.stringify(content),
                associatedData: context,
            });
        });
    } finally {
        if (recordKey !== null) {
            zeroize(recordKey);
        }
    }
}

/**
 * Abre el sobre de un evento.
 *
 * @param {object} params
 * @param {string} params.userId Mismo `userId` que se usó al sellar.
 * @param {Date|number|string} params.occurredAt Mismo instante que se usó al sellar: el que el
 *        servidor tiene en `occurred_at` para esta fila.
 * @param {string} params.envelope Sobre tal cual viene de `payload`.
 * @returns {object} Contenido en claro ya parseado: `{v, type, tz, data}`.
 * @throws {import('../crypto/envelope.js').EnvelopeError} Si el sobre no abre. No se silencia:
 *         un fallo de descifrado es siempre un error visible (ADR 0004), nunca un evento que se
 *         omite en la vista.
 * @throws {Error} Si no hay clave maestra en memoria (`withMasterKey`).
 */
export function openEvent({ userId, occurredAt, envelope }) {
    const context = eventContext(userId, occurredAt);
    let recordKey = null;

    try {
        const plaintext = withMasterKey((masterKey) => {
            recordKey = deriveKey({ ikm: masterKey, label: KDF_LABELS.RECORD, context });

            return openText({ key: recordKey, envelope, associatedData: context });
        });

        return JSON.parse(plaintext);
    } finally {
        if (recordKey !== null) {
            zeroize(recordKey);
        }
    }
}
