/**
 * Alpine component of the meals screen (ADR 0002, ADR 0004, ADR 0005, ADR 0006).
 *
 * The DOM contract is fixed by `resources/views/phr/pages/meals.blade.php`: no `wire:model`
 * (ADR 0002), the common fields are read through `x-ref`, and the food list lives in a
 * `wire:ignore` container whose rows are cloned from a `<template>` rendered by Blade (that way
 * the unit `<select>` of each new row is still HTML written by the server, not by Alpine, as ADR
 * 0002 demands). The encrypted envelope goes up as an argument of the `storeEvent` of
 * `HealthEventPage`, never as a Livewire property.
 *
 * **The server cannot filter by type** (ADR 0006, see the JSDoc of `HealthEventPage::fetchEvents()`):
 * `fetchEvents` brings every event of the user and here each one is decrypted and whatever is not
 * `type === 'meal'` is discarded. An envelope that does not open does not take the screen down: it
 * is counted and reported, because a silent decryption failure is exactly what ADR 0004 forbids.
 *
 * **There is no "data origin" selector.** Today every meal is typed by hand: there is no
 * integration with a device that records meals, so a "manual or device?" `<select>` would have no
 * real second answer and would only invite a wrong one. `origin` (token of
 * `App\Catalog\DataOrigin`) still travels in the encrypted envelope because ADR 0006 demands it
 * and it cannot be added later without re-encrypting everything already stored, but here it is
 * always fixed to `manual` by letting `buildCommonEventFields()` use its default value (see
 * `eventCommonFields.js`, extended with this same explanation): the day an automatic import
 * exists, that will be the one writing `origin: 'device'`, not this form.
 *
 * **The food list is ordered data** (ADR 0006): the order the rows appear in the DOM is the order
 * that is stored, and `buildMealContent` respects it as is because it never reorders the DOM or
 * the array it builds from it.
 *
 * **Foods are NOT coded against any vocabulary** (a deliberate exception to ADR 0005, justified in
 * the ADR of this screen): the name of each food is free text. The quantity of each food always
 * travels as a string, never as a number (ADR 0004: decimals as a string), and the unit is coded
 * in UCUM (`App\Catalog\FoodQuantityUnit`).
 *
 * **The quantity is a clinical numeric field**, so it goes through `numericValue.js` like the
 * glucose value or the insulin dose: two decimals at most, never negative and the comma normalized
 * to a dot before sealing the envelope. Without that normalization, "250,5 g" and "250.5 g" would
 * end up stored as two different strings inside an already encrypted datum, impossible to fix later.
 *
 * **A completely empty row does not count as a food.** The form always starts with a blank row so
 * that whoever has nothing to note does not have to "add" anything; `buildMealContent` simply
 * discards it. A half-filled row (with a name but no quantity, or the other way round) is an
 * error: silencing it would store an incomplete food without the person noticing.
 *
 * **The event date is not converted here.** `datetimeLocalToCanonical` lives in `datetimeLocal.js`
 * because what it returns enters as AEAD associated data (ADR 0004): if each screen carried its
 * own copy and one drifted, its envelopes would stop opening.
 *
 * The functions exported before `mealsPage()` are the pure logic of the component, so they can be
 * tested without mounting Alpine (`tests/js/mealsPage.test.mjs`).
 */

import { isUnlocked, ownerId } from '../auth/keyring.js';
import { SESSION_READY_EVENT } from '../auth/sessionBootstrap.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { formatDateTime, t } from '../i18n/index.js';
import { dateRangeControl } from './dateRange.js';
import { datetimeLocalToCanonical } from './datetimeLocal.js';
import { buildCommonEventFields } from './eventCommonFields.js';
import { openEvent, sealEvent } from './eventEnvelope.js';
import { parseNumericValue } from './numericValue.js';
import { savedNotice } from './savedNotice.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function trimmedOrEmpty(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Reduces the raw list of food rows (exactly as read from the DOM) to the ordered list that enters
 * `data.foods`. A completely empty row is discarded silently (it is not a food); a half-filled row
 * is an error, because storing it would complete the datum with a value nobody wrote.
 *
 * The quantity goes through `parseNumericValue` (see `numericValue.js`): it rejects negatives and
 * more than two decimals, and normalizes the comma to a dot. The result is still a string, never a
 * `Number` (ADR 0004).
 *
 * @param {list<{name: string, quantity: string, unit: string}>} rawFoods In the same order they
 *        appear in the DOM.
 * @returns {list<{name: string, quantity: string, unit: string}>} Quantity always as a string
 *          (ADR 0004).
 * @throws {Error} If a row has only part of its fields filled in or the quantity is not a valid
 *         number.
 */
export function normalizeFoods(rawFoods) {
    const foods = [];

    for (const rawFood of rawFoods) {
        const name = trimmedOrEmpty(rawFood.name);
        const quantity = trimmedOrEmpty(rawFood.quantity);
        const unit = trimmedOrEmpty(rawFood.unit);

        const filledCount = [name, quantity, unit].filter((field) => field !== '').length;

        if (filledCount === 0) {
            continue;
        }

        if (filledCount < 3) {
            throw new Error(t('meals.incompleteFood'));
        }

        foods.push({ name, quantity: parseNumericValue(quantity, t('field.quantity')), unit });
    }

    return foods;
}

/**
 * Builds the content in the clear of a meal event, with the shape of ADR 0006.
 *
 * `common` are the fields any event type shares (device, who records, note) and they go at the top
 * level of the content, not inside `data`. This function never receives them with `origin`: the
 * data origin is always `manual` in a hand-entry form (see the module JSDoc), so `common` is left
 * to bring the default value of `buildCommonEventFields()`.
 *
 * @param {object} params
 * @param {string} params.mealType `App\Catalog\MealType` token.
 * @param {list<{name: string, quantity: string, unit: string}>} params.rawFoods DOM rows, in
 *        order, not normalized yet.
 * @param {string} params.tz `±HH:MM` offset of the moment of recording.
 * @param {{origin: string, recordedBy: string, device?: string, note?: string}} params.common
 *        Already built by `buildCommonEventFields`, with `origin` at its default value (`manual`).
 * @returns {{v: 1, type: 'meal', tz: string, origin: string, recordedBy: string, device?: string,
 *           note?: string, data: {mealType: string, foods: list<{name: string, quantity: string, unit: string}>}}}
 * @throws {Error} If the meal type is missing or some food row is half filled.
 */
export function buildMealContent({ mealType, rawFoods, tz, common }) {
    if (typeof mealType !== 'string' || mealType.trim() === '') {
        throw new Error(t('meals.missingMealType'));
    }

    const foods = normalizeFoods(rawFoods);

    return {
        v: 1,
        type: 'meal',
        tz,
        ...common,
        data: { mealType, foods },
    };
}

/**
 * Discards the decrypted events that are not of type `meal`. The server cannot do this filter
 * because the type travels encrypted inside the envelope (ADR 0006): it is the client's job.
 *
 * @param {list<{id: string, occurredAt: string, content: object}>} events Already decrypted.
 * @returns {list<{id: string, occurredAt: string, content: object}>}
 */
export function filterMealEvents(events) {
    return events.filter((event) => event.content?.type === 'meal');
}

/**
 * Resolves the label of a catalog token (meal type or unit), tolerating a token that is no longer
 * in the current catalog: the token itself is shown instead of breaking the view.
 *
 * @param {list<{token?: string, code?: string, label: string}>} entries
 * @param {string} token
 * @param {'token'|'code'} key
 * @returns {string}
 */
function resolveCatalogLabel(entries, token, key) {
    return entries.find((entry) => entry[key] === token)?.label ?? token;
}

/**
 * Gives readable shape to an already decrypted meal event, to paint the history without dumping
 * JSON (the screen asks for it: "the history must show the meal with its readable food list").
 * It tolerates an event with no note and no device (ADR 0006: both are optional and left out of
 * the content when not given), without throwing and without inventing a default value for them.
 *
 * It also tolerates an envelope that opens but whose content does not have the expected shape
 * (`data` absent or `foods` not a list): whatever there is gets painted instead of throwing. One
 * odd record cannot leave the whole history blank, which is the same thing the count of envelopes
 * that do not open is after.
 *
 * @param {{mealTypes: list<{token: string, label: string}>, units: list<{code: string, label: string}>}} catalog
 * @param {{data: {mealType: string, foods: list<{name: string, quantity: string, unit: string}>}, note?: string, device?: string}} content
 * @returns {{mealTypeLabel: string, foods: list<{name: string, quantity: string, unitLabel: string}>, note: string|null, device: string|null}}
 */
export function describeMealEvent(catalog, content) {
    const data = content.data ?? {};
    const rawFoods = Array.isArray(data.foods) ? data.foods : [];

    return {
        mealTypeLabel: resolveCatalogLabel(catalog.mealTypes, data.mealType ?? '', 'token'),
        foods: rawFoods.map((food) => ({
            name: food.name,
            quantity: food.quantity,
            unitLabel: resolveCatalogLabel(catalog.units, food.unit, 'code'),
        })),
        note: typeof content.note === 'string' && content.note !== '' ? content.note : null,
        device: typeof content.device === 'string' && content.device !== '' ? content.device : null,
    };
}

/** @returns {string} Right now, in the shape an `<input type="datetime-local" step="1">` expects. */
function nowAsDatetimeLocalValue() {
    return toDatetimeLocalValue(new Date());
}

/**
 * @param {Date} date
 * @returns {string}
 */
function toDatetimeLocalValue(date) {
    const pad = (value) => String(value).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Heroicons v2 path (outline, 24×24), the same cake as `Meals::$navigationIcon`, so the guide icon
 * of each record is the same as the one of the section.
 */
const ICON_PATHS = Object.freeze({
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 '
        + '1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    info: 'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 '
        + '12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
    cake: 'M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.87c1.355 '
        + '0 2.697.055 4.024.165C17.155 8.51 18 9.473 18 10.608v2.513m-12 0v6.635m12-6.635v6.635m-12 0v-.108c0-1.135.845-2.098 '
        + '1.976-2.192a48.424 48.424 0 0 1 8.048 0c1.131.094 1.976 1.057 1.976 2.192v.108m-12 0v.108c0 1.135.845 2.098 1.976 '
        + '2.192a48.424 48.424 0 0 0 8.048 0c1.131-.094 1.976-1.057 1.976-2.192v-.108M12 4.875a1.125 1.125 0 1 0 0-2.25 1.125 1.125 0 0 0 0 2.25Z',
});

/**
 * Decorative 20px icon (DESIGN.md § Lists: "20px icon"). It goes with `aria-hidden`.
 *
 * @param {'warning'|'info'|'cake'} name
 * @param {string} className
 * @returns {SVGSVGElement}
 */
function createIcon(name, className) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');

    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);

    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', ICON_PATHS[name]);
    svg.appendChild(path);

    return svg;
}

/**
 * Block notice with an icon (DESIGN.md § Chips (Status Chip): colour + icon + text, never colour
 * alone, Do's #3).
 *
 * @param {object} params
 * @param {'error'|'info'} params.tone
 * @param {string} params.message
 * @returns {HTMLDivElement}
 */
function createCallout({ tone, message }) {
    const callout = document.createElement('div');

    /**
     * The two tones come from the notice tokens (`error-*` / `info-*`, see `theme.css`), not from
     * the `danger-*` / `primary-*` ramps: the tokens already carry inside the pair corrected to AA
     * and its § Dark Mode equivalent, while `bg-danger-50` does not switch with the theme and would
     * leave the notice unreadable in dark. Same tones as the glucose screen.
     */
    callout.className = tone === 'error'
        ? 'flex items-start gap-3 rounded-control border border-error-outline bg-error-surface p-pad-md '
            + 'text-body text-error-ink shadow-large'
        : 'flex items-start gap-3 rounded-control border border-info-outline bg-info-surface p-pad-md '
            + 'text-body-lg text-info-ink';

    if (tone === 'error') {
        callout.setAttribute('role', 'alert');
    }

    callout.appendChild(createIcon(tone === 'error' ? 'warning' : 'info', 'size-5 shrink-0'));

    const text = document.createElement('p');
    text.textContent = message;
    callout.appendChild(text);

    return callout;
}

/**
 * Filter chip (DESIGN.md § Chips · Filter Chip): #F0F7FF pill with a #CBD5E1 border and #475569
 * 13px semibold text, 6px/14px padding. It is used for each food of the list.
 *
 * The food name is prose and goes in the text typography; the quantity and its unit are a
 * measurement value and go in IBM Plex Mono (Do's #7), in their own `<span>`: mixing them in one
 * string would leave the number in the prose typography, which is exactly what the rule avoids.
 *
 * @param {string} name Food name, free text.
 * @param {string} measurement Quantity and unit already composed, e.g. "250 g".
 * @returns {HTMLSpanElement}
 */
function createFoodChip(name, measurement) {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center gap-1.5 rounded-full border border-chip-outline '
        + 'bg-chip-surface px-3.5 py-1.5 text-helper font-semibold text-chip-ink';

    const nameText = document.createElement('span');
    nameText.textContent = name;
    chip.appendChild(nameText);

    const measurementText = document.createElement('span');
    measurementText.className = 'font-mono';
    measurementText.textContent = measurement;
    chip.appendChild(measurementText);

    return chip;
}

/**
 * Status chip (DESIGN.md § Chips · Status Chip, info variant): 12px bold in uppercase, 4px radius,
 * 4px/12px padding. It is used for the meal type.
 *
 * The size goes in `text-status-chip` and not in `text-caption`: both are 12px, but the second is
 * the role of timestamps and drags its 0.01em tracking, which serves nothing here.
 *
 * @param {string} label
 * @returns {HTMLSpanElement}
 */
function createStatusChip(label) {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center rounded-chip border border-info-outline bg-info-surface '
        + 'px-3 py-1 text-status-chip uppercase text-info-ink';
    chip.textContent = label;

    return chip;
}

/**
 * @param {unknown} failure
 * @returns {string}
 */
function describeError(failure) {
    if (failure instanceof EnvelopeError) {
        return t('common.undecryptable');
    }

    if (failure instanceof Error && failure.message !== '') {
        return failure.message;
    }

    return t('common.saveFailed');
}

/**
 * History page size. It is the same value as the default `$limit` of
 * `HealthEventPage::fetchEvents()`: the arguments are positional, so passing the range forces
 * passing the cursor and the limit too, and the usual value is repeated here so as not to change
 * in passing how many events come down on each load.
 */
const HISTORY_FETCH_LIMIT = 100;

/**
 * Alpine component factory. Registered as `phrMealsPage`.
 *
 * @returns {object}
 */
export function mealsPage() {
    return {
        ...savedNotice(),
        ...dateRangeControl(),

        error: '',
        catalog: null,
        loading: false,

        /** Decrypted envelopes that failed to open on the last load (they do not take the screen down). */
        failedToOpenCount: 0,

        init() {
            this.catalog = JSON.parse(document.querySelector('[data-phr-meals-catalog]').textContent);

            /**
             * The options of `mealType`, `recordedBy` and of the unit of each food row are rendered
             * by the server in Blade (ADR 0002, ADR 0005): they are not filled in here. See the
             * comment at the start of `meals.blade.php`.
             */
            this.$refs.occurredAt.value = nowAsDatetimeLocalValue();

            /** The form starts with a blank food row, ready to fill in. */
            this.addFoodRow();

            if (isUnlocked()) {
                void this.loadHistory();

                return;
            }

            this.renderLocked();
            document.addEventListener(SESSION_READY_EVENT, () => void this.loadHistory(), { once: true });
        },

        /**
         * Clones the row of `x-ref="foodRowTemplate"` (HTML written by Blade, with its unit
         * `<option>` already in place) and appends it to `x-ref="foods"`, so that the order in the
         * DOM is the order of storage (ADR 0006).
         */
        addFoodRow() {
            const row = this.$refs.foodRowTemplate.content.firstElementChild.cloneNode(true);

            row.querySelector('[data-food-remove]').addEventListener('click', () => {
                row.remove();
            });

            this.$refs.foods.appendChild(row);
        },

        /** Reads the food rows from the DOM, in order, exactly as the person typed them. */
        readFoodRows() {
            return [...this.$refs.foods.querySelectorAll('[data-food-row]')].map((row) => ({
                name: row.querySelector('[data-food-name]').value,
                quantity: row.querySelector('[data-food-quantity]').value,
                unit: row.querySelector('[data-food-unit]').value,
            }));
        },

        /**
         * Saves the record.
         *
         * `loading` covers the WHOLE operation, not just the history download: between the click and
         * the repaint there is key derivation, AEAD sealing and a round trip to Livewire, and with
         * no signal at all the person presses the button again and stores the same meal twice. The
         * template uses it to disable it, set `aria-busy` and change the text (Do's #3), like the
         * glucose screen and the sign-in ones.
         *
         * @param {SubmitEvent} [event]
         */
        async submit() {
            this.error = '';
            this.clearSaved();
            this.loading = true;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    throw new Error(t('common.noSession'));
                }

                const localDatetime = this.$refs.occurredAt.value;

                if (localDatetime === '') {
                    throw new Error(t('common.missingDate'));
                }

                const { occurredAt, tz } = datetimeLocalToCanonical(localDatetime);

                /**
                 * No `origin`: in a manual entry form it is always `manual`, so
                 * `buildCommonEventFields()` fixes it with its default value (see the module
                 * JSDoc). There is no `x-ref="origin"` to read.
                 */
                const common = buildCommonEventFields({
                    device: this.$refs.device.value,
                    recordedBy: this.$refs.recordedBy.value,
                    note: this.$refs.note.value,
                });

                const content = buildMealContent({
                    mealType: this.$refs.mealType.value,
                    rawFoods: this.readFoodRows(),
                    tz,
                    common,
                });

                const payload = sealEvent({ userId, occurredAt, content });

                await this.$wire.storeEvent(payload, occurredAt);

                this.$refs.foods.replaceChildren();
                this.addFoodRow();
                this.$refs.device.value = '';
                this.$refs.note.value = '';

                await this.loadHistory();

                /** At the very end: the notice confirms the whole operation, not just the POST. */
                this.confirmSaved();
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /** Downloads, decrypts, filters and paints the history. */
        async loadHistory() {
            this.loading = true;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    this.renderLocked();

                    return;
                }

                /**
                 * The range is applied by the server: `occurred_at` is a column in the clear (ADR
                 * 0006) and narrowing it saves downloading and decrypting months of events of other
                 * types this module would throw away anyway. The type is still discarded here,
                 * which is what the server cannot do.
                 */
                const range = this.historyRange();
                const rawEvents = await this.$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to);

                let failedToOpen = 0;
                const opened = [];

                for (const rawEvent of rawEvents) {
                    try {
                        const content = openEvent({
                            userId,
                            occurredAt: rawEvent.occurredAt,
                            envelope: rawEvent.payload,
                        });

                        opened.push({ id: rawEvent.id, occurredAt: rawEvent.occurredAt, content });
                    } catch {
                        /** An envelope that does not open does not take the screen down (ADR 0004): it is counted and reported. */
                        failedToOpen += 1;
                    }
                }

                this.failedToOpenCount = failedToOpen;

                const mealEvents = filterMealEvents(opened);

                this.renderList(mealEvents);
            } catch (failure) {
                this.error = describeError(failure);
            } finally {
                this.loading = false;
            }
        },

        /** With no key nothing can be decrypted: it is said, no empty list is painted. */
        renderLocked() {
            this.$refs.list.replaceChildren(createCallout({ tone: 'info', message: t('common.locked.history') }));
        },

        /** @param {list<{id: string, occurredAt: string, content: object}>} mealEvents */
        renderList(mealEvents) {
            const fragment = document.createDocumentFragment();

            if (this.failedToOpenCount > 0) {
                const warning = createCallout({
                    tone: 'error',
                    message: t('common.recordsUndecrypted', { count: this.failedToOpenCount }),
                });
                warning.classList.add('mb-4');
                fragment.appendChild(warning);
            }

            if (mealEvents.length === 0) {
                const empty = document.createElement('p');
                /** The secondary text role, not a ramp shade; never a dull grey (Don'ts #10). */
                empty.className = 'text-body text-ink-secondary';
                empty.textContent = t('meals.empty');
                fragment.appendChild(empty);
            } else {
                const list = document.createElement('ul');
                /** The border goes on each item (DESIGN.md § Lists), not on a container divider. */
                list.className = 'flex flex-col';

                for (const event of mealEvents) {
                    list.appendChild(this.renderListItem(event));
                }

                fragment.appendChild(list);
            }

            this.$refs.list.replaceChildren(fragment);
        },

        /**
         * History item with the shape of DESIGN.md § Lists: #E2E8F0 bottom border, 14px/16px
         * padding, 48px minimum height (touch target, Do's #2), 20px guide icon in #0077B6.
         *
         * The meal is painted readable, not as a JSON dump: a chip with the meal type and, for each
         * food, a chip with "name" and, in monospace, "quantity unit", because they are a
         * measurement value (Do's #7).
         *
         * The `<li>` does NOT carry `hover:` or `active:`: DESIGN.md § Lists reserves those two
         * states for a pressable list element, and this is neither link nor button —it has no
         * destination, no handler and no focus—. Promising an interaction that does not happen is
         * worse than not promising it. Same criterion as the glucose list.
         *
         * @param {{id: string, occurredAt: string, content: object}} event
         * @returns {HTMLLIElement}
         */
        renderListItem(event) {
            const described = describeMealEvent(this.catalog, event.content);

            const item = document.createElement('li');
            item.className = 'flex min-h-12 items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            item.appendChild(createIcon('cake', 'mt-0.5 size-5 shrink-0 text-accent'));

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-2';

            /** Content with no meal type paints no empty chip: it is left out. */
            if (described.mealTypeLabel !== '') {
                const header = document.createElement('div');
                header.className = 'flex flex-wrap items-center gap-2';
                header.appendChild(createStatusChip(described.mealTypeLabel));
                body.appendChild(header);
            }

            if (described.foods.length === 0) {
                const noFoods = document.createElement('p');
                noFoods.className = 'text-body-sm text-ink-secondary';
                noFoods.textContent = t('meals.noFoods');
                body.appendChild(noFoods);
            } else {
                const foods = document.createElement('div');
                foods.className = 'flex flex-wrap items-center gap-2';

                for (const food of described.foods) {
                    /** Quantity and unit are a measurement value: they go in monospace (Do's #7). */
                    foods.appendChild(createFoodChip(food.name, `${food.quantity} ${food.unitLabel}`));
                }

                body.appendChild(foods);
            }

            if (described.note !== null) {
                const note = document.createElement('p');
                note.className = 'text-body-sm text-ink-secondary';
                note.textContent = described.note;
                body.appendChild(note);
            }

            /**
             * Secondary text: timestamp (numeric → monospace, in the Code size of § Typography)
             * and, if there is one, the device. Same date format as the other histories:
             * `formatDateTime`, in the active language.
             */
            const meta = document.createElement('p');
            meta.className = 'font-mono text-code text-ink-secondary';
            meta.textContent = described.device !== null
                ? `${formatDateTime(event.occurredAt)} · ${described.device}`
                : formatDateTime(event.occurredAt);
            body.appendChild(meta);

            item.appendChild(body);

            return item;
        },
    };
}
