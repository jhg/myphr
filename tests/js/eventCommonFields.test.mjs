/**
 * Comprobaciones de `health/eventCommonFields.js` (ADR 0006, "Campos que se capturan aunque hoy no
 * se usen").
 *
 * Corredor incorporado de Node, como el resto de `tests/js` (ver `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildCommonEventFields,
    DEFAULT_ORIGIN,
    DEFAULT_RECORDED_BY,
} from '../../resources/js/health/eventCommonFields.js';

test('buildCommonEventFields: omite device y note cuando están vacíos, no los guarda como cadena vacía', () => {
    const fields = buildCommonEventFields({ origin: 'manual', device: '', recordedBy: 'self', note: '   ' });

    assert.deepEqual(fields, { origin: 'manual', recordedBy: 'self' });
    assert.equal('device' in fields, false);
    assert.equal('note' in fields, false);
});

test('buildCommonEventFields: incluye device y note recortados cuando tienen valor', () => {
    const fields = buildCommonEventFields({
        origin: 'device',
        device: '  Freestyle Libre 3  ',
        recordedBy: 'caregiver',
        note: '  Se registró tarde  ',
    });

    assert.deepEqual(fields, {
        origin: 'device',
        recordedBy: 'caregiver',
        device: 'Freestyle Libre 3',
        note: 'Se registró tarde',
    });
});

test('buildCommonEventFields: sin argumentos, cae en los valores por defecto razonables', () => {
    const fields = buildCommonEventFields();

    assert.deepEqual(fields, { origin: DEFAULT_ORIGIN, recordedBy: DEFAULT_RECORDED_BY });
});

test('buildCommonEventFields: origin y recordedBy vacíos también caen en el valor por defecto', () => {
    const fields = buildCommonEventFields({ origin: '', device: '', recordedBy: '', note: '' });

    assert.deepEqual(fields, { origin: DEFAULT_ORIGIN, recordedBy: DEFAULT_RECORDED_BY });
});
