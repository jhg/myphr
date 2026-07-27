/**
 * Alpine component of the profile page (ADR 0002, ADR 0004, ADR 0007, ADR 0009).
 *
 * The DOM contract is fixed by `resources/views/phr/pages/profile.blade.php`: no `wire:model`
 * (ADR 0002), fields are read through `x-ref` and the URLs arrive in `data-*` of the form. There
 * is no Livewire call here: the settings go up already encrypted to `PUT /phr/settings` and the
 * password change talks straight to the `/phr/auth/password/*` routes.
 *
 * There is also a **read-only** block with the latest body measurements (weight, height and body
 * mass index). It is not a setting and that is why it has no fields and no button: those
 * measurements are recorded on the weight and height screen, with their date, and that is where
 * they are corrected. They are computed here, in the browser, decrypting the events
 * `$wire.fetchEvents` brings down —the only Livewire call in this module—, because the server
 * cannot read them (ADR 0002, ADR 0004). BMI is shown as a bare figure, with no categories and no
 * colours: the clinical why is in the JSDoc of `health/bodyMassIndex.js`.
 *
 * Two write operations, two buttons and two requests, deliberately kept apart:
 *
 * * **Settings.** Language, preferred unit and target range are saved together, in a single
 *   request, because the encrypted envelope is one document replaced whole (the server cannot
 *   patch what it cannot decrypt). The language travels in the clear in the same request so that
 *   it can never fall out of sync with the rest.
 * * **Password.** It is a full OPAQUE re-registration with two key stretchings and one
 *   transactional write. It shares neither button nor state with the settings: mixing them would
 *   let a range validation error abort a password change already half-way through.
 *
 * **The target range starts empty and with no suggested value** (ADR 0007). Neither this module
 * nor the template proposes numbers: a default range is a clinical instruction.
 *
 * The functions exported before `profilePage()` are the pure logic, so they can be tested without
 * mounting Alpine (`tests/js/profilePage.test.mjs`).
 */

import { bodyMassIndex, heightKnownAt, measurementUnitLabel } from '../health/bodyMassIndex.js';
import { openEvent } from '../health/eventEnvelope.js';
import { parseNumericValue } from '../health/numericValue.js';
import { formatDateTime, formatNumber, t } from '../i18n/index.js';
import { isUnlocked, ownerId } from './keyring.js';
import { AuthRequestError } from './http.js';
import { KEY_STRETCHING_SECONDS, progressMixin } from './progress.js';
import { SESSION_READY_EVENT } from './sessionBootstrap.js';
import { saveSettings, settings } from './settings.js';
import { changePassword } from './changePasswordPage.js';

/*
 * `saveSettings` and `changePassword` used to be imported with `import()` inside each handler. The
 * two reasons for that no longer hold: the files exist —nobody is writing them in parallel— and
 * they did not differ by a single byte. `settings.js` is imported statically by `lock.js`,
 * `loginPage.js`, `recovery.js` and `setPasswordPage.js`, so Vite warned with
 * `[INEFFECTIVE_DYNAMIC_IMPORT]` and left it where it was; and `changePasswordPage-*.js` compiled
 * to 0.02 kB with a single `import "./app-*.js"` inside, that is, the OPAQUE WebAssembly was
 * already travelling in the main bundle. All that was left was moving the module load failure
 * from startup to the user's click, saving nothing.
 */

/** Unit selected by default when there is no saved preference (the same as `glucosePage.js`). */
const DEFAULT_UNIT = 'mg/dL';

/** Valid units, in the UCUM codes of `App\Catalog\UcumUnit`. */
const UNITS = Object.freeze(['mg/dL', 'mmol/L']);

/**
 * Validates and normalizes the glucose target range exactly as it is typed in the form.
 *
 * Both limits blank mean "not configured", which is a legitimate state and the starting one of
 * every account (ADR 0007): it returns `null`, and the caller translates that into deleting the
 * key from the envelope. A single filled limit is a form error and never a half range: a range
 * with one made-up end is a false clinical instruction.
 *
 * The 2-decimal limit and the decimal comma are resolved by `parseNumericValue`, the same function
 * the event screens use, to avoid having two criteria of what a number is.
 *
 * @param {object} params
 * @param {string} params.lowRaw Raw value of the lower limit `<input type="number">`.
 * @param {string} params.highRaw Raw value of the upper limit.
 * @param {string} params.unit UCUM code of the unit both limits are written in.
 * @returns {{low: number, high: number, unit: string}|null} `null` if no range is configured.
 * @throws {Error} With a message in the active language if the range is half filled, out of order or not numeric.
 */
export function parseGlucoseTargetRange({ lowRaw, highRaw, unit }) {
    const low = parseNumericValue(String(lowRaw ?? '').trim(), t('field.rangeLow'));
    const high = parseNumericValue(String(highRaw ?? '').trim(), t('field.rangeHigh'));

    if (low === '' && high === '') {
        return null;
    }

    if (low === '' || high === '') {
        throw new Error(t('profile.error.rangeIncomplete'));
    }

    if (!UNITS.includes(unit)) {
        throw new Error(t('profile.error.rangeUnit'));
    }

    const lowNumber = Number(low);
    const highNumber = Number(high);

    if (lowNumber <= 0 || highNumber <= 0) {
        throw new Error(t('profile.error.rangeZero'));
    }

    if (lowNumber >= highNumber) {
        throw new Error(t('profile.error.rangeOrder'));
    }

    /**
     * The range stores its own unit: a plain `{low: 70, high: 180}` is ambiguous, and it becomes
     * dangerous as soon as the display unit changes. Since nothing is converted between units (ADR
     * 0007), whoever reads it compares the unit and, if it does not match, does not compute the percentage.
     */
    return { low: lowNumber, high: highNumber, unit };
}

/**
 * Builds the patch merged over the settings in memory before sealing them.
 *
 * A key with value `null` **deletes** that key from the document, which is how you stop having a
 * target range. An empty object or a `null` is never written as a "not configured" marker: the
 * absence of the key already is that state (ADR 0007).
 *
 * @param {object} params
 * @param {string} params.glucoseUnit UCUM code of the preferred unit.
 * @param {string} params.lowRaw
 * @param {string} params.highRaw
 * @param {string} params.rangeUnit
 * @returns {{glucoseUnit: string, glucoseTargetRange: {low: number, high: number, unit: string}|null}}
 * @throws {Error} With a message in the active language if any field is invalid.
 */
export function buildSettingsPatch({ glucoseUnit, lowRaw, highRaw, rangeUnit }) {
    if (!UNITS.includes(glucoseUnit)) {
        throw new Error(t('profile.error.unit'));
    }

    return {
        glucoseUnit,
        glucoseTargetRange: parseGlucoseTargetRange({ lowRaw, highRaw, unit: rangeUnit }),
    };
}

/**
 * Page size when reading events for the latest measurements block. It is the hard ceiling of
 * `HealthEventPage::MAX_FETCH_LIMIT`: here we search backwards in time until we find the last
 * weighing and the last height, and the fewer round trips, the better.
 */
const MEASUREMENTS_PAGE_SIZE = 500;

/**
 * How many pages are walked at most.
 *
 * Without a cap, an account with years of meals and glucose readings and no height at all would
 * walk the whole history decrypting envelope by envelope only to end up saying "not yet". With the
 * cap, the worst case is 2500 events and the block says the same thing. A height from very long
 * ago not showing up is a lesser evil than freezing the tab: record it again and it shows up again.
 */
const MEASUREMENTS_MAX_PAGES = 5;

/**
 * Summarizes the latest body measurements from the already decrypted weight events.
 *
 * The most recent weight and the most recent height may come from different records, and that is
 * normal: height is optional in each record (see `health/bodyWeightPage.js`). BMI is computed with
 * that pair, which is the best information available today.
 *
 * **With no height at all there is no BMI**: it returns `null`, and the screen shows no figure.
 * Never a zero, never a made-up average height.
 *
 * @param {list<{occurredAt: string, content: object}>} weightEvents Decrypted `bodyWeight` events.
 * @returns {{weight: {value: string, unit: string, occurredAt: string}|null,
 *           height: {value: string, unit: string, occurredAt: string}|null,
 *           bmi: number|null}}
 */
export function summarizeBodyMeasurements(weightEvents) {
    let weight = null;
    let weightTime = -Infinity;

    for (const event of weightEvents) {
        const time = Date.parse(event.occurredAt);

        if (Number.isNaN(time) || time < weightTime) {
            continue;
        }

        const { data } = event.content;

        weight = { value: data.value, unit: data.unit, occurredAt: event.occurredAt };
        weightTime = time;
    }

    /** No upper bound (`null`): the profile shows the most recent height of all. */
    const height = heightKnownAt(weightEvents, null);

    return { weight, height, bmi: bodyMassIndex({ weight, height }) };
}

/**
 * Translates a failure into the message the person sees. Never technical detail.
 *
 * @param {unknown} failure
 * @param {string} fallback
 * @returns {string}
 */
function describe(failure, fallback) {
    if (failure instanceof AuthRequestError) {
        if (failure.status === null) {
            return t('common.network');
        }

        if (failure.status === 412 || failure.status === 428) {
            return t('profile.error.conflict');
        }

        if (failure.status === 401) {
            return t('changePassword.error.currentPassword');
        }

        if (failure.status === 409) {
            return t('profile.error.passwordExpired');
        }

        return fallback;
    }

    if (failure instanceof Error && failure.message !== '') {
        return failure.message;
    }

    return fallback;
}

/**
 * Alpine component factory. Registered as `phrProfilePage`.
 *
 * @returns {object}
 */
export function profilePage() {
    return {
        ...progressMixin(),

        /** Password change in progress. The progress bar is shown with this flag. */
        busy: false,

        savingSettings: false,
        settingsError: '',
        settingsSaved: false,
        passwordError: '',
        passwordChanged: false,

        /** Language the page was painted in, to know whether to reload after saving. */
        initialLocale: '',

        /**
         * Latest measurements block, already as text: the template only does `x-text`. They start
         * with the locked-session notice and not blank, because nothing can be decrypted until
         * there is a key and an empty gap would read as "you have no records".
         */
        lastWeightText: t('common.locked.summary'),
        lastWeightDate: '',
        lastHeightText: t('common.locked.summary'),
        lastHeightDate: '',
        bodyMassIndexText: t('common.locked.summary'),
        bodyMassIndexDate: '',
        measurementsError: '',

        init() {
            this.initialLocale = this.$refs.locale.value;

            if (isUnlocked()) {
                this.fillFromSettings();
                void this.loadBodyMeasurements();

                return;
            }

            /**
             * The settings live decrypted in memory and arrive when the session bootstrap finishes
             * (§6.2). Until then the fields stay as the server painted them, which for the unit
             * and the range is "empty", never a made-up value. The latest measurements depend on
             * the same key, so they wait for the same moment.
             */
            document.addEventListener(SESSION_READY_EVENT, () => {
                this.fillFromSettings();
                void this.loadBodyMeasurements();
            }, { once: true });
        },

        /**
         * Dumps the decrypted settings into the form. Whatever is not configured stays blank:
         * filling the range with anything would be inventing a clinical instruction.
         */
        fillFromSettings() {
            const current = settings() ?? {};

            this.$refs.glucoseUnit.value = current.glucoseUnit ?? DEFAULT_UNIT;

            const range = current.glucoseTargetRange ?? null;

            this.$refs.rangeLow.value = range === null ? '' : String(range.low);
            this.$refs.rangeHigh.value = range === null ? '' : String(range.high);
            this.$refs.rangeUnit.value = range?.unit ?? this.$refs.glucoseUnit.value;
        },

        /**
         * Reads, decrypts and summarizes the latest body measurements.
         *
         * The server cannot filter by type (ADR 0006: the type travels inside the envelope), so
         * pages of events are requested backwards in time and everything that is not `bodyWeight`
         * is discarded here. It stops as soon as both things are known —last weight and last
         * height—, which in an account that records height now and then is almost always the first
         * page.
         *
         * An envelope that does not open takes nothing down: it is skipped. It is the same thing
         * the history screens do (ADR 0004), and it matters even less here, because the block only
         * shows the latest measurement and not a count.
         */
        async loadBodyMeasurements() {
            this.measurementsError = '';

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    this.showBodyMeasurements(null);

                    return;
                }

                const weightEvents = [];
                let cursor = null;

                for (let page = 0; page < MEASUREMENTS_MAX_PAGES; page += 1) {
                    /** Same positional order as `HealthEventPage::fetchEvents(?string, int, ?string, ?string)`. */
                    const rawEvents = await this.$wire.fetchEvents(cursor, MEASUREMENTS_PAGE_SIZE);

                    for (const rawEvent of rawEvents) {
                        try {
                            const content = openEvent({
                                userId,
                                occurredAt: rawEvent.occurredAt,
                                envelope: rawEvent.payload,
                            });

                            if (content?.type === 'bodyWeight') {
                                weightEvents.push({ occurredAt: rawEvent.occurredAt, content });
                            }
                        } catch {
                            /** An unreadable envelope is skipped, it does not break the screen (ADR 0004). */
                        }
                    }

                    /** Fewer rows than the page size means there is no more history. */
                    if (rawEvents.length < MEASUREMENTS_PAGE_SIZE) {
                        break;
                    }

                    const summarySoFar = summarizeBodyMeasurements(weightEvents);

                    if (summarySoFar.weight !== null && summarySoFar.height !== null) {
                        break;
                    }

                    cursor = rawEvents[rawEvents.length - 1].occurredAt;
                }

                this.showBodyMeasurements(summarizeBodyMeasurements(weightEvents));
            } catch (failure) {
                this.showBodyMeasurements(null);
                this.measurementsError = describe(failure, t('profile.error.measurementsGeneric'));
            }
        },

        /**
         * Dumps the summary into the texts of the block.
         *
         * `null` means "could not be computed" (locked session or error) and it is said with the
         * locked-session sentence, not with a gap. What is really missing —no weight at all, no
         * height at all— is said with "no record yet", which is different and true.
         *
         * @param {{weight: object|null, height: object|null, bmi: number|null}|null} summary
         */
        showBodyMeasurements(summary) {
            if (summary === null) {
                this.lastWeightText = t('common.locked.summary');
                this.lastHeightText = t('common.locked.summary');
                this.bodyMassIndexText = t('common.locked.summary');
                this.lastWeightDate = '';
                this.lastHeightDate = '';
                this.bodyMassIndexDate = '';

                return;
            }

            const { weight, height, bmi } = summary;

            this.lastWeightText = weight === null
                ? t('profile.body.none')
                : `${weight.value} ${measurementUnitLabel(weight.unit)}`;
            this.lastWeightDate = weight === null ? '' : formatDateTime(weight.occurredAt);

            this.lastHeightText = height === null
                ? t('profile.body.none')
                : `${height.value} ${measurementUnitLabel(height.unit)}`;
            this.lastHeightDate = height === null ? '' : formatDateTime(height.occurredAt);

            /**
             * Without a height there is no BMI, and the reason is said instead of leaving the gap:
             * the person can do something about it (record a height), so they deserve to know.
             */
            this.bodyMassIndexText = bmi === null ? t('profile.body.noBmi') : formatNumber(bmi);
            this.bodyMassIndexDate = bmi === null ? '' : t('profile.body.fromRecords');
        },

        /** Saves the three settings sections in a single request. */
        async submitSettings() {
            if (this.savingSettings) {
                return;
            }

            this.savingSettings = true;
            this.settingsError = '';
            this.settingsSaved = false;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    throw new Error(t('common.locked.settings'));
                }

                const patch = buildSettingsPatch({
                    glucoseUnit: this.$refs.glucoseUnit.value,
                    lowRaw: this.$refs.rangeLow.value,
                    highRaw: this.$refs.rangeHigh.value,
                    rangeUnit: this.$refs.rangeUnit.value,
                });

                const locale = this.$refs.locale.value;

                await saveSettings({
                    patch,
                    userId,
                    locale,
                    url: this.$refs.settingsForm.dataset.settingsUrl,
                });

                this.settingsSaved = true;

                /**
                 * The Filament frame (menu, breadcrumbs, titles) is already painted in the
                 * previous language and the server resolves it, so a language change is only seen
                 * whole after a reload. It happens after the 2xx, never before.
                 */
                if (locale !== this.initialLocale) {
                    window.location.reload();
                }
            } catch (failure) {
                this.settingsError = describe(failure, t('profile.error.settingsGeneric'));
            } finally {
                this.savingSettings = false;
            }
        },

        /**
         * Changes the password: reauthentication with the current one, OPAQUE re-registration with
         * the new one and rewrapping of the master key, all inside `changePassword`.
         *
         * Here we only read the fields, empty them at once and paint the progress. The three
         * passwords never go through Alpine state: they live in local variables of this function
         * and are released when it ends.
         */
        async submitPassword() {
            if (this.busy) {
                return;
            }

            this.busy = true;
            this.passwordError = '';
            this.passwordChanged = false;
            this.resetProgress();

            let currentPassword = this.$refs.currentPassword.value;
            let newPassword = this.$refs.newPassword.value;
            const confirmation = this.$refs.newPasswordConfirmation.value;

            this.$refs.currentPassword.value = '';
            this.$refs.newPassword.value = '';
            this.$refs.newPasswordConfirmation.value = '';

            try {
                if (currentPassword === '' || newPassword === '') {
                    throw new Error(t('changePassword.error.empty'));
                }

                if (newPassword !== confirmation) {
                    throw new Error(t('changePassword.error.mismatch'));
                }

                await this.advance(t('stage.preparing'), 0.05);

                await changePassword({
                    currentPassword,
                    newPassword,
                    urls: { ...this.$refs.passwordForm.dataset },
                    onStage: (stage) => this.announce(stage),
                });

                await this.advance(t('stage.done'), 1);

                this.passwordChanged = true;
            } catch (failure) {
                this.passwordError = describe(failure, t('profile.error.passwordGeneric'));
                this.resetProgress();
            } finally {
                currentPassword = '';
                newPassword = '';
                this.busy = false;
            }
        },

        /**
         * Paints a stage of the password change. The two Argon2id runs are announced separately
         * and with their estimated duration: if the bar treated them as one, the person would see
         * the same pause twice with no explanation and would press the button again.
         *
         * @param {string} stage Stage name emitted by `changePassword`.
         * @returns {Promise<void>}
         */
        announce(stage) {
            const plan = {
                reauth: [t('profile.stage.reauth'), 0.3, KEY_STRETCHING_SECONDS],
                opening: [t('profile.stage.opening'), 0.4],
                stretching: [t('profile.stage.stretching'), 0.75, KEY_STRETCHING_SECONDS],
                wrapping: [t('profile.stage.wrapping'), 0.85],
                saving: [t('stage.saving'), 0.95],
            }[stage];

            if (plan === undefined) {
                return Promise.resolve();
            }

            return this.advance(...plan);
        },
    };
}
