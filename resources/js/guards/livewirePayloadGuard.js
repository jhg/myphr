/**
 * Interceptor de las peticiones de Livewire (Spec 0001 §9; ADR 0002).
 *
 * Revisa lo que sale del navegador en cada mensaje de Livewire y **aborta** si encuentra un valor
 * largo que no lleve el prefijo `v1.` del sobre cifrado. Es un guardarraíl contra el descuido, no
 * una medida de seguridad: quien controla el navegador puede quitarlo. Lo que evita es que un
 * `wire:model` puesto sin pensar mande datos clínicos en claro al servidor y nadie se entere hasta
 * que están escritos en la base de datos.
 *
 * Es la mitad de cliente del par de §9. La otra mitad es el listener de servidor, que cubre lo que
 * este no puede cubrir: si el descuido está en el propio cliente, es el cliente quien genera la
 * carga y no tiene sentido pedirle que se audite a sí mismo con garantías.
 *
 * **Qué se revisa y qué no.** Solo los tres sitios por los que viajan datos del usuario:
 * `snapshot.data`, `updates` y los parámetros de `calls`. El `memo` y el `checksum` del snapshot son
 * metadatos del propio Livewire (identificadores, ruta, errores de validación) y se dejan pasar: no
 * los escribe la aplicación y bloquearlos rompería el marco sin proteger nada.
 *
 * **El umbral.** Un sobre cifrado del ADR 0004, con el menor de los tamaños de relleno, no baja de
 * unos 450 caracteres. Cualquier cadena por encima de `MAX_PLAINTEXT_LENGTH` que no empiece por
 * `v1.` es, o un dato en claro que no debería salir, o un valor que hay que envolver. El umbral es
 * un compromiso, no un número de la spec: bajarlo dispara falsos positivos sobre metadatos legítimos
 * de Filament, y subirlo deja pasar párrafos enteros en claro.
 */

import { ENVELOPE_PREFIX } from '../crypto/envelope.js';

/** Longitud a partir de la cual una cadena tiene que ser un sobre cifrado. */
export const MAX_PLAINTEXT_LENGTH = 256;

/** Aborto del guardarraíl. Nunca lleva el valor ofensor, solo su ruta dentro de la carga. */
export class LivewirePayloadGuardError extends Error {
    /** @param {string} path */
    constructor(path) {
        super(
            `Livewire payload guard: "${path}" carries a long value without the ${ENVELOPE_PREFIX} envelope prefix. `
            + 'The request was aborted.'
        );
        this.name = 'LivewirePayloadGuardError';
        this.path = path;
    }
}

/**
 * Primera ruta que incumple la regla, recorriendo en profundidad.
 *
 * @param {unknown} value
 * @param {string} path
 * @returns {string|null} Ruta del valor ofensor, o `null` si no hay ninguno.
 */
export function firstViolation(value, path) {
    if (typeof value === 'string') {
        return value.length > MAX_PLAINTEXT_LENGTH && !value.startsWith(ENVELOPE_PREFIX) ? path : null;
    }

    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            const violation = firstViolation(value[index], `${path}[${index}]`);

            if (violation !== null) {
                return violation;
            }
        }

        return null;
    }

    if (value !== null && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
            const violation = firstViolation(nested, path === '' ? key : `${path}.${key}`);

            if (violation !== null) {
                return violation;
            }
        }
    }

    return null;
}

/**
 * @param {unknown} snapshot Objeto, o la cadena JSON sin parsear que Livewire reenvía tal cual.
 * @returns {Record<string, unknown>} Los datos del snapshot, o vacío si no se pueden leer.
 */
function snapshotData(snapshot) {
    let parsed = snapshot;

    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return {};
        }
    }

    const data = parsed !== null && typeof parsed === 'object' ? parsed.data : null;

    return data !== null && typeof data === 'object' ? data : {};
}

/**
 * Revisa una carga de mensaje de Livewire.
 *
 * @param {{snapshot?: unknown, updates?: unknown, calls?: unknown}} payload
 * @returns {string|null} Ruta del valor ofensor, o `null`.
 */
export function inspectPayload(payload) {
    if (payload === null || typeof payload !== 'object') {
        return null;
    }

    const violation = firstViolation(snapshotData(payload.snapshot), 'snapshot.data')
        ?? firstViolation(payload.updates ?? {}, 'updates');

    if (violation !== null) {
        return violation;
    }

    const calls = Array.isArray(payload.calls) ? payload.calls : [];

    for (let index = 0; index < calls.length; index += 1) {
        const found = firstViolation(calls[index]?.params ?? [], `calls[${index}].params`);

        if (found !== null) {
            return found;
        }
    }

    return null;
}

/** Evento que se emite al abortar. Lleva la ruta, nunca el valor. */
export const GUARD_VIOLATION_EVENT = 'phr:payload-guard-violation';

/**
 * Aborta un mensaje y lo deja registrado de forma ruidosa.
 *
 * No se lanza una excepción: el cuerpo del interceptor corre dentro del bucle con el que Livewire
 * monta **todas** las peticiones pendientes, así que una excepción aquí se llevaría por delante
 * mensajes de otros componentes que no tienen nada que ver. `cancel()` ya es el aborto; el registro
 * y el evento son lo que impide que el fallo pase por un formulario que «a veces no guarda».
 *
 * @param {() => void} cancel
 * @param {string} violation
 */
function abort(cancel, violation) {
    cancel();

    const failure = new LivewirePayloadGuardError(violation);

    console.error(failure);
    document.dispatchEvent(new CustomEvent(GUARD_VIOLATION_EVENT, { detail: { path: violation } }));
}

/**
 * Registra el interceptor sobre Livewire.
 *
 * La revisión va en el cuerpo del interceptor de mensaje, **no** en su `onSend`. Livewire construye
 * `message.payload` antes de crear los interceptores, y solo después lanza el `fetch`; el `onSend`
 * de un mensaje, en cambio, se invoca con la promesa de respuesta ya en marcha, es decir, con la
 * carga ya escrita en el socket. Cancelar ahí anularía la respuesta pero no impediría que los datos
 * en claro salieran del navegador, que es justo lo único que este guardarraíl tiene que impedir.
 *
 * El `onSend` se conserva como red de seguridad para el caso de que una versión futura de Livewire
 * arme la carga más tarde: entonces el cuerpo no vería nada y esta sería la única revisión posible.
 *
 * @param {{interceptMessage?: Function}} [livewire] Por defecto, `window.Livewire`.
 * @returns {boolean} `false` si Livewire no expone el interceptor.
 */
export function installLivewirePayloadGuard(livewire = window.Livewire) {
    if (typeof livewire?.interceptMessage !== 'function') {
        return false;
    }

    livewire.interceptMessage(({ message, cancel, onSend }) => {
        const violation = inspectPayload(message?.payload);

        if (violation !== null) {
            abort(cancel, violation);

            return;
        }

        onSend(({ payload }) => {
            if (message?.payload != null) {
                return;
            }

            const late = inspectPayload(payload);

            if (late !== null) {
                abort(cancel, late);
            }
        });
    });

    return true;
}
