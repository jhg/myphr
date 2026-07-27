/**
 * Checks of the authentication modules that need no DOM.
 *
 * Vitest is not installed and adding dependencies needs approval, so this uses Node's built-in
 * runner, like `crypto.test.mjs`.
 *
 *     npm test
 *
 * `lock.js` and `app.js` stay out: they depend on `document`, `window` and `sessionStorage`, which
 * do not exist here, and hand-building a fake DOM for them would test the fake, not the module.
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
 * The `memo` and the `checksum` are Livewire's own metadata: blocking them would break the
 * framework while protecting nothing (§9).
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
 * KSF regression vector (`docs/OPAQUE.md` §20.5): if these numbers change without changing the
 * profile name, everyone's login behaves like a wrong password.
 */
test('the key stretching function stays frozen on the ADR 0004 parameters', () => {
    assert.deepEqual(KEY_STRETCHING, {
        'argon2id-custom': { iterations: 3, memory: 65536, parallelism: 4 },
    });
    assert.ok(Object.isFrozen(KEY_STRETCHING));
});
