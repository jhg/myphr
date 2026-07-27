/**
 * Ephemeral save confirmation, shared by the four event screens (glucose, blood pressure,
 * insulin, meals).
 *
 * The button already disables itself and changes to "Saving…" while it encrypts and uploads, so
 * the wait is visible; what was not visible was the end. When it finishes, the button simply says
 * "Save" again and the value field is left blank: exactly the same look as if nothing had
 * happened. The new record does appear in the history, but the history is another card further
 * down, off screen on a phone, and whoever is looking at the button does not see it. With the
 * encryption happening in the browser the operation takes long enough to raise a doubt, and the
 * natural reaction to doubt is to press again: that would save the same reading twice, and two
 * identical readings seconds apart are indistinguishable from a real repeated value afterwards.
 *
 * That is why the confirmation is ephemeral and not permanent: it reports the end of THIS
 * operation. If it stayed on screen, opening the page the next day —or after the next save
 * failed— would still read "Record saved", which would then be a lie. It goes away on its own
 * after a few seconds, without asking anybody to close it.
 *
 * Each template paints the notice next to the button with `x-show="saved"` and `role="status"`,
 * with the text in Blade (`__('Record saved.')`), like the settings confirmation of
 * `profile.blade.php`: the text is constant, so it does not need to go through the JavaScript
 * catalog.
 */

/**
 * How long the notice stays on screen. Four seconds are enough to read three words without staring,
 * and quite a bit less than the time to type the next reading, which is when the notice would start
 * getting in the way.
 */
export const SAVED_NOTICE_MS = 4000;

/**
 * State and behaviour of the notice, to mix into an Alpine component with `...savedNotice()`, like
 * `progressMixin()` in the sign-in screens.
 *
 * @returns {{saved: boolean, savedTimer: ReturnType<typeof setTimeout>|null,
 *            confirmSaved: () => void, clearSaved: () => void}}
 */
export function savedNotice() {
    return {
        /** Whether the "saved" notice is visible right now. */
        saved: false,

        /** Live timer of the notice, so it can be restarted when saving again. */
        savedTimer: null,

        /**
         * Shows the notice and schedules its removal.
         *
         * When saving twice in a row the previous timer is cancelled and the count restarts: if not,
         * the first one would switch off the second notice half-way, and a good save would be left
         * unconfirmed.
         */
        confirmSaved() {
            clearTimeout(this.savedTimer);

            this.saved = true;
            this.savedTimer = setTimeout(() => {
                this.saved = false;
                this.savedTimer = null;
            }, SAVED_NOTICE_MS);
        },

        /**
         * Removes the notice right away, without waiting for the timer. It is called when a new
         * save starts: leaving the "saved" of the previous one visible while the next reading is
         * encrypted would call it good too early.
         */
        clearSaved() {
            clearTimeout(this.savedTimer);

            this.saved = false;
            this.savedTimer = null;
        },
    };
}
