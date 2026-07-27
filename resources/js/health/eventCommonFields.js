/**
 * Fields common to every clinical event (ADR 0006, paragraph "Fields captured even if unused
 * today"): whether the datum is manual or from a device, the device if there is one, whether the
 * person themselves or a carer records it, and an optional free note.
 *
 * **They go at the top level of the decrypted content**, next to `v`, `type` and `tz`, never
 * inside `data`: they are not specific to glucose, every event screen will reuse them (blood
 * pressure, meals, insulin), so this function lives outside `glucosePage.js`.
 *
 * `origin` (token of `App\Catalog\DataOrigin`) tells apart **how the datum entered the
 * application**: typed by a person (`manual`) versus imported automatically from a device
 * (`device`). It is NOT how the glucose was measured — that is the `device` field below, which
 * device the reading was taken with. This confusion already happened once in this project (the
 * form asked for "data origin" with a manual/device selector, when the insertion is always manual:
 * the person reads the value on their meter or sensor and types it in), so it is written down here
 * so it does not happen again. That is why `buildCommonEventFields()` fixes `origin` to `manual`
 * without asking — today there is no integration and no automatic sync with any device. The day an
 * import exists, it will be the one building the event with `origin: 'device'`, not a `<select>`
 * in a manual entry form.
 *
 * `origin` and `recordedBy` do carry a sensible default (`manual` and `self`, tokens of
 * `App\Catalog\DataOrigin` and `App\Catalog\RecordedBy`): they are not clinical claims, they are
 * facts about how the datum entered. `device` and `note` are free text and are left out of the
 * content when empty, with the same criterion as the meal context of `buildGlucoseContent`:
 * absence has to mean absence, never an empty string stored as if it were data.
 */

/** `App\Catalog\DataOrigin` token this function uses when no `origin` is given. */
export const DEFAULT_ORIGIN = 'manual';

/** `App\Catalog\RecordedBy` token this function uses when no `recordedBy` is given. */
export const DEFAULT_RECORDED_BY = 'self';

/**
 * @param {unknown} value
 * @returns {string} `value` trimmed, or an empty string if it was not a string with content.
 */
function trimmedOrEmpty(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Builds the fields common to every event, ready to spread at the top level of the content in the
 * clear (`{v, type, tz, ...commonFields, data}`).
 *
 * @param {object} [params]
 * @param {string} [params.origin] `DataOrigin` token: how the datum entered (typed or imported),
 *     not what it was measured with. `DEFAULT_ORIGIN` by default; no manual capture form should
 *     ask for it, only the future automatic import will set it to `device`.
 * @param {string} [params.device] Device as free text. Left out when empty.
 * @param {string} [params.recordedBy] `RecordedBy` token. `DEFAULT_RECORDED_BY` by default.
 * @param {string} [params.note] Free note. Left out when empty.
 * @returns {{origin: string, recordedBy: string, device?: string, note?: string}}
 */
export function buildCommonEventFields({ origin, device, recordedBy, note } = {}) {
    const fields = {
        origin: trimmedOrEmpty(origin) || DEFAULT_ORIGIN,
        recordedBy: trimmedOrEmpty(recordedBy) || DEFAULT_RECORDED_BY,
    };

    const trimmedDevice = trimmedOrEmpty(device);

    if (trimmedDevice !== '') {
        fields.device = trimmedDevice;
    }

    const trimmedNote = trimmedOrEmpty(note);

    if (trimmedNote !== '') {
        fields.note = trimmedNote;
    }

    return fields;
}
