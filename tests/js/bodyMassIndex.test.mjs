/**
 * Comprobaciones de `health/bodyMassIndex.js` (ADR 0004, ADR 0005, ADR 0006).
 *
 * Lo que se prueba aquí no es aritmética por gusto: es la cifra que la pantalla de peso y el perfil
 * enseñan al lado de un dato clínico. Los tres casos que importan son el IMC con las dos parejas de
 * unidades, la ausencia de estatura —que tiene que dar «no hay IMC» y nunca un cero— y la elección
 * de la última estatura conocida cuando el registro no la trae.
 *
 * Corredor incorporado de Node, como el resto de `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    bodyMassIndex,
    heightInMeters,
    heightKnownAt,
    measurementUnitLabel,
    weightInKilograms,
} from '../../resources/js/health/bodyMassIndex.js';

/**
 * Un evento de peso descifrado, con la forma del ADR 0006. El valor viaja como cadena.
 *
 * @param {string} occurredAt
 * @param {string} value
 * @param {{value: string, unit: string}|null} [height]
 * @returns {{occurredAt: string, content: object}}
 */
function weightEvent(occurredAt, value, height = null) {
    const data = { value, unit: 'kg', loinc: '3141-9' };

    if (height !== null) {
        data.height = { ...height, loinc: '8302-2' };
    }

    return { occurredAt, content: { v: 1, type: 'bodyWeight', data } };
}

test('bodyMassIndex: kilogramos y centímetros', () => {
    /** 70 / 1,75² = 22,857… → 22,9 con un decimal. */
    assert.equal(
        bodyMassIndex({ weight: { value: '70', unit: 'kg' }, height: { value: '175', unit: 'cm' } }),
        22.9,
    );
});

test('bodyMassIndex: libras y pulgadas dan la misma cifra que su equivalente métrico', () => {
    /**
     * 154,324 lb y 68,898 in son 70 kg y 175 cm. Que las dos parejas de unidades caigan en la misma
     * cifra es lo que prueba que la conversión usa los factores exactos y no un redondeo casero.
     */
    const metric = bodyMassIndex({ weight: { value: '70', unit: 'kg' }, height: { value: '175', unit: 'cm' } });
    const imperial = bodyMassIndex({
        weight: { value: '154.32', unit: '[lb_av]' },
        height: { value: '68.9', unit: '[in_i]' },
    });

    assert.equal(imperial, metric);
});

test('bodyMassIndex: sin estatura registrada no hay IMC, y no es cero', () => {
    for (const height of [null, undefined]) {
        const bmi = bodyMassIndex({ weight: { value: '70', unit: 'kg' }, height });

        assert.equal(bmi, null);
        assert.notEqual(bmi, 0);
    }
});

test('bodyMassIndex: sin peso tampoco hay IMC', () => {
    assert.equal(bodyMassIndex({ weight: null, height: { value: '175', unit: 'cm' } }), null);
});

test('bodyMassIndex: un valor inutilizable da null en vez de NaN o Infinity', () => {
    const cases = [
        { weight: { value: '0', unit: 'kg' }, height: { value: '175', unit: 'cm' } },
        { weight: { value: '70', unit: 'kg' }, height: { value: '0', unit: 'cm' } },
        { weight: { value: 'setenta', unit: 'kg' }, height: { value: '175', unit: 'cm' } },
        { weight: { value: '70', unit: 'st' }, height: { value: '175', unit: 'cm' } },
        { weight: { value: '70', unit: 'kg' }, height: { value: '175', unit: 'in' } },
    ];

    for (const params of cases) {
        assert.equal(bodyMassIndex(params), null, JSON.stringify(params));
    }
});

test('las conversiones usan los factores exactos', () => {
    assert.equal(weightInKilograms('1', '[lb_av]'), 0.45359237);
    assert.equal(heightInMeters('1', '[in_i]'), 0.0254);
    assert.equal(heightInMeters('180', 'cm'), 1.8);
    assert.equal(weightInKilograms('70', 'kg'), 70);
});

test('heightKnownAt: toma la última estatura que no sea posterior al registro', () => {
    const events = [
        weightEvent('2026-01-10T08:00:00.000000Z', '70', { value: '170', unit: 'cm' }),
        weightEvent('2026-03-10T08:00:00.000000Z', '71'),
        weightEvent('2026-05-10T08:00:00.000000Z', '72', { value: '174', unit: 'cm' }),
    ];

    const known = heightKnownAt(events, '2026-04-01T08:00:00.000000Z');

    /** La de enero, no la de mayo: quien crece no medía en abril lo que mide en mayo. */
    assert.equal(known.value, '170');
    assert.equal(known.occurredAt, '2026-01-10T08:00:00.000000Z');
});

test('heightKnownAt: el mismo instante cuenta, que es el caso de peso y estatura en un solo registro', () => {
    const events = [weightEvent('2026-01-10T08:00:00.000000Z', '70', { value: '170', unit: 'cm' })];

    assert.equal(heightKnownAt(events, '2026-01-10T08:00:00.000000Z').value, '170');
});

test('heightKnownAt: sin ninguna estatura anterior devuelve null', () => {
    const events = [weightEvent('2026-05-10T08:00:00.000000Z', '72', { value: '174', unit: 'cm' })];

    assert.equal(heightKnownAt(events, '2026-01-01T08:00:00.000000Z'), null);
    assert.equal(heightKnownAt([weightEvent('2026-01-01T08:00:00.000000Z', '70')], '2026-06-01T08:00:00.000000Z'), null);
});

test('el IMC de un registro sin estatura sale de la última conocida', () => {
    const events = [
        weightEvent('2026-01-10T08:00:00.000000Z', '68', { value: '175', unit: 'cm' }),
        weightEvent('2026-02-10T08:00:00.000000Z', '70'),
    ];

    const weighing = events[1];
    const height = heightKnownAt(events, weighing.occurredAt);

    assert.equal(
        bodyMassIndex({ weight: { value: weighing.content.data.value, unit: 'kg' }, height }),
        22.9,
    );
});

/** Es lo que pide el perfil: `null` como cota, o sea la estatura más reciente de todas. */
test('heightKnownAt con cota null: la más reciente de todas', () => {
    const events = [
        weightEvent('2026-01-10T08:00:00.000000Z', '70', { value: '170', unit: 'cm' }),
        weightEvent('2026-05-10T08:00:00.000000Z', '72', { value: '174', unit: 'cm' }),
        weightEvent('2026-06-10T08:00:00.000000Z', '72'),
    ];

    assert.equal(heightKnownAt(events, null).value, '174');
    assert.equal(heightKnownAt([weightEvent('2026-06-10T08:00:00.000000Z', '72')], null), null);
});

test('measurementUnitLabel: el código UCUM se guarda, la etiqueta se enseña', () => {
    assert.equal(measurementUnitLabel('[lb_av]'), 'lb');
    assert.equal(measurementUnitLabel('[in_i]'), 'in');
    assert.equal(measurementUnitLabel('cm'), 'cm');
    /** Un código desconocido se devuelve tal cual: feo, pero nunca esconde el dato. */
    assert.equal(measurementUnitLabel('furlong'), 'furlong');
});
