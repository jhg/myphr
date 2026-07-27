/**
 * Runs `resources/js/crypto/argon2Worker.js` inside a Node worker thread.
 *
 * The worker file is written against the browser's Web Worker interface —`self.addEventListener`
 * and `self.postMessage`— which Node does not provide. This host supplies exactly those two, wired
 * to `parentPort`, and then imports the real file: no copy of the worker's logic lives here, so a
 * change to the protocol breaks the test instead of quietly diverging from it.
 *
 * What this proves is the part that can be proved without a browser: the message protocol, the
 * throttling of progress, and that Argon2id gives the same bytes off the main thread as on it. What
 * it cannot prove is that this browser supports module workers — that is what the fallback in
 * `stretchPinAsync` is for.
 */

import { parentPort } from 'node:worker_threads';

globalThis.self = {
    /** @param {string} type @param {(event: {data: unknown}) => void} handler */
    addEventListener(type, handler) {
        if (type === 'message') {
            parentPort.on('message', (data) => handler({ data }));
        }
    },

    /** Transfers are ignored: `structuredClone` semantics are not what is under test here. */
    postMessage(message) {
        parentPort.postMessage(message);
    },
};

await import('../../../resources/js/crypto/argon2Worker.js');
