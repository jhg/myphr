/**
 * Checks of `health/eventCommonFields.js` (ADR 0006, "Fields captured even if unused
 * today").
 *
 * Node's built-in runner, like the rest of `tests/js` (see `crypto.test.mjs`).
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

test('buildCommonEventFields: leaves out device and note when empty, it does not store them as an empty string', () => {
    const fields = buildCommonEventFields({ origin: 'manual', device: '', recordedBy: 'self', note: '   ' });

    assert.deepEqual(fields, { origin: 'manual', recordedBy: 'self' });
    assert.equal('device' in fields, false);
    assert.equal('note' in fields, false);
});

test('buildCommonEventFields: includes trimmed device and note when they have a value', () => {
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

test('buildCommonEventFields: with no arguments, it falls back to sensible defaults', () => {
    const fields = buildCommonEventFields();

    assert.deepEqual(fields, { origin: DEFAULT_ORIGIN, recordedBy: DEFAULT_RECORDED_BY });
});

test('buildCommonEventFields: empty origin and recordedBy also fall back to the default', () => {
    const fields = buildCommonEventFields({ origin: '', device: '', recordedBy: '', note: '' });

    assert.deepEqual(fields, { origin: DEFAULT_ORIGIN, recordedBy: DEFAULT_RECORDED_BY });
});
