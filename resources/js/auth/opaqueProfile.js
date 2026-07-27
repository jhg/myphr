/**
 * The frozen KSF configuration of the OPAQUE deployment, in a module that imports nothing.
 *
 * It is split out of `opaqueClient.js` so that reading these numbers costs nothing: whoever only
 * needs to know the cost profile —a test, a check— does not pull in `@serenity-kit/opaque` and its
 * 310 KB of WebAssembly along with it.
 *
 * Argon2id v0x13, m=64 MiB, t=3, p=4: the parameters named by the
 * `OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1` profile (`docs/OPAQUE.md` §2).
 *
 * **Frozen on purpose, and not a performance knob.** If these numbers change without changing the
 * profile name, every existing account behaves like a wrong password, with no hint that the problem
 * is configuration (§7): the envelopes are tied to this profile. They are also the only real brake
 * on guessing a password from a stolen database. Speed is found elsewhere — in where this work
 * runs, in how many round trips there are, and in what the person is shown while it happens.
 */

/** @type {{'argon2id-custom': {iterations: number, memory: number, parallelism: number}}} */
export const KEY_STRETCHING = Object.freeze({
    'argon2id-custom': Object.freeze({ iterations: 3, memory: 65536, parallelism: 4 }),
});
