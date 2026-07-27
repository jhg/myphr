/**
 * Seals and opens the **descriptor** of a shared clipping (ADR 0011).
 *
 * The descriptor is the private half of a clipping: the content key `CK`, the exact range, the
 * included and excluded types, the event count and the two dates. It goes in the
 * `shares.descriptor` column as a plain ADR 0004 `v1.` envelope under the master key, and it is
 * what lets the active shares screen say "glucose, from 1 to 30 June" without the server ever
 * having known it. Storing `types` or `range_from` in columns would hand the server back exactly
 * the metadata ADR 0006 removed from the schema.
 *
 * **Why the label is `RECORD` and not a new one.** ADR 0011 adds exactly three labels to
 * `KDF_LABELS` —`SHARE`, `SHARE_LINK` and `SHARE_PIN_TAG`—, and none is this one: of the
 * descriptor it says that it is "a normal ADR 0004 envelope under the master key", that is, an
 * encrypted user row like any other. `RECORD` is precisely "UMK -> per-record key, with the record
 * context appended", and the domain separation comes from the context, which is
 * `<user>/share/<id>` against the `<user>/event/<date>` of a clinical event: two contexts that
 * cannot coincide, so two keys that cannot coincide. Inventing a fourth label the ADR does not
 * mention would be deciding on my own something already decided.
 *
 * The derived key lives only for the duration of the call and is wiped in a `finally`, as in
 * `eventEnvelope.js` (ADR 0004).
 *
 * A descriptor that does not open is **not silenced** and is not painted as an empty clipping: the
 * screen shows it as an error row (ADR 0004). A clipping whose descriptor does not open still
 * exists on the server and is still readable by whoever has the link and the PIN, so hiding it
 * from the list would be hiding something that is still shared.
 */

import { shareDescriptorContext } from '../auth/context.js';
import { withMasterKey } from '../auth/keyring.js';
import { openText, sealText } from '../crypto/envelope.js';
import { deriveKey, KDF_LABELS } from '../crypto/kdf.js';
import { zeroize } from '../crypto/zeroize.js';

/**
 * Derives the descriptor key and runs `use` with it.
 *
 * It exists so that sealing and opening share **one single** construction of context and
 * derivation, like `withSettingsKey` in `auth/settings.js`: duplicating them and letting them
 * diverge by one byte leaves the descriptor unopenable forever, and `CK` with it.
 *
 * @template T
 * @param {string} userId
 * @param {string} shareId
 * @param {(key: Uint8Array, context: string) => T} use
 * @returns {T}
 */
function withDescriptorKey(userId, shareId, use) {
    const context = shareDescriptorContext(userId, shareId);

    return withMasterKey((masterKey) => {
        const descriptorKey = deriveKey({ ikm: masterKey, label: KDF_LABELS.RECORD, context });

        try {
            return use(descriptorKey, context);
        } finally {
            zeroize(descriptorKey);
        }
    });
}

/**
 * Seals the descriptor of a clipping.
 *
 * @param {object} params
 * @param {string} params.userId User UUID, exactly as the server returns it.
 * @param {string} params.shareId Clipping UUIDv4, the same one that goes into the `shares.id` column.
 * @param {object} params.descriptor Descriptor content in the clear.
 * @returns {string} `v1.` + base64url, ready for the `shares.descriptor` column.
 * @throws {Error} If there is no master key in memory (`withMasterKey`).
 */
export function sealShareDescriptor({ userId, shareId, descriptor }) {
    return withDescriptorKey(userId, shareId, (key, context) =>
        sealText({ key, plaintext: JSON.stringify(descriptor), associatedData: context })
    );
}

/**
 * Opens the descriptor of a clipping.
 *
 * @param {object} params
 * @param {string} params.userId Same `userId` used to seal it.
 * @param {string} params.shareId Same identifier used to seal it.
 * @param {string} params.envelope Envelope exactly as it comes from the `descriptor` column.
 * @returns {object} Content in the clear, already parsed.
 * @throws {import('../crypto/envelope.js').EnvelopeError} If the envelope does not open. It is not
 *         silenced (ADR 0004).
 * @throws {Error} If there is no master key in memory (`withMasterKey`).
 */
export function openShareDescriptor({ userId, shareId, envelope }) {
    const plaintext = withDescriptorKey(userId, shareId, (key, context) =>
        openText({ key, envelope, associatedData: context })
    );

    return JSON.parse(plaintext);
}
