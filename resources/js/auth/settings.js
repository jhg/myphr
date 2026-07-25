/**
 * Ajustes cifrados del usuario, descifrados en memoria (Spec 0001 §6.1 paso 10 y §6.2 paso 4;
 * ADR 0007).
 *
 * Igual que la clave maestra en `keyring.js`, los ajustes ya descifrados viven en el scope de este
 * módulo ES y no en el estado de un componente Alpine ni en una propiedad de Livewire: así no
 * acaban en una instantánea de DOM que Livewire retenga con datos en claro.
 *
 * Una cuenta puede no tener sobre de ajustes todavía, y eso no es un error (`loadSettings` lo trata
 * como «nada que cargar»). Un sobre que sí existe pero no abre es otra cosa: un `EnvelopeError` que
 * aquí no se silencia, igual que `keyring.restoreFromSessionSecret` (ADR 0004). Quien llama decide
 * cómo degradar.
 *
 * `saveSettings` es la vía de escritura (ADR 0007): sella con la MISMA derivación y el MISMO dato
 * asociado que la lectura —de ahí `withSettingsKey`, que las comparte— y manda el sobre a
 * `PUT /phr/settings`. El servidor solo valida la envoltura; el contenido nunca sale de aquí en
 * claro.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { openText, sealText } from '../crypto/envelope.js';
import { zeroize } from '../crypto/zeroize.js';
import { envelopeContext, ENVELOPE_PURPOSES } from './context.js';
import { putJson } from './http.js';
import { withMasterKey } from './keyring.js';

/** Evento de DOM con el que las pantallas ya montadas recalculan sin recargar. */
export const SETTINGS_UPDATED_EVENT = 'phr:settings-updated';

/** @type {object|null} */
let decryptedSettings = null;

/**
 * Sobre `v1.` que el cliente cree vigente en el servidor, para la precondición `If-Match`.
 *
 * @type {string|null}
 */
let currentEnvelope = null;

const TEXT_ENCODER = new TextEncoder();

/**
 * Deriva la clave del sobre de ajustes y ejecuta `use` con ella.
 *
 * Existe para que el sellado y la apertura compartan **una sola** construcción de contexto y de
 * derivación: duplicarlas y dejar que diverjan un solo byte es dejar los ajustes sin abrir para
 * siempre, porque desde el servidor no se puede re-cifrar nada.
 *
 * @template T
 * @param {string} userId
 * @param {(key: Uint8Array, settingsContext: string) => T} use
 * @returns {T}
 */
function withSettingsKey(userId, use) {
    const settingsContext = envelopeContext(userId, ENVELOPE_PURPOSES.Settings);

    return withMasterKey((masterKey) => {
        const settingsKey = deriveKey({
            ikm: masterKey,
            label: KDF_LABELS.SETTINGS,
            context: settingsContext,
        });

        try {
            return use(settingsKey, settingsContext);
        } finally {
            zeroize(settingsKey);
        }
    });
}

/**
 * Descifra el sobre de ajustes y lo deja en memoria (§6.1, paso 10; §6.2, paso 4).
 *
 * @param {object} params
 * @param {string|null|undefined} params.envelope Sobre `v1.` de `encryptedSettings`. Si no es una
 *        cadena no vacía, la cuenta todavía no tiene ajustes: no hace nada.
 * @param {string} params.userId UUID del usuario, dato asociado del sobre.
 * @returns {object|null} Copia de los ajustes cargados, o `null` si no había sobre.
 * @throws {import('../crypto/envelope.js').EnvelopeError} Si el sobre no abre. No se silencia
 *         (ADR 0004).
 */
export function loadSettings({ envelope, userId }) {
    if (typeof envelope !== 'string' || envelope === '') {
        return null;
    }

    const plaintext = withSettingsKey(userId, (settingsKey, settingsContext) =>
        openText({ key: settingsKey, envelope, associatedData: settingsContext })
    );

    decryptedSettings = JSON.parse(plaintext);
    currentEnvelope = envelope;

    return settings();
}

/**
 * Sella los ajustes y los guarda (`PUT /phr/settings`, ADR 0007).
 *
 * El merge es del cliente porque es el único que puede hacerlo: el servidor no puede parchear un
 * documento que no puede descifrar. Una clave del parche con valor `undefined` o `null` **borra**
 * ese ajuste, que es la representación de «no configurado» del ADR 0007: nunca se escribe un
 * marcador vacío. `v` no es parcheable.
 *
 * La memoria y el sobre vigente solo se actualizan **después** de un 2xx: la pantalla no puede
 * mostrar un ajuste que el servidor no tiene.
 *
 * @param {object} params
 * @param {object} params.patch Ajustes a fijar o a borrar.
 * @param {string} params.userId UUID del usuario, dato asociado del sobre.
 * @param {string} [params.locale] Idioma de la aplicación. Es el único campo que viaja **fuera**
 *        del sobre, en claro (ADR 0007): el servidor tiene que resolverlo para pintar el panel y la
 *        pantalla de acceso, que existe antes que ninguna clave. No participa en el `If-Match`,
 *        que protege el sobre. Se omite del cuerpo cuando no se pasa, para no reescribirlo desde
 *        pantallas que no lo tocan.
 * @param {string} params.url Destino de `PUT /phr/settings`.
 * @returns {Promise<object>} Copia de los ajustes ya guardados.
 * @throws {import('./http.js').AuthRequestError} Fallo de red o respuesta no 2xx; entre ellas 412
 *         `settings_conflict`, que significa que otra pestaña guardó antes y hay que recargar los
 *         ajustes, reaplicar el cambio y reintentar una vez.
 */
export async function saveSettings({ patch, userId, locale, url }) {
    const merged = { ...(decryptedSettings ?? {}), v: 1 };

    for (const [key, value] of Object.entries(patch ?? {})) {
        if (key === 'v') {
            continue;
        }

        if (value === undefined || value === null) {
            delete merged[key];
        } else {
            merged[key] = value;
        }
    }

    const envelope = withSettingsKey(userId, (settingsKey, settingsContext) =>
        sealText({
            key: settingsKey,
            plaintext: JSON.stringify(merged),
            associatedData: settingsContext,
        })
    );

    const body = { encryptedSettings: envelope };

    if (typeof locale === 'string' && locale !== '') {
        body.locale = locale;
    }

    await putJson(url, body, { 'If-Match': ifMatchTag() });

    decryptedSettings = merged;
    currentEnvelope = envelope;

    globalThis.document?.dispatchEvent?.(new CustomEvent(SETTINGS_UPDATED_EVENT));

    return settings();
}

/**
 * Precondición del `PUT`: sha256 del sobre que el cliente cree vigente, o `*` cuando la cuenta
 * todavía no tiene ninguno.
 *
 * @returns {string}
 */
function ifMatchTag() {
    return currentEnvelope === null
        ? '*'
        : `"${bytesToHex(sha256(TEXT_ENCODER.encode(currentEnvelope)))}"`;
}

/** @returns {object|null} Copia de los ajustes cargados, o `null` si no hay ninguno en memoria. */
export function settings() {
    return decryptedSettings === null ? null : { ...decryptedSettings };
}

/** @returns {boolean} */
export function hasSettings() {
    return decryptedSettings !== null;
}

/** Borra los ajustes de memoria, y con ellos el sobre vigente que respalda la precondición. */
export function forgetSettings() {
    decryptedSettings = null;
    currentEnvelope = null;
}
