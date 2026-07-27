/**
 * Sobre del paquete de compartición: el formato hermano `s1.` del ADR 0011.
 *
 * Transporte: `s1.` seguido de base64url sin padding del sobre binario. La
 * cabecera es **la misma de 64 bytes del ADR 0004** (`crypto/envelope.js`), con
 * los mismos identificadores de algoritmo y de KDF, y solo cambian tres cosas:
 * el prefijo de transporte, la escalera de relleno y una bandera nueva.
 *
 * ```
 * offset  bytes  campo
 *      0      1  versión del formato            (0x01)
 *      1      1  identificador de algoritmo     (0x01 = XChaCha20-Poly1305-IETF)
 *      2      1  identificador de KDF           (0x01 = HKDF-SHA-512)
 *      3      1  banderas                       (bit 0 = rellenado, bit 1 = comprimido)
 *      4      4  identificador de clave         (reservado, hoy siempre cero)
 *      8     32  sal de la derivación
 *     40     24  nonce
 *     64      n  ciphertext || tag (16 bytes)
 * ```
 *
 * **Por qué un prefijo distinto.** `EnvelopeValidator` (y su hermano de
 * cliente) exige `v1.`, así que el prefijo `s1.` impide colar un paquete de
 * compartición en la columna `payload` de un evento o al revés. El precio, que
 * el ADR 0011 dice sin adornos: los dos guardarraíles del ADR 0002 abortan
 * cualquier cadena larga que no empiece por `v1.`, y por eso el paquete **no
 * viaja por Livewire** sino por su endpoint HTTP propio.
 *
 * **Escalera propia y multiplicativa**: 64 KiB, 256 KiB, 1 MiB y 4 MiB. La del
 * ADR 0004 corta en 4.092 bytes y tres meses de glucemias son unos 110 KB. El
 * suelo alto es lo que hace el trabajo: casi todos los recortes reales caen
 * comprimidos dentro de los 64 KiB y son indistinguibles entre sí, así que el
 * servidor no puede restar dos envíos del mismo rango para aislar el peso de un
 * tipo clínico. Que cada escalón sea el cuádruple del anterior mantiene el
 * número de escalones en cuatro: cuantos menos escalones, menos información
 * hay en saber en cuál cayó un envío.
 *
 * **Comprimir ANTES de rellenar, nunca después.** El orden no es una
 * preferencia de rendimiento: comprimir el búfer ya rellenado colapsaría los
 * ceros del relleno y el ciphertext volvería a tener el tamaño del contenido
 * real, que es exactamente lo que el relleno existe para esconder. El orden es
 * comprimir, rellenar, cifrar; y al abrir, descifrar, quitar relleno,
 * descomprimir.
 *
 * **Un solo sobre, sin trocear** (ADR 0011). Con trozos, un servidor hostil que
 * entregue todos menos el último produce un historial coherente al que le falta
 * la semana de las hipoglucemias, sin que falle ningún tag. Lo que aquí hace de
 * compromiso sobre el contenido completo es el propio texto en claro: lleva el
 * número de eventos, y `openSharePackage` rechaza el paquete si ese número no
 * cuadra con los eventos que trae. Por eso no hay manifiesto de trozos: no hay
 * trozos que manifestar.
 *
 * **Dato asociado**: `"myphr/share/v1" || 0x00 || shareId || 0x00 ||
 * canonicalDate(generatedAt)`, más la cabecera completa, igual que en el ADR
 * 0004. No lleva `user_id`, excepción consciente del ADR 0011: lo construye el
 * lector, o sea el profesional, y meterlo ahí le regalaría un identificador
 * estable del paciente, correlacionable entre dos envíos distintos.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

import { decodeBase64Url, encodeBase64Url } from './base64url.js';
import { canonicalDate } from './canonicalDate.js';
import { deriveKey, KDF_LABELS, KEY_LENGTH } from './kdf.js';
import { zeroize } from './zeroize.js';
import {
    ALGORITHM_XCHACHA20_POLY1305,
    FLAG_PADDED,
    HEADER_LENGTH,
    KDF_HKDF_SHA512,
    KEY_ID_LENGTH,
    NONCE_LENGTH,
    SALT_LENGTH,
    TAG_LENGTH,
    ENVELOPE_VERSION,
} from './envelope.js';

/** Prefijo de transporte del paquete. Distinto a propósito del `v1.` del ADR 0004. */
export const SHARE_PREFIX = 's1.';

/** Bandera: el contenido va comprimido con gzip por debajo del relleno. */
export const FLAG_COMPRESSED = 0x02;

/** Bytes que consume el prefijo de longitud del relleno. */
const LENGTH_PREFIX = 4;

/** Escalera de relleno propia del ADR 0011: 64 KiB, 256 KiB, 1 MiB y 4 MiB. */
export const SHARE_PADDED_SIZES = Object.freeze([65536, 262144, 1048576, 4194304]);

/** Contenido comprimido máximo que cabe en el mayor escalón. */
export const MAX_SHARE_PADDED_CONTENT = SHARE_PADDED_SIZES[SHARE_PADDED_SIZES.length - 1] - LENGTH_PREFIX;

/**
 * Tope de expansión al descomprimir. El AEAD ya autentica el búfer antes de
 * llegar aquí, así que una bomba de descompresión solo puede fabricarla quien
 * tenga la clave de contenido, es decir la propia persona propietaria. Aun así
 * el límite es gratis y evita que un fallo del formato tumbe la pestaña del
 * profesional en mitad de una consulta.
 */
export const MAX_DECOMPRESSED_LENGTH = 64 * 1024 * 1024;

/** Etiqueta del dato asociado del paquete (ADR 0011). */
export const SHARE_CONTEXT_LABEL = KDF_LABELS.SHARE;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Error del sobre de compartición. Igual que en el ADR 0004, no distingue
 * manipulación de corrupción, porque el cliente tampoco puede: en ambos casos
 * es un error visible y nunca un paquete que se muestra a medias.
 */
export class ShareEnvelopeError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'ShareEnvelopeError';
    }
}

/**
 * Dato asociado del paquete, en bytes.
 *
 * `shareId` entra en minúsculas y `generatedAt` en la forma canónica del ADR
 * 0004 (`YYYY-MM-DDTHH:MM:SS.ffffffZ`), nunca formateado a mano: estos bytes
 * tienen que salir idénticos en quien cifra y en quien descifra, y un byte de
 * diferencia es un descifrado fallido.
 *
 * @param {object} params
 * @param {string} params.shareId UUIDv4 del paquete (columna `shares.id`).
 * @param {Date|number|string} params.generatedAt Instante de generación del recorte.
 * @returns {Uint8Array} `"myphr/share/v1" || 0x00 || shareId || 0x00 || canonicalDate(generatedAt)`.
 */
export function sharePackageContext({ shareId, generatedAt }) {
    return joinWithSeparator([
        TEXT_ENCODER.encode(SHARE_CONTEXT_LABEL),
        TEXT_ENCODER.encode(assertIdentifier(shareId, 'shareId')),
        TEXT_ENCODER.encode(canonicalDate(generatedAt)),
    ]);
}

/**
 * Une trozos con el separador `0x00`, que es el mismo que usa `deriveKey`.
 * Sin separador, dos pares de valores distintos producirían la misma
 * concatenación y por tanto el mismo dato asociado.
 *
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
export function joinWithSeparator(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0) + Math.max(parts.length - 1, 0);
    const joined = new Uint8Array(length);
    let offset = 0;

    parts.forEach((part, index) => {
        if (index > 0) {
            joined[offset] = 0x00;
            offset += 1;
        }

        joined.set(part, offset);
        offset += part.length;
    });

    return joined;
}

/**
 * Rellena al primer escalón de la escalera en que quepa, con la longitud real
 * en cuatro bytes big-endian por delante.
 *
 * @param {Uint8Array} content Contenido **ya comprimido**.
 * @returns {Uint8Array} Longitud exactamente uno de `SHARE_PADDED_SIZES`.
 * @throws {ShareEnvelopeError} Si no cabe en el mayor escalón.
 */
export function padToShareLadder(content) {
    const needed = content.length + LENGTH_PREFIX;
    const size = SHARE_PADDED_SIZES.find((candidate) => candidate >= needed);

    if (size === undefined) {
        throw new ShareEnvelopeError(
            `Compressed package of ${content.length} bytes exceeds the largest share size (${MAX_SHARE_PADDED_CONTENT} bytes).`
        );
    }

    const padded = new Uint8Array(size);

    new DataView(padded.buffer).setUint32(0, content.length, false);
    padded.set(content, LENGTH_PREFIX);

    return padded;
}

/**
 * Quita el relleno de la escalera.
 *
 * @param {Uint8Array} padded
 * @returns {Uint8Array}
 * @throws {ShareEnvelopeError} Si el tamaño no es un escalón o la longitud declarada no cabe.
 */
export function unpadFromShareLadder(padded) {
    if (!SHARE_PADDED_SIZES.includes(padded.length)) {
        throw new ShareEnvelopeError(`Padded package of ${padded.length} bytes does not match any share size.`);
    }

    const declared = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0, false);

    if (declared > padded.length - LENGTH_PREFIX) {
        throw new ShareEnvelopeError('Padded package declares a length larger than its own size.');
    }

    return padded.slice(LENGTH_PREFIX, LENGTH_PREFIX + declared);
}

/**
 * Comprime con `CompressionStream('gzip')`, nativo en Safari 16.4 y Chromium
 * (ADR 0011), sin añadir ninguna dependencia al bundle.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function gzip(bytes) {
    return streamThrough(bytes, new CompressionStream('gzip'));
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 * @throws {ShareEnvelopeError} Si los bytes no son gzip válido o se pasan del tope de expansión.
 */
export async function gunzip(bytes) {
    let decompressed;

    try {
        decompressed = await streamThrough(bytes, new DecompressionStream('gzip'));
    } catch {
        throw new ShareEnvelopeError('Package content is not valid gzip.');
    }

    if (decompressed.length > MAX_DECOMPRESSED_LENGTH) {
        throw new ShareEnvelopeError(`Package expands to more than ${MAX_DECOMPRESSED_LENGTH} bytes.`);
    }

    return decompressed;
}

/**
 * @param {Uint8Array} bytes
 * @param {TransformStream} transform
 * @returns {Promise<Uint8Array>}
 */
async function streamThrough(bytes, transform) {
    const writer = transform.writable.getWriter();
    const written = writer.write(bytes).then(() => writer.close());
    const collected = new Response(transform.readable).arrayBuffer();

    await written;

    return new Uint8Array(await collected);
}

/**
 * Cierra el paquete a partir de bytes ya en claro.
 *
 * @param {object} params
 * @param {Uint8Array} params.contentKey `CK`: 32 bytes de `getRandomValues`.
 * @param {Uint8Array|string} params.plaintext Contenido del paquete.
 * @param {string} params.shareId UUIDv4 del paquete.
 * @param {Date|number|string} params.generatedAt Instante de generación.
 * @param {Uint8Array} [params.keyId] 4 bytes reservados; ceros por defecto.
 * @returns {Promise<string>} `s1.` + base64url.
 */
export async function sealSharePackageBytes({ contentKey, plaintext, shareId, generatedAt, keyId }) {
    assertKey(contentKey);

    const associatedData = sharePackageContext({ shareId, generatedAt });
    const salt = randomBytes(SALT_LENGTH);
    const nonce = randomBytes(NONCE_LENGTH);
    const header = new Uint8Array(HEADER_LENGTH);

    header[0] = ENVELOPE_VERSION;
    header[1] = ALGORITHM_XCHACHA20_POLY1305;
    header[2] = KDF_HKDF_SHA512;
    header[3] = FLAG_PADDED | FLAG_COMPRESSED;

    if (keyId !== undefined) {
        if (!(keyId instanceof Uint8Array) || keyId.length !== KEY_ID_LENGTH) {
            throw new ShareEnvelopeError(`keyId must be a Uint8Array of ${KEY_ID_LENGTH} bytes.`);
        }

        header.set(keyId, 4);
    }

    header.set(salt, 8);
    header.set(nonce, 8 + SALT_LENGTH);

    const content = toBytes(plaintext, 'plaintext');
    const compressed = await gzip(content);
    const padded = padToShareLadder(compressed);
    const packageKey = deriveKey({
        ikm: contentKey,
        label: KDF_LABELS.ENVELOPE,
        context: associatedData,
        salt,
    });

    try {
        const sealed = xchacha20poly1305(packageKey, nonce, aeadAssociatedData(header, associatedData)).encrypt(padded);
        const envelope = new Uint8Array(HEADER_LENGTH + sealed.length);

        envelope.set(header, 0);
        envelope.set(sealed, HEADER_LENGTH);

        return SHARE_PREFIX + encodeBase64Url(envelope);
    } finally {
        zeroize(packageKey, padded, compressed);
    }
}

/**
 * Abre el paquete y devuelve sus bytes en claro.
 *
 * @param {object} params
 * @param {Uint8Array} params.contentKey `CK`, tal cual salió del envoltorio.
 * @param {string} params.envelope `s1.` + base64url.
 * @param {string} params.shareId Mismo identificador que al cerrarlo.
 * @param {Date|number|string} params.generatedAt Mismo instante que al cerrarlo.
 * @returns {Promise<Uint8Array>}
 * @throws {ShareEnvelopeError} Prefijo, base64url, cabecera, escalón o tag inválidos.
 *         Nunca se silencia (ADR 0004).
 */
export async function openSharePackageBytes({ contentKey, envelope, shareId, generatedAt }) {
    assertKey(contentKey);

    if (typeof envelope !== 'string' || !envelope.startsWith(SHARE_PREFIX)) {
        throw new ShareEnvelopeError('Share package does not start with the s1. prefix.');
    }

    const bytes = decodeBase64Url(envelope.slice(SHARE_PREFIX.length), 'share package');

    if (bytes.length < HEADER_LENGTH + TAG_LENGTH + SHARE_PADDED_SIZES[0]) {
        throw new ShareEnvelopeError(`Share package is too short: ${bytes.length} bytes.`);
    }

    if (bytes[0] !== ENVELOPE_VERSION) {
        throw new ShareEnvelopeError(`Unsupported share package version: ${bytes[0]}.`);
    }

    if (bytes[1] !== ALGORITHM_XCHACHA20_POLY1305) {
        throw new ShareEnvelopeError(`Unsupported share package algorithm: ${bytes[1]}.`);
    }

    if (bytes[2] !== KDF_HKDF_SHA512) {
        throw new ShareEnvelopeError(`Unsupported share package KDF: ${bytes[2]}.`);
    }

    if ((bytes[3] & FLAG_PADDED) !== FLAG_PADDED) {
        throw new ShareEnvelopeError('Share package is not marked as padded.');
    }

    const header = bytes.slice(0, HEADER_LENGTH);
    const salt = bytes.slice(8, 8 + SALT_LENGTH);
    const nonce = bytes.slice(8 + SALT_LENGTH, HEADER_LENGTH);
    const sealed = bytes.slice(HEADER_LENGTH);

    if (!SHARE_PADDED_SIZES.includes(sealed.length - TAG_LENGTH)) {
        throw new ShareEnvelopeError(
            `Share package ciphertext of ${sealed.length} bytes does not match any share size.`
        );
    }

    const associatedData = sharePackageContext({ shareId, generatedAt });
    const packageKey = deriveKey({
        ikm: contentKey,
        label: KDF_LABELS.ENVELOPE,
        context: associatedData,
        salt,
    });

    let padded;

    try {
        padded = xchacha20poly1305(packageKey, nonce, aeadAssociatedData(header, associatedData)).decrypt(sealed);
    } catch {
        throw new ShareEnvelopeError(
            'Share package could not be decrypted: wrong key, wrong associated data, or corruption.'
        );
    } finally {
        zeroize(packageKey);
    }

    let compressed;

    try {
        compressed = unpadFromShareLadder(padded);
    } finally {
        zeroize(padded);
    }

    /*
     * La bandera manda: hoy siempre se comprime, pero un lector tiene que saber
     * leer lo que dice la cabecera y no lo que supone, porque la cabecera va
     * autenticada y una versión futura podría no comprimir.
     */
    if ((bytes[3] & FLAG_COMPRESSED) !== FLAG_COMPRESSED) {
        return compressed;
    }

    try {
        return await gunzip(compressed);
    } finally {
        zeroize(compressed);
    }
}

/**
 * Cierra el paquete a partir del cuerpo en claro del recorte.
 *
 * El cuerpo lleva el rango exacto, el instante de generación, el número de
 * eventos y las listas de tipos incluidos y excluidos (ADR 0011). `generatedAt`
 * sale del propio cuerpo y no de un parámetro aparte, para que el instante que
 * entra en el dato asociado y el que ve el profesional en pantalla sean por
 * construcción el mismo.
 *
 * @param {object} params
 * @param {Uint8Array} params.contentKey `CK`.
 * @param {string} params.shareId UUIDv4 del paquete.
 * @param {{generatedAt: (Date|number|string), eventCount: number, events: unknown[]}} params.body
 * @returns {Promise<string>} `s1.` + base64url.
 * @throws {ShareEnvelopeError} Si el cuerpo no cumple su propio compromiso.
 */
export async function sealSharePackage({ contentKey, shareId, body }) {
    assertShareBody(body);

    return sealSharePackageBytes({
        contentKey,
        plaintext: JSON.stringify({ ...body, generatedAt: canonicalDate(body.generatedAt) }),
        shareId,
        generatedAt: body.generatedAt,
    });
}

/**
 * Abre el paquete y devuelve su cuerpo ya parseado.
 *
 * Comprueba dos cosas que el AEAD por sí solo no dice en voz alta:
 *
 * 1. Que `eventCount` cuadra con los eventos que trae. Es el compromiso que
 *    sustituye al manifiesto de trozos: sin él, una entrega incompleta se
 *    leería como un historial coherente al que le falta la semana mala.
 * 2. Que el `generatedAt` que el servidor puso fuera del sobre es el mismo que
 *    va dentro. El de fuera lo necesita el lector para construir el dato
 *    asociado, así que llega por un canal que el servidor controla; si mintiera
 *    ya no descifraría, y esta comprobación deja además el error explícito.
 *
 * @param {object} params
 * @param {Uint8Array} params.contentKey `CK`.
 * @param {string} params.envelope `s1.` + base64url.
 * @param {string} params.shareId Identificador del paquete.
 * @param {Date|number|string} params.generatedAt Instante de generación anunciado.
 * @returns {Promise<object>} Cuerpo en claro.
 * @throws {ShareEnvelopeError}
 */
export async function openSharePackage({ contentKey, envelope, shareId, generatedAt }) {
    const bytes = await openSharePackageBytes({ contentKey, envelope, shareId, generatedAt });
    let body;

    try {
        body = JSON.parse(TEXT_DECODER.decode(bytes));
    } catch {
        throw new ShareEnvelopeError('Share package content is not valid UTF-8 JSON.');
    } finally {
        zeroize(bytes);
    }

    assertShareBody(body);

    if (body.generatedAt !== canonicalDate(generatedAt)) {
        throw new ShareEnvelopeError('Share package was generated at a different instant than announced.');
    }

    return body;
}

/**
 * @param {any} body
 * @returns {void}
 * @throws {ShareEnvelopeError}
 */
export function assertShareBody(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new ShareEnvelopeError('Share package body must be an object.');
    }

    if (!Array.isArray(body.events)) {
        throw new ShareEnvelopeError('Share package body must carry an events array.');
    }

    if (!Number.isInteger(body.eventCount) || body.eventCount !== body.events.length) {
        throw new ShareEnvelopeError(
            `Share package declares ${body.eventCount} events but carries ${body.events.length}.`
        );
    }
}

/**
 * @param {number} length
 * @returns {Uint8Array}
 */
function randomBytes(length) {
    const bytes = new Uint8Array(length);

    globalThis.crypto.getRandomValues(bytes);

    return bytes;
}

/**
 * @param {Uint8Array} header
 * @param {Uint8Array} associatedData
 * @returns {Uint8Array}
 */
function aeadAssociatedData(header, associatedData) {
    const combined = new Uint8Array(header.length + associatedData.length);

    combined.set(header, 0);
    combined.set(associatedData, header.length);

    return combined;
}

/**
 * @param {Uint8Array|string} value
 * @param {string} name
 * @returns {Uint8Array}
 */
function toBytes(value, name) {
    if (value instanceof Uint8Array) {
        return value;
    }

    if (typeof value === 'string') {
        return TEXT_ENCODER.encode(value);
    }

    throw new ShareEnvelopeError(`${name} must be a Uint8Array or a string.`);
}

/**
 * Los identificadores entran en minúsculas, como el identificador de usuario
 * del ADR 0004: dos formas de escribir el mismo UUID producirían dos datos
 * asociados distintos y un descifrado fallido según quién teclease.
 *
 * @param {string} value
 * @param {string} name
 * @returns {string}
 */
function assertIdentifier(value, name) {
    if (typeof value !== 'string' || value === '') {
        throw new ShareEnvelopeError(`${name} must be a non-empty string.`);
    }

    return value.toLowerCase();
}

/**
 * @param {Uint8Array} key
 * @returns {void}
 */
function assertKey(key) {
    if (!(key instanceof Uint8Array) || key.length !== KEY_LENGTH) {
        throw new ShareEnvelopeError(`contentKey must be a Uint8Array of ${KEY_LENGTH} bytes.`);
    }
}
