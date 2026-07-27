/**
 * Construcción de claves del enlace de compartición (ADR 0011).
 *
 * ```
 * stretched = Argon2id(v0x13, PIN en NFKC UTF-8, pinSalt, m=65536 KiB, t=3, p=4, dkLen=32)
 * pinTag    = HKDF-SHA-512(ikm=stretched,    salt=pinSalt, info="myphr/share-pin-tag/v1" || 0x00 || linkId, L=32)
 * wrapKey   = HKDF-SHA-512(ikm=S||stretched, salt=pinSalt,
 *                          info="myphr/share-link/v1" || 0x00 || linkId || 0x00 || canonicalDate(expiresAt), L=32)
 * ```
 *
 * **Por qué el PIN pasa por Argon2id y no directamente por HKDF.** Un PIN de
 * seis dígitos es un millón de posibilidades: con HKDF, que no tiene coste
 * ajustable, se prueban todas en segundos. Argon2id no arregla por sí solo un
 * secreto de veinte bits —por eso el ADR 0011 verifica el PIN en línea y cuenta
 * cinco intentos en columna—, pero encarece el ataque de quien vuelque la base
 * de datos y se lleve `pin_tag`.
 *
 * **Por qué las dos ramas son ramas y no dos usos de la misma salida.**
 * `pinTag` viaja al servidor y se guarda allí; `wrapKey` jamás sale del
 * navegador. Si fuesen el mismo valor, guardar el tag sería guardar la clave.
 * Al colgar las dos de HKDF con etiquetas distintas, conocer una no da la otra;
 * y como `wrapKey` mezcla además los 256 bits de `S`, que viven en el fragmento
 * de la URL y nunca llegan al servidor, romper el tag por fuerza bruta no
 * acerca a nadie al contenido.
 *
 * **Por qué `linkId` y `expiresAt` entran en el `info`.** Atan la clave a ese
 * enlace concreto y a esa caducidad concreta: el servidor no puede reutilizar
 * el material de un enlace en otro, ni estirar la vida de uno cambiando la
 * fecha, porque cualquiera de las dos cosas deriva otra clave y el sobre deja
 * de abrir.
 *
 * Los parámetros de Argon2id son los mismos del KSF de OPAQUE (`docs/OPAQUE.md`
 * §17 y ADR 0004), para no mantener dos perfiles de coste en el proyecto.
 * Cuestan más de un segundo en un portátil reciente y varios en un equipo de
 * consulta, así que existe la variante asíncrona con progreso.
 */

import { argon2id, argon2idAsync } from '@noble/hashes/argon2.js';

import { canonicalDate } from './canonicalDate.js';
import { deriveKey, KDF_LABELS, KEY_LENGTH } from './kdf.js';
import { joinWithSeparator } from './shareEnvelope.js';
import { zeroize } from './zeroize.js';

/** Perfil de Argon2id, idéntico al KSF de OPAQUE. No se toca sin subir versión de etiqueta. */
export const ARGON2_PARAMS = Object.freeze({ version: 0x13, m: 65536, t: 3, p: 4, dkLen: 32 });

/** Bytes de la sal por enlace (columna `share_links.pin_salt`). */
export const PIN_SALT_LENGTH = 16;

/** Longitud de `S`, la clave de envío que viaja en el fragmento de la URL. */
export const SEND_KEY_LENGTH = KEY_LENGTH;

/** Dígitos del PIN. */
export const PIN_LENGTH = 6;

/** Valores posibles del PIN: 000000..999999. */
const PIN_RANGE = 10 ** PIN_LENGTH;

/** Un dígito por posición, ya normalizado. */
const PIN_PATTERN = /^[0-9]{6}$/;

/**
 * Mayor múltiplo de `PIN_RANGE` que cabe en 32 bits.
 *
 * **El sesgo de módulo, y por qué no se hace `% 1000000` a secas.** Un entero
 * de 32 bits tiene 4.294.967.296 valores, y 4.294.967.296 = 4.294 x 1.000.000 +
 * 967.296. Al reducir módulo un millón, los PIN de 000000 a 967295 saldrían de
 * 4.295 valores del generador y los de 967296 a 999999 solo de 4.294: los
 * primeros son un 0,02 % más probables. Es un sesgo pequeño, pero es un sesgo
 * medible en un secreto de veinte bits que además protege datos clínicos, y
 * quitarlo cuesta un bucle: se descartan los valores por encima del último
 * múltiplo completo (muestreo por rechazo) y el resto se reduce sin sesgo. El
 * bucle termina con probabilidad 1 y en la práctica acierta a la primera el
 * 99,977 % de las veces.
 */
const UNBIASED_LIMIT = 4294967296 - (4294967296 % PIN_RANGE);

const TEXT_ENCODER = new TextEncoder();

/** Error de la construcción de claves del enlace. */
export class ShareKeyError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'ShareKeyError';
    }
}

/**
 * Genera el PIN: seis dígitos de CSPRNG sin sesgo de módulo.
 *
 * Lo genera la aplicación y nunca lo elige la persona (ADR 0011): un PIN
 * elegido a mano acaba siendo la fecha de nacimiento del paciente, y ahí los
 * cinco intentos del servidor no protegen de nada.
 *
 * @returns {string} Exactamente seis dígitos, con los ceros a la izquierda.
 */
export function generatePin() {
    const buffer = new Uint32Array(1);

    for (;;) {
        globalThis.crypto.getRandomValues(buffer);

        if (buffer[0] < UNBIASED_LIMIT) {
            return String(buffer[0] % PIN_RANGE).padStart(PIN_LENGTH, '0');
        }
    }
}

/**
 * Sal por enlace: 16 bytes aleatorios (columna `pin_salt`).
 *
 * @returns {Uint8Array}
 */
export function generatePinSalt() {
    return randomBytes(PIN_SALT_LENGTH);
}

/**
 * `S`, la clave de envío: 32 bytes de `getRandomValues`, **jamás derivados de
 * la clave maestra** (ADR 0011). Viaja en el fragmento de la URL, que no llega
 * al servidor, y es lo que hace que un volcado de la base de datos no baste.
 *
 * @returns {Uint8Array}
 */
export function generateSendKey() {
    return randomBytes(SEND_KEY_LENGTH);
}

/**
 * `CK`, la clave de contenido que cifra el paquete: 32 bytes de
 * `getRandomValues`. Vive en el descriptor cifrado bajo la clave maestra, que
 * es lo que permite re-armar un enlace sin rehacer el recorte.
 *
 * @returns {Uint8Array}
 */
export function generateContentKey() {
    return randomBytes(KEY_LENGTH);
}

/**
 * Forma normalizada del PIN antes de entrar en Argon2id.
 *
 * NFKC no es decoración: un teclado con IME chino produce dígitos de ancho
 * completo, que en UTF-8 son bytes distintos de los ASCII y derivarían otra
 * clave. NFKC los pliega a los dígitos de siempre. Se recortan además los
 * espacios de los lados, que sobran al pegar el PIN desde un mensaje.
 *
 * @param {string} pin
 * @returns {string}
 * @throws {ShareKeyError} Si no son seis dígitos tras normalizar.
 */
export function normalizePin(pin) {
    if (typeof pin !== 'string') {
        throw new ShareKeyError('pin must be a string.');
    }

    const normalized = pin.normalize('NFKC').trim();

    if (!PIN_PATTERN.test(normalized)) {
        throw new ShareKeyError(`pin must be ${PIN_LENGTH} digits.`);
    }

    return normalized;
}

/**
 * Estira el PIN con Argon2id. Bloquea el hilo más de un segundo: en la interfaz
 * se usa `stretchPinAsync`.
 *
 * @param {object} params
 * @param {string} params.pin PIN tal cual lo teclea el profesional.
 * @param {Uint8Array} params.pinSalt Sal del enlace, 16 bytes.
 * @returns {Uint8Array} 32 bytes.
 */
export function stretchPin({ pin, pinSalt }) {
    return argon2id(TEXT_ENCODER.encode(normalizePin(pin)), assertPinSalt(pinSalt), ARGON2_PARAMS);
}

/**
 * Igual que `stretchPin`, cediendo el hilo entre bloques para que la barra de
 * progreso se pinte. `onProgress` recibe la fracción completada, de 0 a 1.
 *
 * En un equipo de consulta esto son varios segundos con alguien delante
 * esperando (ADR 0011), así que la alternativa a mostrar progreso es una
 * pestaña congelada que el profesional da por rota.
 *
 * @param {object} params
 * @param {string} params.pin
 * @param {Uint8Array} params.pinSalt
 * @param {(progress: number) => void} [params.onProgress]
 * @returns {Promise<Uint8Array>} 32 bytes.
 */
export async function stretchPinAsync({ pin, pinSalt, onProgress }) {
    return argon2idAsync(TEXT_ENCODER.encode(normalizePin(pin)), assertPinSalt(pinSalt), {
        ...ARGON2_PARAMS,
        ...(onProgress === undefined ? {} : { onProgress }),
    });
}

/**
 * Rama del tag: lo único de esta construcción que viaja al servidor.
 *
 * @param {object} params
 * @param {Uint8Array} params.stretched Salida de Argon2id.
 * @param {Uint8Array} params.pinSalt Sal del enlace.
 * @param {string} params.linkId UUIDv4 del enlace (el que viaja en la URL).
 * @returns {Uint8Array} 32 bytes, los que el servidor compara en tiempo constante.
 */
export function derivePinTag({ stretched, pinSalt, linkId }) {
    assertStretched(stretched);

    return deriveKey({
        ikm: stretched,
        label: KDF_LABELS.SHARE_PIN_TAG,
        context: TEXT_ENCODER.encode(assertIdentifier(linkId, 'linkId')),
        salt: assertPinSalt(pinSalt),
    });
}

/**
 * Rama de la clave de envoltura: nunca sale del navegador.
 *
 * @param {object} params
 * @param {Uint8Array} params.stretched Salida de Argon2id.
 * @param {Uint8Array} params.sendKey `S`, 32 bytes del fragmento de la URL.
 * @param {Uint8Array} params.pinSalt Sal del enlace.
 * @param {string} params.linkId UUIDv4 del enlace.
 * @param {Date|number|string} params.expiresAt Caducidad del enlace.
 * @returns {Uint8Array} 32 bytes.
 */
export function deriveWrapKey({ stretched, sendKey, pinSalt, linkId, expiresAt }) {
    assertStretched(stretched);

    if (!(sendKey instanceof Uint8Array) || sendKey.length !== SEND_KEY_LENGTH) {
        throw new ShareKeyError(`sendKey must be a Uint8Array of ${SEND_KEY_LENGTH} bytes.`);
    }

    /*
     * `S || stretched`: sin `S`, atacar el envoltorio costaría lo mismo que
     * atacar el tag, y el servidor tiene el tag. Con `S` le faltan 256 bits que
     * nunca ha visto.
     */
    const ikm = new Uint8Array(sendKey.length + stretched.length);

    ikm.set(sendKey, 0);
    ikm.set(stretched, sendKey.length);

    try {
        return deriveKey({
            ikm,
            label: KDF_LABELS.SHARE_LINK,
            context: shareLinkContext({ linkId, expiresAt }),
            salt: assertPinSalt(pinSalt),
        });
    } finally {
        zeroize(ikm);
    }
}

/**
 * `linkId || 0x00 || canonicalDate(expiresAt)`, que es a la vez el contexto de
 * derivación de `wrapKey` y el cuerpo del dato asociado del envoltorio
 * (`shareLink.js` le añade el hash del paquete).
 *
 * @param {object} params
 * @param {string} params.linkId
 * @param {Date|number|string} params.expiresAt
 * @returns {Uint8Array}
 */
export function shareLinkContext({ linkId, expiresAt }) {
    return joinWithSeparator([
        TEXT_ENCODER.encode(assertIdentifier(linkId, 'linkId')),
        TEXT_ENCODER.encode(canonicalDate(expiresAt)),
    ]);
}

/**
 * Las dos ramas de una vez, estirando el PIN una sola vez.
 *
 * Úsala cuando ya se conocen `S` y la caducidad. El flujo del lector puede
 * necesitar partirlo en dos —`pinTag` para el `open`, y `wrapKey` solo después,
 * con la caducidad que devuelva esa respuesta—, y para eso están
 * `stretchPinAsync`, `derivePinTag` y `deriveWrapKey` por separado: estirar el
 * PIN dos veces serían varios segundos regalados.
 *
 * @param {object} params
 * @param {string} params.pin
 * @param {Uint8Array} params.pinSalt
 * @param {string} params.linkId
 * @param {Date|number|string} params.expiresAt
 * @param {Uint8Array} params.sendKey
 * @param {(progress: number) => void} [params.onProgress]
 * @returns {Promise<{pinTag: Uint8Array, wrapKey: Uint8Array}>}
 */
export async function deriveShareLinkKeysAsync({ pin, pinSalt, linkId, expiresAt, sendKey, onProgress }) {
    const stretched = await stretchPinAsync({ pin, pinSalt, onProgress });

    try {
        return {
            pinTag: derivePinTag({ stretched, pinSalt, linkId }),
            wrapKey: deriveWrapKey({ stretched, sendKey, pinSalt, linkId, expiresAt }),
        };
    } finally {
        zeroize(stretched);
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
 * @param {Uint8Array} pinSalt
 * @returns {Uint8Array}
 */
function assertPinSalt(pinSalt) {
    if (!(pinSalt instanceof Uint8Array) || pinSalt.length !== PIN_SALT_LENGTH) {
        throw new ShareKeyError(`pinSalt must be a Uint8Array of ${PIN_SALT_LENGTH} bytes.`);
    }

    return pinSalt;
}

/**
 * @param {Uint8Array} stretched
 * @returns {void}
 */
function assertStretched(stretched) {
    if (!(stretched instanceof Uint8Array) || stretched.length !== ARGON2_PARAMS.dkLen) {
        throw new ShareKeyError(`stretched must be a Uint8Array of ${ARGON2_PARAMS.dkLen} bytes.`);
    }
}

/**
 * Los identificadores entran en minúsculas, como el identificador de usuario
 * del ADR 0004: dos formas de escribir el mismo UUID derivarían dos claves
 * distintas según quién lo teclease.
 *
 * @param {string} value
 * @param {string} name
 * @returns {string}
 */
function assertIdentifier(value, name) {
    if (typeof value !== 'string' || value === '') {
        throw new ShareKeyError(`${name} must be a non-empty string.`);
    }

    return value.toLowerCase();
}
