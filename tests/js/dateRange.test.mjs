/**
 * Comprobaciones de `health/dateRange.js`: los atajos del historial y el rango a medida.
 *
 * No se monta Alpine: `dateRangeControl()` solo mezcla estado en el componente de cada pantalla, y
 * lo que aquí importa es la lógica pura que decide qué dos fechas se le piden al servidor. El
 * desfase horario se pasa siempre explícito (`timezoneOffsetMinutes`) para que el resultado no
 * dependa de la zona de quien ejecute los tests.
 *
 * Corredor incorporado de Node, como el resto de `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    customRange,
    DateRangeError,
    dateRangeControl,
    DEFAULT_RANGE_PRESET,
    localDayStartToCanonical,
    presetRange,
    RANGE_PRESETS,
    resolveRange,
} from '../../resources/js/health/dateRange.js';
import { WINDOW_DAYS } from '../../resources/js/health/statistics.js';
import { setLocale } from '../../resources/js/i18n/index.js';

setLocale('es');

/** UTC, para que las medianoches locales y las UTC coincidan y el cálculo se lea a simple vista. */
const UTC = { timezoneOffsetMinutes: 0 };

/** Madrid en marzo: UTC+1, que `getTimezoneOffset()` expresa como -60. */
const MADRID_WINTER = { timezoneOffsetMinutes: -60 };

const REFERENCE = new Date('2026-03-20T10:30:00.000Z');

// --- Atajos relativos ---------------------------------------------------------------------------

/**
 * El defecto era `all` para que estrenar el filtro no escondiera registros. Ahora acota a las
 * últimas 24 horas: sin acotar, abrir el historial descarga y descifra todo en el navegador de
 * quien mira, y eso solo empeora con los años. La objeción de entonces sigue viva y se paga en la
 * interfaz —aviso de periodo y botón de «ver todos los registros», ver
 * `tests/Feature/HealthEventRangeTest.php`—, no bajando la ambición del defecto.
 */
test('el atajo por defecto acota a las últimas 24 horas, para no descifrar años de oficio', () => {
    assert.equal(DEFAULT_RANGE_PRESET, 'day');

    assert.deepEqual(presetRange(DEFAULT_RANGE_PRESET, REFERENCE), {
        from: '2026-03-19T10:30:00.000000Z',
        to: null,
    });

    /** `all` sigue existiendo, y sigue siendo el rango sin puntas. */
    assert.deepEqual(presetRange('all', REFERENCE), { from: null, to: null });
});

test('«última semana» cuenta los mismos días que el panel de inicio', () => {
    assert.equal(WINDOW_DAYS.week, 7);

    assert.deepEqual(presetRange('week', REFERENCE), {
        from: '2026-03-13T10:30:00.000000Z',
        to: null,
    });
});

test('«último mes» cuenta los mismos días que el panel de inicio', () => {
    assert.equal(WINDOW_DAYS.month, 30);

    assert.deepEqual(presetRange('month', REFERENCE), {
        from: '2026-02-18T10:30:00.000000Z',
        to: null,
    });
});

/**
 * La punta superior de los atajos relativos queda abierta a propósito: un registro con fecha unos
 * minutos por delante del reloj desaparecería del historial justo después de guardarlo.
 */
test('los atajos relativos no ponen techo, para que un registro adelantado no se esconda', () => {
    for (const preset of ['day', 'week', 'month']) {
        assert.equal(presetRange(preset, REFERENCE).to, null);
    }
});

test('un atajo desconocido falla en vez de devolver un rango inventado', () => {
    assert.throws(() => presetRange('trimestre', REFERENCE), DateRangeError);
});

test('los tokens de los atajos son los que ofrece el desplegable', () => {
    assert.deepEqual([...RANGE_PRESETS], ['all', 'day', 'week', 'month', 'custom']);
});

/** El periodo por defecto de todas las pantallas: 24 horas hacia atrás, como los demás atajos. */
test('«último día» son las últimas 24 horas, no el día natural', () => {
    assert.equal(WINDOW_DAYS.day, 1);

    assert.deepEqual(presetRange('day', REFERENCE), {
        from: '2026-03-19T10:30:00.000000Z',
        to: null,
    });
});

// --- Rango a medida -----------------------------------------------------------------------------

test('el rango a medida abarca los dos días completos, con el fin excluido', () => {
    /**
     * Del 3 al 10 incluidos: la punta superior es la medianoche del 11, no un `23:59:59.999999`.
     * Así el rango semiabierto `[from, to)` del servidor no deja fuera un registro de la última
     * fracción de segundo del día 10.
     */
    assert.deepEqual(customRange('2026-03-03', '2026-03-10', UTC), {
        from: '2026-03-03T00:00:00.000000Z',
        to: '2026-03-11T00:00:00.000000Z',
    });
});

test('un solo día de rango sigue siendo un tramo de 24 horas', () => {
    assert.deepEqual(customRange('2026-03-03', '2026-03-03', UTC), {
        from: '2026-03-03T00:00:00.000000Z',
        to: '2026-03-04T00:00:00.000000Z',
    });
});

/**
 * La persona elige un día de su calendario, no un instante en UTC: acotar por medianoche UTC le
 * movería el corte una hora y le colaría —o le escondería— los registros del borde.
 */
test('las puntas son medianoches locales, convertidas al instante UTC que les toca', () => {
    assert.deepEqual(customRange('2026-03-03', '2026-03-03', MADRID_WINTER), {
        from: '2026-03-02T23:00:00.000000Z',
        to: '2026-03-03T23:00:00.000000Z',
    });
});

test('el fin de mes y el de año pasan al día siguiente de verdad', () => {
    assert.equal(customRange('2026-01-31', '2026-01-31', UTC).to, '2026-02-01T00:00:00.000000Z');
    assert.equal(customRange('2026-12-31', '2026-12-31', UTC).to, '2027-01-01T00:00:00.000000Z');
    assert.equal(customRange('2028-02-28', '2028-02-28', UTC).to, '2028-02-29T00:00:00.000000Z');
});

test('un rango del revés se rechaza en vez de devolver la lista vacía sin explicación', () => {
    assert.throws(() => customRange('2026-03-10', '2026-03-03', UTC), DateRangeError);
});

test('con una sola fecha no se adivina la otra', () => {
    assert.throws(() => customRange('2026-03-10', '', UTC), DateRangeError);
    assert.throws(() => customRange('', '2026-03-10', UTC), DateRangeError);
    assert.throws(() => customRange(undefined, undefined, UTC), DateRangeError);
});

test('un día imposible se rechaza en vez de normalizarse al mes siguiente', () => {
    assert.throws(() => localDayStartToCanonical('2026-13-01', UTC), DateRangeError);
    assert.throws(() => localDayStartToCanonical('2026-02-32', UTC), DateRangeError);
    assert.throws(() => localDayStartToCanonical('03/03/2026', UTC), DateRangeError);
});

test('la forma canónica del ADR 0004 sale con sus seis dígitos de fracción y su Z', () => {
    assert.match(localDayStartToCanonical('2026-03-03', UTC), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
});

// --- Resolución del control ---------------------------------------------------------------------

test('resolveRange lee las dos fechas solo con el atajo a medida', () => {
    const withDays = { fromDay: '2026-03-03', toDay: '2026-03-10', referenceInstant: REFERENCE, ...UTC };

    assert.deepEqual(resolveRange({ preset: 'custom', ...withDays }), {
        from: '2026-03-03T00:00:00.000000Z',
        to: '2026-03-11T00:00:00.000000Z',
    });

    /** Con un atajo relativo, lo tecleado en los dos campos se ignora: manda el atajo. */
    assert.deepEqual(resolveRange({ preset: 'all', ...withDays }), { from: null, to: null });
    assert.equal(resolveRange({ preset: 'week', ...withDays }).from, '2026-03-13T10:30:00.000000Z');
});

// --- Estado del control -------------------------------------------------------------------------

test('el control arranca acotado al periodo por defecto y sin error', () => {
    const control = dateRangeControl();

    assert.equal(control.rangePreset, DEFAULT_RANGE_PRESET);
    assert.equal(control.rangeFromDay, '');
    assert.equal(control.rangeToDay, '');
    assert.equal(control.rangeError, '');

    /** Acotado de verdad: hay punta inferior, y la superior sigue abierta. */
    const range = control.historyRange();

    assert.notEqual(range.from, null);
    assert.equal(range.to, null);
});

/**
 * La pantalla de compartir arranca en «último mes» porque allí el rango es lo que se va a compartir,
 * no una comodidad de lectura: son dos decisiones distintas sobre el mismo control, y el parámetro
 * es lo que evita escribir un segundo.
 */
test('la pantalla puede elegir con qué atajo arranca el control', () => {
    assert.equal(dateRangeControl({ preset: 'month' }).rangePreset, 'month');
    assert.equal(dateRangeControl({ preset: 'all' }).rangePreset, 'all');
    assert.equal(dateRangeControl().rangePreset, DEFAULT_RANGE_PRESET);
});

/**
 * La salida del recorte puesto de oficio. Como el historial ya no arranca en `all`, quitar el
 * filtro tiene que costar un gesto: el botón del aviso de periodo llama aquí, y esto deja el rango
 * abierto, limpia las fechas a medida y recarga sin más intervención.
 */
test('«ver todos los registros» quita el recorte de un gesto y recarga el historial', () => {
    let reloads = 0;

    const page = {
        ...dateRangeControl(),
        loadHistory() {
            reloads += 1;
        },
    };

    page.rangePreset = 'custom';
    page.rangeFromDay = '2026-03-03';
    page.rangeToDay = '2026-03-10';

    page.showAllRecords();

    assert.equal(page.rangePreset, 'all');
    assert.deepEqual(page.historyRange(), { from: null, to: null });
    assert.equal(page.rangeFromDay, '', 'dos fechas escritas parecerían seguir aplicándose');
    assert.equal(page.rangeToDay, '');
    assert.equal(reloads, 1);
});

test('un rango mal tecleado deja el historial entero y explica por qué', () => {
    const control = dateRangeControl();

    control.rangePreset = 'custom';
    control.rangeFromDay = '2026-03-10';

    /** Sin fecha de fin: se enseña todo con un aviso, no una pantalla en blanco. */
    assert.deepEqual(control.historyRange(), { from: null, to: null });
    assert.notEqual(control.rangeError, '');

    control.rangeToDay = '2026-03-12';
    const range = control.historyRange();

    assert.equal(control.rangeError, '', 'el aviso tiene que irse en cuanto el rango vale');
    assert.notEqual(range.from, null);
    assert.notEqual(range.to, null);
});

test('aplicar el rango recarga el historial de la pantalla que lo mezcla', () => {
    let reloads = 0;

    const page = {
        ...dateRangeControl(),
        loadHistory() {
            reloads += 1;
        },
    };

    page.applyRange();

    assert.equal(reloads, 1);
});
