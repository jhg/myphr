/**
 * Web Worker that runs the Argon2id PIN stretching (ADR 0011).
 *
 * **Why a worker at all.** `argon2idAsync` is only async in name. Its yield point
 * (`node_modules/@noble/hashes/utils.js`) awaits an already-resolved promise, which queues a
 * *microtask*, and the browser drains the whole microtask queue before it goes back to the event
 * loop: rendering never gets a turn. Measured here, no macrotask runs during a 1.7 s stretching. So
 * on the main thread the reader's progress bar cannot be painted at all — the person watches a
 * frozen tab for seconds and takes it for a broken page, which is exactly the complaint. Off the
 * main thread the same 1.7 s of work leaves the UI free to paint every frame.
 *
 * **What crosses into this worker, and what never does.** In: the PIN bytes and the 16-byte link
 * salt. Out: the 32 bytes of stretched material. Nothing else. Not `S` (the send key from the URL
 * fragment), not `CK`, not the wrap key, not the master key of any account — those are derived on
 * the main thread from the value returned here (`shareKeys.js`), and the master key never comes
 * near this file at all. The worker is same-origin and loaded from our own bundle, so the PIN
 * crosses no boundary it was not already inside.
 *
 * **Wiping.** The PIN copy this worker receives is zeroed as soon as Argon2id has consumed it, and
 * the result is *transferred* rather than copied, so no second copy of the stretched material is
 * left behind in this heap. The caller terminates the worker right afterwards, which drops the heap
 * altogether.
 *
 * **Progress is throttled here, at the source.** `argon2idAsync` fires its callback about ten
 * thousand times per stretching. Posting ten thousand messages would replace one blocked thread
 * with two busy ones, so only whole-percent changes are sent: a hundred messages, which is more
 * than a 60 Hz bar can show anyway.
 */

import { argon2idAsync } from '@noble/hashes/argon2.js';

import { ARGON2_PARAMS } from './argon2Profile.js';

self.addEventListener('message', async (event) => {
    const { password, salt } = event.data;
    let lastPercent = -1;

    try {
        const stretched = await argon2idAsync(password, salt, {
            ...ARGON2_PARAMS,
            onProgress: (fraction) => {
                const percent = Math.floor(fraction * 100);

                if (percent !== lastPercent) {
                    lastPercent = percent;
                    self.postMessage({ progress: fraction });
                }
            },
        });

        self.postMessage({ stretched }, [stretched.buffer]);
    } catch (failure) {
        /** Only the message travels back: an `Error` with a stack would not be cloneable anyway. */
        self.postMessage({ error: String(failure?.message ?? failure) });
    } finally {
        password.fill(0);
    }
});
