/**
 * Best-effort wiping of byte buffers.
 *
 * **Not a guarantee.** JavaScript offers no way to make sure a value leaves
 * process memory: the garbage collector may already have copied the buffer,
 * strings are immutable (a password cannot be wiped), and the OPAQUE
 * WebAssembly keeps its own copies for as long as the tab lives. This only
 * shortens the window in which our own bytes stay readable on the heap
 * (ADR 0004, "Memory wiping only applies to our own byte buffers, and even
 * there it is at most an attempt").
 */

/**
 * Fills the given `Uint8Array`s with zeros, ignoring `null`/`undefined`.
 *
 * @param {...(Uint8Array|null|undefined)} buffers
 * @returns {void}
 */
export function zeroize(...buffers) {
    for (const buffer of buffers) {
        if (buffer === null || buffer === undefined) {
            continue;
        }

        if (!(buffer instanceof Uint8Array)) {
            throw new TypeError('zeroize expects Uint8Array values.');
        }

        buffer.fill(0);
    }
}

/**
 * Runs `work` and wipes the given buffers no matter what.
 *
 * @template T
 * @param {Uint8Array[]} buffers Buffers to wipe when the work is done.
 * @param {() => T} work
 * @returns {T}
 */
export function withZeroized(buffers, work) {
    try {
        return work();
    } finally {
        zeroize(...buffers);
    }
}
