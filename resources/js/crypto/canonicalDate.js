/**
 * Forma canónica de fecha del ADR 0004: `YYYY-MM-DDTHH:MM:SS.ffffffZ`,
 * siempre UTC, sufijo `Z`, **seis dígitos de fracción siempre**.
 *
 * `Date` de JavaScript sólo tiene precisión de milisegundo, así que los tres
 * dígitos que faltan se rellenan con ceros. Cuando la fuente es una cadena con
 * más de tres dígitos de fracción (el servidor guarda `occurred_at` con
 * precisión 6, ADR 0006), se conservan tal cual leyéndolos de la propia cadena
 * en vez de pasar por `Date`, que los perdería.
 *
 * ISO 8601 a secas no basta: admite variantes que son bytes distintos, y estos
 * bytes entran en el dato asociado del AEAD y en la derivación de clave, donde
 * un byte de diferencia es un descifrado fallido.
 */

/**
 * `YYYY-MM-DD` `T` o espacio, `HH:MM:SS`, fracción opcional, y desfase
 * obligatorio (`Z` o `±HH:MM`).
 */
const ISO_LIKE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}:?\d{2})$/;

/** Error de canonicalización, distinguible de los de cripto. */
export class CanonicalDateError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'CanonicalDateError';
    }
}

/**
 * @param {number} value
 * @param {number} width
 * @returns {string}
 */
function pad(value, width) {
    return String(value).padStart(width, '0');
}

/**
 * @param {Date} date Instante válido.
 * @param {string} microseconds Exactamente seis dígitos.
 * @returns {string}
 */
function format(date, microseconds) {
    return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`
        + `T${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}`
        + `.${microseconds}Z`;
}

/**
 * Devuelve la forma canónica de un instante.
 *
 * @param {Date|number|string} value `Date`, epoch en milisegundos, o cadena
 *        ISO 8601 con desfase explícito. Una cadena sin desfase se rechaza:
 *        adivinar la zona local produciría bytes distintos según el dispositivo.
 * @returns {string} `YYYY-MM-DDTHH:MM:SS.ffffffZ`.
 * @throws {CanonicalDateError} Si el valor no es un instante válido o la
 *         cadena no lleva desfase.
 */
export function canonicalDate(value) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new CanonicalDateError('canonicalDate received an invalid Date.');
        }

        return format(value, pad(value.getUTCMilliseconds(), 3) + '000');
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new CanonicalDateError('canonicalDate received a non-finite timestamp.');
        }

        return canonicalDate(new Date(value));
    }

    if (typeof value !== 'string') {
        throw new CanonicalDateError('canonicalDate expects a Date, an epoch in milliseconds or a string.');
    }

    const match = ISO_LIKE.exec(value);

    if (match === null) {
        throw new CanonicalDateError(
            `canonicalDate cannot parse "${value}": expected YYYY-MM-DDTHH:MM:SS[.fff...] with Z or ±HH:MM.`
        );
    }

    const [, year, month, day, hour, minute, second, fraction = '', offset] = match;

    const normalizedOffset = offset.toUpperCase() === 'Z'
        ? 'Z'
        : offset.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');

    assertCalendarComponents(value, Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second));

    const parsed = new Date(
        `${year}-${month}-${day}T${hour}:${minute}:${second}${normalizedOffset === 'Z' ? 'Z' : normalizedOffset}`
    );

    if (Number.isNaN(parsed.getTime())) {
        throw new CanonicalDateError(`canonicalDate cannot parse "${value}": not a valid instant.`);
    }

    // Se trunca a seis dígitos, nunca se redondea: redondear movería el
    // instante y con él el dato asociado.
    const microseconds = fraction.slice(0, 6).padEnd(6, '0');

    return format(parsed, microseconds);
}

/**
 * Rechaza componentes de calendario imposibles. `Date` los desborda en
 * silencio (`2026-02-30` se convierte en `2026-03-02`), y aceptar ese
 * desbordamiento significaría que dos cadenas distintas producen la misma
 * forma canónica y por tanto la misma clave.
 *
 * @param {string} value
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @param {number} second
 * @returns {void}
 */
function assertCalendarComponents(value, year, month, day, hour, minute, second) {
    const daysInMonth = [
        31,
        (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28,
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];

    const valid = month >= 1 && month <= 12
        && day >= 1 && day <= daysInMonth[month - 1]
        && hour <= 23 && minute <= 59 && second <= 59;

    if (!valid) {
        throw new CanonicalDateError(`canonicalDate cannot parse "${value}": impossible calendar components.`);
    }
}

/**
 * Misma forma canónica, en bytes UTF-8, que es como entra en el dato asociado
 * del AEAD y en el `info` de la derivación.
 *
 * @param {Date|number|string} value
 * @returns {Uint8Array}
 */
export function canonicalDateBytes(value) {
    return new TextEncoder().encode(canonicalDate(value));
}
