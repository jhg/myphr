/**
 * Dueño de la clave maestra en memoria (Spec 0001 §10; ADR 0003).
 *
 * La clave vive en el scope de este módulo ES y **no sale de aquí**: no hay getter que la
 * devuelva. Quien necesita cifrar o descifrar pasa una función a `withMasterKey`, que la recibe
 * prestada durante la llamada. Así no queda una referencia colgada en el estado de un componente
 * Alpine ni en una propiedad de Livewire.
 *
 * Como el scope es por pestaña, dos pestañas no comparten nada: cada una hace su login o su
 * recuperación. Perder la clave es un estado normal y frecuente, no un error (§7).
 *
 * El paquete de `sessionStorage` se cierra y se abre también desde aquí, por el mismo motivo: si
 * lo hiciera otro módulo, la clave tendría que salir para llegar hasta él.
 */

import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { open, seal } from '../crypto/envelope.js';
import { decodeBase64Url } from '../crypto/base64url.js';
import { zeroize } from '../crypto/zeroize.js';

/** Clave de `sessionStorage` donde vive la clave maestra envuelta bajo el secreto de sesión. */
export const RECOVERY_STORAGE_KEY = 'phr.rk';

/** Longitud de la clave maestra, en bytes. */
export const MASTER_KEY_LENGTH = 32;

/** @type {Uint8Array|null} */
let masterKey = null;

/** @type {string|null} */
let masterKeyOwnerId = null;

/** ¿Hay clave maestra en memoria en esta pestaña? */
export function isUnlocked() {
    return masterKey !== null;
}

/** UUID del usuario dueño de la clave en memoria, o `null`. Metadato, no material de clave. */
export function ownerId() {
    return masterKeyOwnerId;
}

/**
 * Genera la clave maestra (§5, paso 8): 32 bytes del CSPRNG, **nunca** derivados de la contraseña.
 *
 * @param {string} userId
 */
export function createMasterKey(userId) {
    forget();

    masterKey = crypto.getRandomValues(new Uint8Array(MASTER_KEY_LENGTH));
    masterKeyOwnerId = userId;
}

/**
 * Adopta una clave maestra ya existente, recién abierta de un sobre.
 *
 * @param {Uint8Array} key
 * @param {string} userId
 */
export function adoptMasterKey(key, userId) {
    if (!(key instanceof Uint8Array) || key.length !== MASTER_KEY_LENGTH) {
        throw new TypeError(`The master key must be ${MASTER_KEY_LENGTH} bytes.`);
    }

    forget();

    masterKey = key.slice();
    masterKeyOwnerId = userId;
}

/**
 * Presta la clave maestra durante una llamada.
 *
 * El búfer que recibe la función es el de este módulo: no debe guardarse ni borrarse desde fuera.
 *
 * @template T
 * @param {(key: Uint8Array) => T} work
 * @returns {T}
 * @throws {Error} Si no hay clave en memoria. Quien llama degrada a pedir autenticación (§6.2).
 */
export function withMasterKey(work) {
    if (masterKey === null) {
        throw new Error('There is no master key in memory.');
    }

    return work(masterKey);
}

/** Borra la clave de memoria. Es a lo sumo un intento (ADR 0004). */
export function forget() {
    if (masterKey !== null) {
        zeroize(masterKey);
    }

    masterKey = null;
    masterKeyOwnerId = null;
}

/**
 * Cierra la clave maestra bajo el secreto de sesión y la escribe en `sessionStorage`
 * (§5, paso 18 y §6.1, paso 9).
 *
 * Se llama **después** de que el servidor haya acuñado el secreto y después de verificar la clave,
 * nunca antes: en el primer caso quedaría material cifrado bajo un secreto que no existe, y en el
 * segundo se persistiría una clave que todavía no se sabe si el servidor devuelve bien.
 *
 * El secreto de sesión se borra aquí mismo; el `Uint8Array` que llega es propiedad de quien llama.
 *
 * @param {Uint8Array} sessionSecret 32 bytes ya decodificados.
 */
export function persistUnderSessionSecret(sessionSecret) {
    const sessionKey = deriveKey({ ikm: sessionSecret, label: KDF_LABELS.SESSION });

    try {
        const packed = withMasterKey((key) => seal({
            key: sessionKey,
            plaintext: key,
            associatedData: masterKeyOwnerId ?? '',
        }));

        sessionStorage.setItem(RECOVERY_STORAGE_KEY, packed);
    } finally {
        zeroize(sessionKey);
    }
}

/**
 * Abre el paquete de `sessionStorage` con el secreto de sesión y adopta la clave (§6.2, paso 3).
 *
 * @param {Uint8Array} sessionSecret
 * @param {string} userId
 * @returns {boolean} `false` si no había paquete guardado; en ese caso hay que ir al login.
 * @throws {import('../crypto/envelope.js').EnvelopeError} Si el paquete no abre. No se silencia:
 *         un fallo de descifrado es siempre un error visible (ADR 0004).
 */
export function restoreFromSessionSecret(sessionSecret, userId) {
    const packed = sessionStorage.getItem(RECOVERY_STORAGE_KEY);

    if (typeof packed !== 'string' || packed === '') {
        return false;
    }

    const sessionKey = deriveKey({ ikm: sessionSecret, label: KDF_LABELS.SESSION });
    let key = null;

    try {
        key = open({ key: sessionKey, envelope: packed, associatedData: userId });

        adoptMasterKey(key, userId);

        return true;
    } finally {
        zeroize(sessionKey);

        if (key !== null) {
            zeroize(key);
        }
    }
}

/**
 * Decodifica el secreto de sesión que llega en base64url.
 *
 * @param {string} sessionSecret
 * @returns {Uint8Array}
 */
export function decodeSessionSecret(sessionSecret) {
    return decodeBase64Url(sessionSecret, 'sessionSecret');
}
