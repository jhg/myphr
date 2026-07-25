/**
 * Borrado best-effort de búferes de bytes.
 *
 * **No es una garantía.** En JavaScript no hay forma de asegurar que un valor
 * desaparece de la memoria del proceso: el recolector de basura puede haber
 * copiado el búfer, las cadenas son inmutables (una contraseña no se puede
 * borrar), y el WebAssembly de OPAQUE mantiene sus propias copias mientras viva
 * la pestaña. Esto sólo reduce la ventana en la que los bytes propios siguen
 * legibles en el heap (ADR 0004, "El borrado de memoria solo aplica a los
 * búferes de bytes propios, y aun ahí es a lo sumo un intento").
 */

/**
 * Rellena de ceros los `Uint8Array` recibidos, ignorando `null`/`undefined`.
 *
 * @param {...(Uint8Array|null|undefined)} buffers
 * @returns {void}
 */
export function zeroize(...buffers) {
    for (const buffer of buffers) {
        if (buffer === null || buffer === undefined) {
            continue;
        }

        if (!(buffer instanceof Uint8Array)) {
            throw new TypeError('zeroize expects Uint8Array values.');
        }

        buffer.fill(0);
    }
}

/**
 * Ejecuta `work` y borra los búferes indicados pase lo que pase.
 *
 * @template T
 * @param {Uint8Array[]} buffers Búferes a borrar al terminar.
 * @param {() => T} work
 * @returns {T}
 */
export function withZeroized(buffers, work) {
    try {
        return work();
    } finally {
        zeroize(...buffers);
    }
}
