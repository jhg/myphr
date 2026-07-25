/**
 * Navegación tras el login y recarga dura tras el cierre de sesión (Spec 0001 §5, paso 20, y §8).
 *
 * Dos operaciones distintas que no se pueden confundir:
 *
 * * `navigate()` conserva el contexto de JavaScript, y con él la clave maestra en memoria. Es lo
 *   que hace falta al entrar: si aquí ocurriera una recarga dura, la clave moriría justo después
 *   de nacer.
 * * `hardReload()` destruye el contexto de JavaScript, y con él las instantáneas de DOM que
 *   Livewire retiene con datos descifrados (ADR 0003). Es lo que hace falta al salir, y solo
 *   **después** de que el servidor confirme el cierre (§4.6).
 */

/**
 * Navega sin recargar. Usa el enrutador de Alpine cuando existe; si no, cae a una navegación
 * normal, que es correcta aunque cueste la clave en memoria.
 *
 * @param {string|undefined} url
 */
export function navigate(url) {
    if (typeof url !== 'string' || url === '') {
        return;
    }

    if (typeof window.Alpine?.navigate === 'function') {
        window.Alpine.navigate(url);

        return;
    }

    window.location.assign(url);
}

/**
 * Recarga dura. `location.reload()` puede servirse de la caché de vuelta atrás; una asignación a
 * `href` con la URL de destino no.
 *
 * @param {string} url
 */
export function hardReload(url) {
    window.location.href = url;
}
