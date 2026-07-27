/**
 * Checks of the Argon2id worker (ADR 0011).
 *
 * The reason this worker exists is measurable and was measured: `argon2idAsync` yields with a
 * microtask, which the browser drains before painting, so on the main thread not a single frame is
 * rendered during the 1.5 s of stretching — the progress bar cannot move and the tab looks hung.
 * Moving the work here is what lets the bar be honest.
 *
 * The two things that must hold, and that this file checks:
 *
 * 1. **The bytes are the same.** A worker that derived anything different would lock every existing
 *    share link out, with no error saying why.
 * 2. **The progress is throttled at the source.** Argon2id fires its callback about ten thousand
 *    times; posting that many messages would trade one busy thread for two.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

import { ARGON2_PARAMS, stretchPin } from '../../resources/js/crypto/shareKeys.js';

const HOST = new URL('./support/argon2WorkerHost.mjs', import.meta.url);

/**
 * One stretching through the worker, collecting every message it sends.
 *
 * @param {string} pin
 * @param {Uint8Array} salt
 * @returns {Promise<{stretched: Uint8Array, progress: number[]}>}
 */
function stretchThroughWorker(pin, salt) {
    const worker = new Worker(HOST);
    const progress = [];

    return new Promise((resolve, reject) => {
        worker.on('message', (message) => {
            if (message.progress !== undefined) {
                progress.push(message.progress);

                return;
            }

            void worker.terminate();

            if (message.stretched !== undefined) {
                resolve({ stretched: new Uint8Array(message.stretched), progress });
            } else {
                reject(new Error(message.error));
            }
        });

        worker.on('error', reject);
        worker.postMessage({ password: new TextEncoder().encode(pin), salt });
    });
}

test('the worker derives exactly the same bytes as the in-thread stretching', async () => {
    const salt = new Uint8Array(16).fill(7);
    const { stretched } = await stretchThroughWorker('123456', salt);

    assert.equal(stretched.length, ARGON2_PARAMS.dkLen);
    assert.deepEqual(stretched, stretchPin({ pin: '123456', pinSalt: salt }));
}, { timeout: 120_000 });

/**
 * Ten thousand callbacks become a hundred messages at most: one per whole percent. Fewer than two
 * would mean the bar has nothing to show and we are back to a frozen-looking screen.
 */
test('progress arrives throttled to one message per whole percent, and it grows', async () => {
    const { progress } = await stretchThroughWorker('654321', new Uint8Array(16).fill(3));

    assert.ok(progress.length > 1, 'the worker reported no progress at all');
    assert.ok(progress.length <= 101, `too many progress messages: ${progress.length}`);
    assert.ok(progress[progress.length - 1] > progress[0]);
}, { timeout: 120_000 });
