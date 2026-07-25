/**
 * Comprobaciones de los módulos de autenticación que no necesitan DOM.
 *
 * Vitest no está instalado y añadir dependencias necesita aprobación, así que esto usa el corredor
 * incorporado de Node, igual que `crypto.test.mjs`.
 *
 *     npm test
 *
 * `lock.js` y `app.js` quedan fuera: dependen de `document`, `window` y `sessionStorage`, que no
 * existen aquí, y montarles un DOM falso a mano probaría el falso, no el módulo.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    firstViolation,
    inspectPayload,
    LivewirePayloadGuardError,
    MAX_PLAINTEXT_LENGTH,
} from '../../resources/js/guards/livewirePayloadGuard.js';
import { KEY_STRETCHING_SECONDS, progressMixin } from '../../resources/js/auth/progress.js';
import { ENVELOPE_PREFIX } from '../../resources/js/crypto/envelope.js';
import { KEY_STRETCHING } from '../../resources/js/auth/opaqueClient.js';

const longPlaintext = 'a'.repeat(MAX_PLAINTEXT_LENGTH + 1);
const longEnvelope = ENVELOPE_PREFIX + 'a'.repeat(MAX_PLAINTEXT_LENGTH + 1);

test('the guard lets short values through', () => {
    assert.equal(firstViolation({ note: 'a'.repeat(MAX_PLAINTEXT_LENGTH) }, ''), null);
});

test('the guard lets long values through when they are sealed envelopes', () => {
    assert.equal(firstViolation({ note: longEnvelope }, ''), null);
});

test('the guard reports the path of a long plaintext', () => {
    assert.equal(firstViolation({ form: { note: longPlaintext } }, ''), 'form.note');
    assert.equal(firstViolation({ rows: [{ note: longPlaintext }] }, ''), 'rows[0].note');
});

test('the guard reads the snapshot data whether it arrives parsed or encoded', () => {
    const data = { note: longPlaintext };

    assert.equal(inspectPayload({ snapshot: { data } }), 'snapshot.data.note');
    assert.equal(inspectPayload({ snapshot: JSON.stringify({ data }) }), 'snapshot.data.note');
});

/**
 * El `memo` y el `checksum` son metadatos del propio Livewire: bloquearlos rompería el marco sin
 * proteger nada (§9).
 */
test('the guard ignores Livewire metadata', () => {
    assert.equal(
        inspectPayload({ snapshot: { data: {}, memo: { path: longPlaintext }, checksum: longPlaintext } }),
        null
    );
});

test('the guard inspects updates and call parameters', () => {
    assert.equal(inspectPayload({ updates: { note: longPlaintext } }), 'updates.note');
    assert.equal(
        inspectPayload({ calls: [{ method: 'save', params: [longPlaintext] }] }),
        'calls[0].params[0]'
    );
});

test('the guard error carries the path and never the value', () => {
    const failure = new LivewirePayloadGuardError('snapshot.data.note');

    assert.equal(failure.path, 'snapshot.data.note');
    assert.ok(!failure.message.includes(longPlaintext));
});

test('the progress bar binds a style object so it does not wipe the static styles', () => {
    const bar = progressMixin();

    bar.progress = 0.4;
    bar.progressSeconds = KEY_STRETCHING_SECONDS;

    assert.deepEqual(bar.progressStyle(), {
        transform: 'scaleX(0.4)',
        transition: `transform ${KEY_STRETCHING_SECONDS}s linear`,
    });
});

test('resetting the progress bar removes the transition so it does not animate backwards', () => {
    const bar = progressMixin();

    bar.progress = 0.9;
    bar.progressSeconds = 12;
    bar.stage = 'Entrando…';
    bar.resetProgress();

    assert.deepEqual(bar.progressStyle(), { transform: 'scaleX(0)', transition: 'transform 0s linear' });
    assert.equal(bar.stage, '');
});

/**
 * Vector de regresión del KSF (`docs/OPAQUE.md` §20.5): si estos números cambian sin cambiar el
 * nombre del perfil, el login de todo el mundo se comporta como una contraseña incorrecta.
 */
test('the key stretching function stays frozen on the ADR 0004 parameters', () => {
    assert.deepEqual(KEY_STRETCHING, {
        'argon2id-custom': { iterations: 3, memory: 65536, parallelism: 4 },
    });
    assert.ok(Object.isFrozen(KEY_STRETCHING));
});
