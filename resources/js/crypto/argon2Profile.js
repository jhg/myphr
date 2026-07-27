/**
 * The one Argon2id cost profile of the project.
 *
 * It lives in a module of its own, with **no other import**, for one reason: the Web Worker that
 * runs the stretching (`argon2Worker.js`) has to read these numbers without dragging in the whole
 * key-derivation graph of `shareKeys.js`. A worker that imported `shareKeys.js` would ship the
 * envelope code, the catalog dates and the HKDF labels into a bundle whose only job is to hash a
 * PIN.
 *
 * The numbers themselves are the ones named by the OPAQUE deployment profile
 * `OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1` (`docs/OPAQUE.md` §2, ADR 0004 and ADR 0011).
 * **They are frozen.** Lowering them is not a performance option: every existing account and every
 * live share link is tied to this profile, so a smaller `m` or `t` turns every correct password and
 * every correct PIN into a silent failure, with no error saying why. Whatever is made faster around
 * here is made faster by moving this work elsewhere, never by doing less of it.
 */

/** Argon2id v0x13, m=64 MiB, t=3, p=4, 32-byte output. Frozen: see the module comment. */
export const ARGON2_PARAMS = Object.freeze({ version: 0x13, m: 65536, t: 3, p: 4, dkLen: 32 });
