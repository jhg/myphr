/**
 * Sella y abre el **descriptor** de un recorte compartido (ADR 0011).
 *
 * El descriptor es la mitad privada de un recorte: la clave de contenido `CK`, el rango exacto, los
 * tipos incluidos y excluidos, el número de eventos y las dos fechas. Va en la columna
 * `shares.descriptor` como sobre `v1.` corriente del ADR 0004 bajo la clave maestra, y es lo que
 * permite que la pantalla de comparticiones activas diga «glucemias, del 1 al 30 de junio» sin que
 * el servidor lo haya sabido nunca. Guardar `types` o `range_from` en columnas devolvería al
 * servidor justo el metadato que el ADR 0006 quitó del esquema.
 *
 * **Por qué la etiqueta es `RECORD` y no una nueva.** El ADR 0011 añade a `KDF_LABELS` exactamente
 * tres etiquetas —`SHARE`, `SHARE_LINK` y `SHARE_PIN_TAG`—, y ninguna es esta: del descriptor dice
 * que es «un sobre normal del ADR 0004 bajo la clave maestra», es decir, una fila cifrada del
 * usuario como cualquier otra. `RECORD` es precisamente «UMK -> clave por registro, con el contexto
 * del registro concatenado», y la separación de dominios la aporta el contexto, que es
 * `<user>/share/<id>` frente al `<user>/event/<fecha>` de un evento clínico: dos contextos que no
 * pueden coincidir, así que dos claves que no pueden coincidir. Inventarse aquí una cuarta etiqueta
 * que el ADR no menciona sería decidir por mi cuenta algo ya decidido.
 *
 * La clave derivada vive solo lo que dura la llamada y se borra en un `finally`, como en
 * `eventEnvelope.js` (ADR 0004).
 *
 * Un descriptor que no abre **no se silencia** y no se pinta como recorte vacío: la pantalla lo
 * muestra como fila de error (ADR 0004). Un recorte cuyo descriptor no abre sigue existiendo en el
 * servidor y sigue siendo legible por quien tenga el enlace y el PIN, así que esconderlo de la lista
 * sería esconder algo que sigue compartido.
 */

import { shareDescriptorContext } from '../auth/context.js';
import { withMasterKey } from '../auth/keyring.js';
import { openText, sealText } from '../crypto/envelope.js';
import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { zeroize } from '../crypto/zeroize.js';

/**
 * Deriva la clave del descriptor y ejecuta `use` con ella.
 *
 * Existe para que el sellado y la apertura compartan **una sola** construcción de contexto y de
 * derivación, como `withSettingsKey` en `auth/settings.js`: duplicarlas y dejar que diverjan un
 * byte es dejar el descriptor sin abrir para siempre, y con él `CK`.
 *
 * @template T
 * @param {string} userId
 * @param {string} shareId
 * @param {(key: Uint8Array, context: string) => T} use
 * @returns {T}
 */
function withDescriptorKey(userId, shareId, use) {
    const context = shareDescriptorContext(userId, shareId);

    return withMasterKey((masterKey) => {
        const descriptorKey = deriveKey({ ikm: masterKey, label: KDF_LABELS.RECORD, context });

        try {
            return use(descriptorKey, context);
        } finally {
            zeroize(descriptorKey);
        }
    });
}

/**
 * Cierra el descriptor de un recorte.
 *
 * @param {object} params
 * @param {string} params.userId UUID del usuario, tal cual lo devuelve el servidor.
 * @param {string} params.shareId UUIDv4 del recorte, el mismo que va a la columna `shares.id`.
 * @param {object} params.descriptor Contenido en claro del descriptor.
 * @returns {string} `v1.` + base64url, listo para la columna `shares.descriptor`.
 * @throws {Error} Si no hay clave maestra en memoria (`withMasterKey`).
 */
export function sealShareDescriptor({ userId, shareId, descriptor }) {
    return withDescriptorKey(userId, shareId, (key, context) =>
        sealText({ key, plaintext: JSON.stringify(descriptor), associatedData: context })
    );
}

/**
 * Abre el descriptor de un recorte.
 *
 * @param {object} params
 * @param {string} params.userId Mismo `userId` que se usó al sellar.
 * @param {string} params.shareId Mismo identificador que se usó al sellar.
 * @param {string} params.envelope Sobre tal cual viene de la columna `descriptor`.
 * @returns {object} Contenido en claro ya parseado.
 * @throws {import('../crypto/envelope.js').EnvelopeError} Si el sobre no abre. No se silencia
 *         (ADR 0004).
 * @throws {Error} Si no hay clave maestra en memoria (`withMasterKey`).
 */
export function openShareDescriptor({ userId, shareId, envelope }) {
    const plaintext = withDescriptorKey(userId, shareId, (key, context) =>
        openText({ key, envelope, associatedData: context })
    );

    return JSON.parse(plaintext);
}
