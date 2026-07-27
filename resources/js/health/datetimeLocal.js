/**
 * Conversión del `<input type="datetime-local">` de las pantallas de evento a la fecha canónica del
 * ADR 0004 y al desfase del campo `tz` del ADR 0006.
 *
 * **Estas dos funciones viven juntas y en un solo sitio porque su resultado no es texto de
 * pantalla: es dato asociado del AEAD.** `occurredAt` entra en los datos autenticados del sobre con
 * el que se cifra cada evento (ADR 0004 y ADR 0006), así que un microsegundo de diferencia, un
 * redondeo distinto o un `tz` con otro convenio de signo no producen un error visible al guardar:
 * producen un sobre que ya no se puede abrir nunca más. Y lo produce solo en la pantalla que se
 * desvió, con lo que el fallo aparece meses después y en una parte del historial, no en todas.
 *
 * Esta lógica estuvo copiada carácter a carácter en las seis pantallas de evento (glucemia,
 * tensión, insulina, temperatura, peso y comidas). Copiarla funcionaba mientras las seis copias
 * fueran idénticas; el problema es que nada obligaba a que lo siguieran siendo, y arreglar un caso
 * límite de horario de verano en una sola de ellas basta para que los eventos de esa pantalla
 * queden cifrados con una fecha que las otras no reproducen. **Si alguien vuelve a pegar estas
 * funciones dentro de una pantalla, lo que se rompe no es el estilo: es la posibilidad de descifrar
 * el historial.** Cualquier pantalla de evento nueva importa de aquí.
 *
 * `formatTzOffset` acompaña a `datetimeLocalToCanonical` en vez de irse a un módulo de formato
 * porque comparte con ella el convenio de signo del ADR 0006, que es justo lo fácil de invertir al
 * reescribirlo: separarlas invitaría a redefinirlo dos veces.
 */

import { canonicalDate } from '../crypto/canonicalDate.js';
import { t } from '../i18n/index.js';

/**
 * Patrón de un `<input type="datetime-local" step="1">`: sin desfase, porque es hora local del
 * dispositivo (`YYYY-MM-DDTHH:MM` o `YYYY-MM-DDTHH:MM:SS`).
 */
const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Descompone el valor de un `datetime-local` en sus campos de calendario, sin interpretarlo todavía
 * en ninguna zona horaria.
 *
 * No se exporta: fuera de este módulo nadie tiene por qué manipular la fecha a medio convertir, y
 * exponerla sería ofrecer la mitad del camino a quien luego termine la otra mitad a su manera.
 *
 * @param {string} value
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number}}
 * @throws {Error} Si el valor no tiene la forma esperada.
 */
function parseDatetimeLocalFields(value) {
    const match = DATETIME_LOCAL_PATTERN.exec(value);

    if (match === null) {
        throw new Error(t('common.badDatetime', { value }));
    }

    const [, year, month, day, hour, minute, second = '00'] = match;

    return {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
    };
}

/**
 * Da forma `±HH:MM` a un desfase, con el mismo convenio de signo que el campo `tz` del ADR 0006
 * (positivo cuando la hora local va por delante de UTC).
 *
 * @param {number} offsetMinutes Local menos UTC, en minutos.
 * @returns {string}
 */
export function formatTzOffset(offsetMinutes) {
    const sign = offsetMinutes < 0 ? '-' : '+';
    const absolute = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
    const minutes = String(absolute % 60).padStart(2, '0');

    return `${sign}${hours}:${minutes}`;
}

/**
 * Convierte un `datetime-local` (hora local sin desfase) al instante correcto y a su forma canónica
 * (ADR 0004), junto con el desfase para el campo `tz` del ADR 0006.
 *
 * `Date.prototype.getTimezoneOffset()` da el desfase del dispositivo en vigor **para ese calendario
 * concreto**, así que el horario de verano de la fecha registrada se respeta y no el de hoy.
 *
 * @param {string} value Valor crudo del `<input type="datetime-local">`.
 * @param {object} [options]
 * @param {number} [options.timezoneOffsetMinutes] Desfase a usar en vez del de `Date` (convenio de
 *        `getTimezoneOffset`: UTC menos local), solo para poder probar esta función sin depender de
 *        la zona horaria de quien ejecuta los tests.
 * @returns {{occurredAt: string, tz: string}}
 */
export function datetimeLocalToCanonical(value, { timezoneOffsetMinutes } = {}) {
    const fields = parseDatetimeLocalFields(value);

    const offsetMinutes = timezoneOffsetMinutes
        ?? new Date(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second)
            .getTimezoneOffset();

    const utcMilliseconds = Date.UTC(
        fields.year,
        fields.month - 1,
        fields.day,
        fields.hour,
        fields.minute,
        fields.second
    ) + offsetMinutes * 60_000;

    return {
        occurredAt: canonicalDate(new Date(utcMilliseconds)),
        tz: formatTzOffset(-offsetMinutes),
    };
}
