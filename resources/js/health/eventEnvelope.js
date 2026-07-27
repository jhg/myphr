/**
 * Seals and opens the envelope of a clinical event (ADR 0006).
 *
 * An event is one single envelope, not one per field: `content` is the whole `{v, type, tz, data}`
 * object in the clear, exactly as it is stored in the `payload` column. What ties that envelope to
 * its row is `user_id` and `occurred_at` (`eventContext` of `auth/context.js`), never the `type`,
 * because the type travels encrypted inside the envelope and cannot take part in its own authentication.
 *
 * The key is not the master one directly: it is a per-record key derived from it with
 * `KDF_LABELS.RECORD` and the same context, and it only lives for the duration of this call, wiped
 * in a `finally` (ADR 0004).
 *
 * **`occurredAt` has to be exactly the same instant the server stores in `occurred_at`.** One
 * microsecond of difference produces a different context and decryption fails; it does not produce
 * a datum attributed to the wrong day (that is precisely the point of ADR 0006). That is why
 * canonicalization lives in a single place (`crypto/canonicalDate.js`, through `eventContext`) and
 * nothing is formatted by hand here: the caller passes the value it received from the server (or
 * is about to send it) as is.
 */

import { eventContext } from '../auth/context.js';
import { withMasterKey } from '../auth/keyring.js';
import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { openText, sealText } from '../crypto/envelope.js';
import { zeroize } from '../crypto/zeroize.js';

/**
 * Seals the envelope of an event.
 *
 * @param {object} params
 * @param {string} params.userId User UUID, exactly as the server returns it.
 * @param {Date|number|string} params.occurredAt Same instant that goes into the `occurred_at` column.
 * @param {object} params.content Event content in the clear: `{v, type, tz, data}`.
 * @returns {string} `v1.` + base64url, ready to store in `payload`.
 * @throws {Error} If there is no master key in memory (`withMasterKey`).
 */
export function sealEvent({ userId, occurredAt, content }) {
    const context = eventContext(userId, occurredAt);
    let recordKey = null;

    try {
        return withMasterKey((masterKey) => {
            recordKey = deriveKey({ ikm: masterKey, label: KDF_LABELS.RECORD, context });

            return sealText({
                key: recordKey,
                plaintext: JSON.stringify(content),
                associatedData: context,
            });
        });
    } finally {
        if (recordKey !== null) {
            zeroize(recordKey);
        }
    }
}

/**
 * Opens the envelope of an event.
 *
 * @param {object} params
 * @param {string} params.userId Same `userId` used to seal it.
 * @param {Date|number|string} params.occurredAt Same instant used to seal it: the one the server
 *        has in `occurred_at` for this row.
 * @param {string} params.envelope Envelope exactly as it comes from `payload`.
 * @returns {object} Content in the clear, already parsed: `{v, type, tz, data}`.
 * @throws {import('../crypto/envelope.js').EnvelopeError} If the envelope does not open. It is not
 *         silenced: a decryption failure is always a visible error (ADR 0004), never an event
 *         left out of the view.
 * @throws {Error} If there is no master key in memory (`withMasterKey`).
 */
export function openEvent({ userId, occurredAt, envelope }) {
    const context = eventContext(userId, occurredAt);
    let recordKey = null;

    try {
        const plaintext = withMasterKey((masterKey) => {
            recordKey = deriveKey({ ikm: masterKey, label: KDF_LABELS.RECORD, context });

            return openText({ key: recordKey, envelope, associatedData: context });
        });

        return JSON.parse(plaintext);
    } finally {
        if (recordKey !== null) {
            zeroize(recordKey);
        }
    }
}
