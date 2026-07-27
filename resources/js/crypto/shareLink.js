/**
 * El envoltorio del enlace: la capa pequeña del ADR 0011, la que ata un enlace
 * concreto a un paquete concreto.
 *
 * El envoltorio es un sobre corriente del ADR 0004 (`v1.`, `crypto/envelope.js`)
 * cifrado con `wrapKey` y cuyo contenido son los 32 bytes de `CK`. Su dato
 * asociado es:
 *
 * ```
 * "myphr/share-link/v1" || 0x00 || linkId || 0x00 || canonicalDate(expiresAt) || 0x00 || sha512(paquete)
 * ```
 *
 * **Para qué está ahí el hash del paquete.** Sin él, el servidor puede servir
 * el envoltorio del enlace A junto al paquete de B: `wrapKey` abre el
 * envoltorio, sale un `CK` válido, y con ese `CK`... no abriría el paquete de
 * B, cierto, pero sí abriría cualquier paquete que compartiese `CK`, y sobre
 * todo el emparejamiento queda al arbitrio del servidor, que es justo lo que un
 * dato asociado existe para impedir. Con el hash dentro, el envoltorio solo
 * descifra si viene acompañado del paquete exacto con el que se creó: cambiar
 * un byte del paquete, o cambiar el paquete entero por el de otra persona, hace
 * fallar el tag antes de que nadie enseñe nada en pantalla.
 *
 * Ese es el segundo cierre del sistema, complementario al del propio paquete
 * (`shareEnvelope.js`), que está atado a `shareId` y al instante de generación.
 * Las dos capas tienen dato asociado, y ninguna de las dos se puede recolocar.
 *
 * **Qué se hashea, exactamente**: los bytes UTF-8 de la cadena de transporte
 * tal cual llega, `s1.` incluido. Hashear lo que se recibe y no lo que se
 * decodifica evita que dos codificaciones distintas del mismo sobre den hashes
 * distintos, y hace la comprobación posible antes de decodificar nada.
 */

import { sha512 } from '@noble/hashes/sha2.js';

import { decodeBase64Url, encodeBase64Url } from './base64url.js';
import { open as openEnvelope, seal as sealEnvelope } from './envelope.js';
import { KDF_LABELS, KEY_LENGTH } from './kdf.js';
import { joinWithSeparator, ShareEnvelopeError, SHARE_PREFIX } from './shareEnvelope.js';
import { SEND_KEY_LENGTH, shareLinkContext } from './shareKeys.js';

const TEXT_ENCODER = new TextEncoder();

/** Longitud del hash del paquete dentro del dato asociado. */
export const PACKAGE_DIGEST_LENGTH = 64;

/**
 * Hash del paquete tal cual viaja.
 *
 * @param {string} packageEnvelope `s1.` + base64url.
 * @returns {Uint8Array} 64 bytes.
 * @throws {ShareEnvelopeError} Si no es un paquete con su prefijo.
 */
export function sharePackageDigest(packageEnvelope) {
    if (typeof packageEnvelope !== 'string' || !packageEnvelope.startsWith(SHARE_PREFIX)) {
        throw new ShareEnvelopeError('Share package does not start with the s1. prefix.');
    }

    return sha512(TEXT_ENCODER.encode(packageEnvelope));
}

/**
 * Dato asociado del envoltorio.
 *
 * @param {object} params
 * @param {string} params.linkId UUIDv4 del enlace, el que viaja en la URL.
 * @param {Date|number|string} params.expiresAt Caducidad del enlace.
 * @param {string} params.packageEnvelope Paquete `s1.` con el que se empareja.
 * @returns {Uint8Array}
 */
export function shareWrapperContext({ linkId, expiresAt, packageEnvelope }) {
    return joinWithSeparator([
        TEXT_ENCODER.encode(KDF_LABELS.SHARE_LINK),
        shareLinkContext({ linkId, expiresAt }),
        sharePackageDigest(packageEnvelope),
    ]);
}

/**
 * Cierra el envoltorio: `CK` bajo `wrapKey`.
 *
 * @param {object} params
 * @param {Uint8Array} params.wrapKey Salida de `deriveWrapKey`.
 * @param {Uint8Array} params.contentKey `CK`, 32 bytes.
 * @param {string} params.linkId
 * @param {Date|number|string} params.expiresAt
 * @param {string} params.packageEnvelope Paquete `s1.` que este enlace abre.
 * @returns {string} `v1.` + base64url, para la columna `share_links.wrapper`.
 */
export function sealShareWrapper({ wrapKey, contentKey, linkId, expiresAt, packageEnvelope }) {
    assertKey(contentKey, 'contentKey');

    return sealEnvelope({
        key: wrapKey,
        plaintext: contentKey,
        associatedData: shareWrapperContext({ linkId, expiresAt, packageEnvelope }),
    });
}

/**
 * Abre el envoltorio y devuelve `CK`.
 *
 * @param {object} params
 * @param {Uint8Array} params.wrapKey
 * @param {string} params.wrapper Columna `wrapper` tal cual la sirve el servidor.
 * @param {string} params.linkId
 * @param {Date|number|string} params.expiresAt
 * @param {string} params.packageEnvelope Paquete recibido en la misma respuesta.
 * @returns {Uint8Array} `CK`, 32 bytes.
 * @throws {import('./envelope.js').EnvelopeError} Si no abre: PIN erróneo, enlace
 *         o caducidad manipulados, o paquete que no es el suyo. No se silencia
 *         nunca (ADR 0004).
 */
export function openShareWrapper({ wrapKey, wrapper, linkId, expiresAt, packageEnvelope }) {
    const contentKey = openEnvelope({
        key: wrapKey,
        envelope: wrapper,
        associatedData: shareWrapperContext({ linkId, expiresAt, packageEnvelope }),
    });

    assertKey(contentKey, 'contentKey');

    return contentKey;
}

/**
 * Longitud del fragmento en bytes: `S` más el instante de generación.
 *
 * **Por qué el instante viaja aquí y no lo pone el servidor.** Para abrir el
 * paquete hay que reconstruir su dato asociado, que es
 * `"myphr/share/v1" || 0x00 || shareId || 0x00 || canonicalDate(generatedAt)`,
 * y eso hay que tenerlo **antes** de descifrar. El `shareId` es una columna y el
 * servidor lo sabe; el instante de generación no lo sabe, porque lo elige el
 * cliente al armar el recorte y ninguna columna lo guarda: el ADR 0011 enumera
 * las columnas de `shares` una a una y añadir un `generated_at` sería añadir una
 * fecha nueva en claro a una tabla que se diseñó para no tener ninguna que no
 * hiciera falta.
 *
 * Así que va en el fragmento, que es el único canal que no pasa por el servidor.
 * Cuesta once caracteres de URL (43 → 54 en base64url) y a cambio el lector no
 * depende de que el servidor diga la verdad sobre nada de lo que entra en la
 * criptografía. Ocho bytes big-endian con el epoch en milisegundos: `Date` de
 * JavaScript no tiene más precisión, y `canonicalDate` de un epoch en
 * milisegundos y de su `Date` dan exactamente la misma cadena.
 */
export const SEND_FRAGMENT_LENGTH = SEND_KEY_LENGTH + 8;

/**
 * Fragmento de la URL: `S` y el instante de generación del recorte, juntos.
 *
 * El fragmento no llega al servidor, y por eso `S` puede ir ahí; lo que sí
 * alcanza son el historial del navegador del profesional, su sincronización en
 * la nube y las capturas de pantalla (ADR 0011, "Consequences"). Este códec no
 * arregla nada de eso: solo garantiza que los bytes van y vuelven idénticos.
 *
 * @param {object} params
 * @param {Uint8Array} params.sendKey `S`, 32 bytes.
 * @param {Date|number} params.generatedAt Instante de generación del recorte.
 * @returns {string} base64url, sin `#`.
 */
export function encodeShareFragment({ sendKey, generatedAt }) {
    assertKey(sendKey, 'sendKey');

    const milliseconds = generatedAt instanceof Date ? generatedAt.getTime() : generatedAt;

    if (!Number.isSafeInteger(milliseconds)) {
        throw new ShareEnvelopeError('generatedAt must be a Date or an epoch in milliseconds.');
    }

    const fragment = new Uint8Array(SEND_FRAGMENT_LENGTH);

    fragment.set(sendKey, 0);
    new DataView(fragment.buffer).setBigUint64(SEND_KEY_LENGTH, BigInt(milliseconds), false);

    return encodeBase64Url(fragment);
}

/**
 * @param {string} encoded Lo que venía en `location.hash`, ya sin `#`.
 * @returns {{sendKey: Uint8Array, generatedAt: Date}}
 * @throws {import('./base64url.js').Base64UrlError} Si no es base64url canónico.
 * @throws {ShareEnvelopeError} Si no mide lo que tiene que medir.
 */
export function decodeShareFragment(encoded) {
    const bytes = decodeBase64Url(encoded, 'share fragment');

    if (bytes.length !== SEND_FRAGMENT_LENGTH) {
        throw new ShareEnvelopeError(`share fragment must be ${SEND_FRAGMENT_LENGTH} bytes.`);
    }

    const milliseconds = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .getBigUint64(SEND_KEY_LENGTH, false);

    if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ShareEnvelopeError('share fragment carries an out-of-range instant.');
    }

    return {
        sendKey: bytes.slice(0, SEND_KEY_LENGTH),
        generatedAt: new Date(Number(milliseconds)),
    };
}

/**
 * @param {Uint8Array} key
 * @param {string} name
 * @returns {void}
 */
function assertKey(key, name) {
    const expected = name === 'sendKey' ? SEND_KEY_LENGTH : KEY_LENGTH;

    if (!(key instanceof Uint8Array) || key.length !== expected) {
        throw new ShareEnvelopeError(`${name} must be a Uint8Array of ${expected} bytes.`);
    }
}
