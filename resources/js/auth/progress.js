/**
 * Progress bar of the authentication screens.
 *
 * Not decoration. `finishRegistration` and `finishLogin` run Argon2id (t=3, m=64 MiB, p=4) in the
 * package WebAssembly, **synchronously and on the main thread**: the tab stays blocked for
 * several seconds. With nothing on screen saying something is happening, the person presses the
 * button again, and with a registration link involved that second attempt is a consumed link
 * (`docs/specs/0001-account-provisioning-and-session-bootstrap.md` §7).
 *
 * Two consequences of the main thread being blocked, and both shape this module:
 *
 * 1. **We must paint before blocking.** Changing Alpine state paints nothing on its own: the
 *    browser paints on the next frame, which never arrives if the synchronous call starts
 *    first. That is why `advance()` waits for two `requestAnimationFrame` before returning.
 * 2. **The animation must be able to run off the main thread.** Only `transform` and `opacity`
 *    animate on the compositor; animating `width` needs the main thread, which is exactly the
 *    busy one, and the bar would freeze. Hence `transform: scaleX(...)` with a long, linear
 *    transition: it starts before the block and the compositor keeps moving it during it.
 *
 * Progress is honest about the order but not about the time: nobody can know how long Argon2id
 * takes on a given device (risk 1 of §12). The long transition is set to a generous estimate and
 * the next stage cuts it short as soon as it really arrives.
 */

/** Estimated duration, in seconds, of one Argon2id with the ADR 0004 parameters. */
export const KEY_STRETCHING_SECONDS = 12;

/** Default duration of the steps that do not block the thread. */
const QUICK_SECONDS = 0.3;

/**
 * Waits for the browser to paint.
 *
 * Two frames, not one: the first one is scheduled before Alpine has applied the state change to
 * the DOM, so only the second one guarantees that what was painted includes the new stage.
 *
 * @returns {Promise<void>}
 */
export function nextPaint() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/**
 * State and behaviour of the bar, to mix into an Alpine component.
 *
 * @returns {{progress: number, progressSeconds: number, stage: string,
 *            advance: (stage: string, target: number, seconds?: number) => Promise<void>,
 *            resetProgress: () => void, progressStyle: () => string}}
 */
export function progressMixin() {
    return {
        /** Fraction of the bar, between 0 and 1. */
        progress: 0,

        /** Duration of the transition towards `progress`, in seconds. */
        progressSeconds: 0,

        /** Text the person sees. It never carries technical detail. */
        stage: '',

        /**
         * Announces a stage and returns control **after** the browser has painted it.
         *
         * @param {string} stage Stage text.
         * @param {number} target Target fraction, between 0 and 1.
         * @param {number} [seconds] Transition duration.
         * @returns {Promise<void>}
         */
        async advance(stage, target, seconds = QUICK_SECONDS) {
            this.stage = stage;
            this.progress = target;
            this.progressSeconds = seconds;

            await nextPaint();
        },

        /** Leaves the bar at zero, without transition: a retry must not animate backwards. */
        resetProgress() {
            this.stage = '';
            this.progress = 0;
            this.progressSeconds = 0;
        },

        /**
         * Style of the inner bar, as an object and not as a string: Alpine merges an object with
         * the `style` the element already carries, while a string would replace it whole and take
         * away the initial `scaleX(0)` from the template, which is the starting point of the
         * transition.
         *
         * @returns {{transform: string, transition: string}}
         */
        progressStyle() {
            return {
                transform: `scaleX(${this.progress})`,
                transition: `transform ${this.progressSeconds}s linear`,
            };
        },
    };
}
