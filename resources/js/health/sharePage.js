/**
 * Alpine component of the sharing screen (ADR 0011), the side of whoever owns the data: pick
 * range and types, generate the clipping, show the link, the PIN and the QR, and list and revoke
 * what is still alive.
 *
 * The DOM contract is fixed by `resources/views/phr/pages/sharing.blade.php`. As in the rest of
 * the panel: no `wire:model` and no envelope in a Livewire property (ADR 0002). Here there is also
 * an extra and harder reason: the package carries the `s1.` prefix and both ADR 0002 guard rails
 * —`livewirePayloadGuard.js` on the client and `EncryptedPayloadGuardHook` on the server— abort
 * any string longer than 256 characters that does not start with `v1.`. A package travelling over
 * Livewire would be aborted by both. That is why it goes up through `POST /phr/shares`, the
 * dedicated HTTP endpoint ADR 0002 itself reserves for large blobs, while **reading** the events
 * still goes through `$wire.fetchEvents`, the usual path, which returns `v1.` envelopes.
 *
 * **What the server sees of all this**: a blob, two dates and an identifier. Neither the range,
 * nor the types, nor how many events go inside. The range and the types travel encrypted twice, in
 * the package (for the professional) and in the descriptor (for this very screen, which paints
 * itself by decrypting it). The server does know **who** shares, **when** and **how many times**,
 * and the screen says so plainly instead of leaving it in the fine print of an ADR.
 *
 * **The order of the operations matters** and is not negotiable: first the chosen events are
 * decrypted, then the package is encrypted with `CK`, then the PIN is stretched with Argon2id, and
 * only at the end does everything go up. Stretching the PIN before knowing whether the package
 * fits would give away several seconds of waiting only to end in a size error.
 *
 * **An incomplete share is worse than none.** If the page walk falls short, the generation
 * **fails**; what could be downloaded is not shared with a warning next to it. It is the same
 * argument with which the ADR rules out chunking the package: a coherent history missing the week
 * of the hypoglycaemias cannot be told from a complete one, and whoever reads it concludes nothing
 * happened that week. For the same reason, an event that does not decrypt aborts the generation
 * instead of being left out in silence (ADR 0004: a decryption failure is always visible).
 *
 * **The preview shows the clipping with the same screen as the professional** and not with a
 * summarized version: it mounts `reader/clippingExplorer.js` over the **same** package body that
 * would be encrypted on generating ({@see buildSharePackageBody}). It is the only way for "what
 * you are about to send" to be literally what the other person will see, and it costs no new
 * exposure: they are events already decrypted in this browser, nothing goes up and no link exists yet.
 *
 * The functions exported before `sharePage()` are the pure logic of the component, testable
 * without Alpine and without a DOM (`tests/js/sharePage.test.mjs`).
 */

import { renderSVG } from 'uqr';

import { AuthRequestError, deleteJson, getJson, postJson } from '../auth/http.js';
import { isUnlocked, ownerId } from '../auth/keyring.js';
import { encodeBase64Url } from '../crypto/base64url.js';
import { canonicalDate } from '../crypto/canonicalDate.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { sealSharePackage, ShareEnvelopeError } from '../crypto/shareEnvelope.js';
import {
    deriveShareLinkKeysAsync,
    generateContentKey,
    generatePin,
    generatePinSalt,
    generateSendKey,
} from '../crypto/shareKeys.js';
import { encodeShareFragment, sealShareWrapper } from '../crypto/shareLink.js';
import { zeroize } from '../crypto/zeroize.js';
import { isStaleTabStatus } from '../guards/staleTabNotice.js';
import { currentLocale, formatDateTime, joinList, t } from '../i18n/index.js';
import { resolveCatalog } from '../reader/clinicalReport.js';
import { renderClippingExplorer } from '../reader/clippingExplorer.js';
import { dateRangeControl } from './dateRange.js';
import { openEvent } from './eventEnvelope.js';
import { progressMixin } from '../auth/progress.js';
import { openShareDescriptor, sealShareDescriptor } from './shareDescriptor.js';

/**
 * Clinical types that can be shared, in the order they are offered.
 *
 * They are the values of the `type` field of the content of an event (ADR 0006), not labels: the
 * server cannot filter by type, so filtering is exactly comparing this string with the one that
 * comes out of decrypting each envelope. The translated labels are painted by the server from
 * `Sharing::catalog()`, and `tests/Feature/SharingPageTest.php` checks that both lists still
 * match: a screen offering a type this module does not know generates empty clippings without saying so.
 *
 * @type {Readonly<list<string>>}
 */
export const SHAREABLE_TYPES = Object.freeze([
    'glucose',
    'bloodPressure',
    'insulin',
    'meal',
    'bodyWeight',
    'temperature',
]);

/**
 * Page size of the event walk and cap on pages.
 *
 * The product (5,000 events) is the hard ceiling of a clipping. It comes from no byte computation
 * —the padding ladder already takes care of that, rejecting whatever does not fit in 4 MiB— but
 * from time: five thousand envelopes are several minutes of decryption on a phone, and past that
 * the honest thing is to ask for a shorter range instead of leaving the tab hanging.
 */
const FETCH_PAGE_SIZE = 250;
const MAX_FETCH_PAGES = 20;

/**
 * Steps of the progress bar.
 *
 * The PIN stretching takes the long step because it is what really takes time: Argon2id with the
 * OPAQUE KSF parameters is between one and several seconds, measured (ADR 0011).
 */
const PROGRESS_FETCH = 0.15;
const PROGRESS_DECRYPT = 0.35;
const PROGRESS_PACKAGE = 0.5;
const PROGRESS_PIN_START = 0.5;
const PROGRESS_PIN_END = 0.9;
const PROGRESS_UPLOAD = 0.95;

/**
 * Minimum side of the QR in CSS pixels and border in modules (ADR 0011: correction M, minimum side
 * of 400 px).
 *
 * The border is four modules and not the one `uqr` ships by default (one): the "quiet zone" the
 * standard demands is four modules, and without it many readers fail when the QR sits against a
 * contrasting edge, which is exactly what happens on a light card.
 */
export const QR_MIN_SIDE_PX = 400;
export const QR_BORDER_MODULES = 4;

/** Initial type selection: all ticked. @returns {Record<string, boolean>} */
export function defaultTypeSelection() {
    return Object.fromEntries(SHAREABLE_TYPES.map((type) => [type, true]));
}

/**
 * Splits the selection into the two lists the ADR demands travel inside the package.
 *
 * **The excluded ones are written out, not implicit.** "There are no meals" and "the meals were
 * not shared" are two different things and the difference is clinical: an absence reads as a zero.
 * The professional has to be able to see they are missing because they were not sent.
 *
 * @param {Record<string, boolean>} selection
 * @returns {{included: list<string>, excluded: list<string>}}
 */
export function partitionTypes(selection) {
    const included = SHAREABLE_TYPES.filter((type) => selection?.[type] === true);
    const excluded = SHAREABLE_TYPES.filter((type) => selection?.[type] !== true);

    return { included, excluded };
}

/**
 * Expiry instant of a clipping, out of the chosen TTL.
 *
 * The client computes it and not the server because it enters the derivation of `wrapKey` and the
 * associated data of the wrapper (`canonicalDate(expiresAt)`), so it is needed **before**
 * encrypting. The server only checks that it matches one of the three options of the closed list
 * (`App\Sharing\ShareTtl`), with fifteen minutes of slack for the Argon2id and the upload.
 *
 * @param {string} token TTL token (`1h`, `24h`, `7d`).
 * @param {list<{token: string, hours: number}>} catalog Closed list the server paints.
 * @param {Date} [referenceInstant]
 * @returns {Date}
 * @throws {ShareScreenError} If the token is not in the list.
 */
export function expiryFor(token, catalog, referenceInstant = new Date()) {
    const option = (catalog ?? []).find((candidate) => candidate.token === token);

    if (option === undefined) {
        throw new ShareScreenError(t('share.error.badTtl'));
    }

    return new Date(referenceInstant.getTime() + option.hours * 60 * 60 * 1000);
}

/**
 * Package body in the clear (ADR 0011): exact range, generation instant, event count and the two
 * type lists.
 *
 * `eventCount` is not redundant with `events.length`: it is the commitment `assertShareBody()`
 * checks on opening, and it is what replaces the manifest that would be needed if the package were
 * chunked.
 *
 * @param {object} params
 * @param {list<{occurredAt: string, content: object}>} params.events Events already decrypted and
 *        filtered, from most recent to oldest.
 * @param {list<string>} params.included
 * @param {list<string>} params.excluded
 * @param {{from: string|null, to: string|null}} params.range
 * @param {Date|number|string} params.generatedAt
 * @returns {object}
 */
export function buildSharePackageBody({ events, included, excluded, range, generatedAt }) {
    return {
        v: 1,
        generatedAt: canonicalDate(generatedAt),
        range: { from: range.from ?? null, to: range.to ?? null },
        includedTypes: [...included],
        excludedTypes: [...excluded],
        eventCount: events.length,
        events: events.map((event) => ({ occurredAt: event.occurredAt, content: event.content })),
    };
}

/**
 * Content of the descriptor: the same the package says about itself, **without the events** and
 * with `CK` inside.
 *
 * `CK` lives here and nowhere else on the server, and it is what would allow rebuilding a link
 * without redoing the clipping. It goes in base64url because the descriptor is JSON.
 *
 * @param {object} params
 * @param {Uint8Array} params.contentKey
 * @param {object} params.body Package body, from which range, types and dates are copied.
 * @param {Date|number|string} params.expiresAt
 * @returns {object}
 */
export function buildShareDescriptor({ contentKey, body, expiresAt }) {
    return {
        v: 1,
        contentKey: encodeBase64Url(contentKey),
        generatedAt: body.generatedAt,
        expiresAt: canonicalDate(expiresAt),
        range: body.range,
        includedTypes: body.includedTypes,
        excludedTypes: body.excludedTypes,
        eventCount: body.eventCount,
    };
}

/**
 * Full URL of the link, with `S` and the generation instant in the fragment.
 *
 * The fragment **does not travel to the server**: it is the half that makes a database dump not
 * enough to read the clipping. It does end up in the professional's browser history and in any
 * screenshot they take, and the screen says so.
 *
 * The generation instant travels there, and is not set by the server, because the reader needs it
 * to rebuild the associated data of the package **before** decrypting and no column stores it: the
 * full why is in `SEND_FRAGMENT_LENGTH` (`crypto/shareLink.js`).
 *
 * @param {object} params
 * @param {string} params.template URL of the reader page with `{link}` to fill in.
 * @param {string} params.linkId
 * @param {Uint8Array} params.sendKey
 * @param {Date|number} params.generatedAt
 * @returns {string}
 */
export function shareUrlFor({ template, linkId, sendKey, generatedAt }) {
    return `${template.replace('{link}', linkId)}#${encodeShareFragment({ sendKey, generatedAt })}`;
}

/**
 * SVG of the QR of the **full** link, fragment included: a QR with half the URL opens nothing, and
 * the fragment is exactly the half the URL rewriters of healthcare mail eat, which is the reason
 * for offering the QR.
 *
 * Error correction M (ADR 0011): it takes 15% of damage, which covers a reflection or a finger on
 * the screen, without inflating the number of modules the way H would. With a URL of ~110
 * characters it comes out at 43x43 modules (version 6), and the capacity of that version in byte
 * mode is 134 bytes: there is slack for a considerably longer domain before going up a version.
 *
 * @param {string} url
 * @returns {string} Complete SVG, with no external resources.
 */
export function qrSvgFor(url) {
    return renderSVG(url, {
        ecc: 'M',
        border: QR_BORDER_MODULES,
        /**
         * Intrinsic size generously above the ADR minimum: the SVG scales, but starting from a big
         * side keeps a browser from rounding the modules to half a pixel and smudging the edges,
         * which is what makes a read fail at a metre away.
         */
        pixelSize: 12,
        /**
         * Literal black and white, not theme tokens. The QR does **not** switch with dark mode
         * (ADR 0011): an inverted code is read by some phones and not by others, and the one that
         * fails does so in the clinic, with the professional in front. The white background goes
         * inside the SVG itself so the dark card does not show through.
         */
        whiteColor: '#FFFFFF',
        blackColor: '#000000',
    });
}

/** Error of this screen: caused by what was chosen, not by the crypto and not by the network. */
export class ShareScreenError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'ShareScreenError';
    }
}

/**
 * Message for a failure of the Livewire call that reads the history.
 *
 * Livewire does not reject with an `Error`: it rejects with a bare
 * `{status, body, json, errors}`, so anything downstream that tests `instanceof Error` misses it and
 * falls through to the generic message. That generic message says «the clipping could not be built»,
 * and when the read is what failed, that sentence is **false in the way that matters**: it points at
 * the encryption, which never ran, and it leaves the person wondering whether something was shared.
 * Nothing was: no package was built, no link was created and no request left this screen.
 *
 * A 404 or a 419 here means this tab and this server no longer agree — the classic case is a tab
 * left open across a deploy. It is said as such, and `guards/staleTabNotice.js` puts the reload
 * button on screen at the same time.
 *
 * @param {unknown} failure
 * @returns {string}
 */
export function describeReadError(failure) {
    const status = failure?.status ?? null;

    if (isStaleTabStatus(status)) {
        return t('common.staleTab');
    }

    return status === null ? t('common.network') : t('share.error.read');
}

/**
 * Whether a rejection came from Livewire rather than from this screen's own code.
 *
 * Livewire's rejection is a plain object with a `status` key (`null` when the request never got an
 * answer). Anything that is an `Error` came from here or from the crypto modules.
 *
 * @param {unknown} failure
 * @returns {boolean}
 */
function isWireFailure(failure) {
    return failure !== null
        && typeof failure === 'object'
        && !(failure instanceof Error)
        && 'status' in failure;
}

/**
 * Translates a failure into something readable.
 *
 * The three cases with a name of their own exist because they have different fixes: the cap is
 * fixed by revoking, the size by shortening the range and the decryption by signing in again.
 *
 * @param {unknown} failure
 * @returns {string}
 */
export function describeShareError(failure) {
    if (failure instanceof ShareScreenError) {
        return failure.message;
    }

    if (isWireFailure(failure)) {
        return describeReadError(failure);
    }

    if (failure instanceof EnvelopeError) {
        return t('common.undecryptable');
    }

    if (failure instanceof ShareEnvelopeError) {
        return t('share.error.tooLarge');
    }

    if (failure instanceof AuthRequestError) {
        if (failure.code === 'share_limit_reached') {
            return t('share.error.limit');
        }

        return failure.status === null ? t('common.network') : t('share.error.upload');
    }

    if (failure instanceof Error && failure.message !== '') {
        return failure.message;
    }

    return t('share.error.generic');
}

/**
 * Range text of a clipping, already decrypted, for the list.
 *
 * A range open at the top or at the bottom is said with words ("the whole history", "from the …")
 * instead of leaving a gap: a lone dash does not tell "no limit" from "I do not know".
 *
 * @param {{from: string|null, to: string|null}} range
 * @returns {string}
 */
export function describeRange(range) {
    const from = range?.from ?? null;
    const to = range?.to ?? null;

    if (from === null && to === null) {
        return t('share.range.all');
    }

    if (to === null) {
        return t('share.range.from', { from: formatDateTime(from) });
    }

    if (from === null) {
        return t('share.range.to', { to: formatDateTime(to) });
    }

    return t('share.range.between', { from: formatDateTime(from), to: formatDateTime(to) });
}

/**
 * Alpine component factory. Registered as `phrSharePage` in `resources/js/app.js`; if it is
 * missing there, the screen paints and no button responds, with no visible error.
 *
 * @returns {object}
 */
export function sharePage() {
    return {
        ...progressMixin(),

        /**
         * The period starts at "last month", and it is asked for explicitly instead of inheriting
         * the shared default of the control: what is at stake here is not what is seen, but what
         * leaves home. A default sharing the whole history would give away years of data to somebody
         * who only wanted to show the last few weeks, and that cannot be undone, because revoking
         * does not erase what the other person already downloaded. A month covers the normal case
         * of an appointment; widening the range costs one click and the period in force is written in the control itself.
         */
        ...dateRangeControl({ preset: 'month' }),

        /** Public catalog in the clear the server paints: types, TTL, endpoints and caps. */
        config: null,

        /** Ticked types. It is interface state, not clinical data: it may go with `x-model`. */
        types: defaultTypeSelection(),

        /** Chosen TTL; the server states the default (24 hours, ADR 0011). */
        ttl: '',

        error: '',
        busy: false,

        /**
         * Result of the last generation: link, PIN and expiry. It lives **only** in the memory of
         * this tab and disappears on reload. The PIN is stored nowhere, neither here nor on the
         * server, which only holds a proof that cannot be reversed without breaking
         * Argon2id.
         *
         * @type {{shareId: string, url: string, pin: string, expiresAt: string,
         *         expiresAtLabel: string, eventCount: number}|null}
         */
        result: null,

        /** Whether the QR is on screen. While it is, the PIN is hidden (ADR 0011). */
        qrVisible: false,

        /**
         * Preview: whether it is mounted, and its controller so it can be unmounted.
         *
         * The previewed clipping **is stored in no property**: it is painted and forgotten. It is
         * the same thing the rest of this screen does with the decrypted events, and for the same
         * reason (ADR 0002): a property of a Livewire component ends up in the snapshot.
         *
         * @type {{repaint: () => Promise<void>, destroy: () => void}|null}
         */
        preview: null,
        previewVisible: false,
        previewBusy: false,
        previewError: '',

        /** Ephemeral confirmation that the link was copied. */
        copied: false,
        copiedTimer: null,

        /** Identifier of the clipping whose revocation is pending confirmation. */
        confirmingRevoke: '',

        /** Active clippings already decrypted, for the list. @type {list<object>} */
        shares: [],
        sharesError: '',
        sharesLoading: false,

        init() {
            this.config = JSON.parse(document.querySelector('[data-phr-share-catalog]').textContent);
            this.ttl = this.config.defaultTtl;

            /**
             * **The preview drops as soon as it stops matching what would be sent.**
             *
             * It is the only informed-consent surface of the whole flow, and it sits under a
             * heading that says, in those words, "this is exactly what the professional will see".
             * Without this, ticking "Meals" or switching to three months after previewing left the
             * previous clipping on screen while another one was encrypted and uploaded; and here
             * there is no way back, because revoking does not erase what the other person already
             * downloaded.
             *
             * It is hidden instead of repainted: repainting costs seconds and one request per
             * checkbox anybody touches. Pressing the button again brings it back with what is current.
             */
            for (const property of ['types', 'rangePreset', 'rangeFromDay', 'rangeToDay']) {
                this.$watch(property, () => this.hidePreview());
            }

            /**
             * The panel runs in SPA mode (`->spa()` in `PhrPanelProvider`), so leaving this screen
             * through a menu link does not fire `unload` and `hidePreview()` would never run.
             * Livewire also copies `document.documentElement.outerHTML` into its back-button cache
             * right before navigating: without this listener, a copy of the decrypted clipping
             * —notes, values, dates— of a screen already left behind would stay there.
             *
             * `once` because this component dies on navigation: the listener has to last exactly
             * until the first exit, and leaving it in place would stack one per visit, each tied to
             * an already dead component.
             */
            document.addEventListener('livewire:navigating', () => this.hidePreview(), { once: true });

            void this.loadShares();
        },

        /**
         * Contract of `dateRangeControl()`: the mixin calls `loadHistory()` when the range is applied.
         *
         * There is no history to paint here —this screen does not show the records, it only packages
         * them—, so all it does is revalidate what was typed, which is what fills or clears
         * `rangeError`. Clipping by default when the range changes would be worse: generating takes
         * seconds and costs one of the capped links, so it only happens on a press.
         */
        async loadHistory() {
            this.historyRange();
        },

        /** @returns {list<{token: string, label: string}>} Ticked types, with their label. */
        selectedTypeOptions() {
            return (this.config?.types ?? []).filter((option) => this.types[option.token] === true);
        },

        /**
         * Generates the whole clipping: decrypt, package, stretch the PIN, upload and show the result.
         *
         * Each `zeroize` below wipes key material from process memory as soon as it is no longer
         * needed (ADR 0004). It is not cosmetic: `CK` opens the package and `wrapKey` opens `CK`.
         */
        async generate() {
            if (this.busy) {
                return;
            }

            this.busy = true;
            this.error = '';
            this.result = null;
            this.qrVisible = false;
            this.resetProgress();

            /** @type {Uint8Array|null} */
            let contentKey = null;
            /** @type {Uint8Array|null} */
            let sendKey = null;
            /** @type {{pinTag: Uint8Array, wrapKey: Uint8Array}|null} */
            let linkKeys = null;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    throw new ShareScreenError(t('common.noSession'));
                }

                const { included, excluded } = partitionTypes(this.types);

                if (included.length === 0) {
                    throw new ShareScreenError(t('share.error.noTypes'));
                }

                const range = this.historyRange();

                if (this.rangeError !== '') {
                    throw new ShareScreenError(this.rangeError);
                }

                await this.advance(t('share.stage.reading'), PROGRESS_FETCH);

                const rawEvents = await this.fetchRangeEvents(range);

                await this.advance(t('share.stage.decrypting'), PROGRESS_DECRYPT);

                const events = this.decryptForSharing(rawEvents, userId, included);

                if (events.length === 0) {
                    throw new ShareScreenError(t('share.error.empty'));
                }

                await this.advance(t('share.stage.packing'), PROGRESS_PACKAGE);

                const generatedAt = new Date();
                const expiresAt = expiryFor(this.ttl, this.config.ttls, generatedAt);

                /**
                 * The identifiers are generated by the client, and they have to be UUID**v4**: v7
                 * carries the creation instant in the clear inside itself, and these end up in the
                 * URL that is shown and in the photo the professional keeps. `crypto.randomUUID()`
                 * is v4 by definition, and `App\Sharing\ClientUuid` checks the version.
                 */
                const shareId = globalThis.crypto.randomUUID();
                const linkId = globalThis.crypto.randomUUID();

                const body = buildSharePackageBody({ events, included, excluded, range, generatedAt });

                contentKey = generateContentKey();

                const packageEnvelope = await sealSharePackage({ contentKey, shareId, body });

                const descriptor = sealShareDescriptor({
                    userId,
                    shareId,
                    descriptor: buildShareDescriptor({ contentKey, body, expiresAt }),
                });

                const pin = generatePin();
                const pinSalt = generatePinSalt();
                sendKey = generateSendKey();

                await this.advance(t('share.stage.pin'), PROGRESS_PIN_START);

                linkKeys = await deriveShareLinkKeysAsync({
                    pin,
                    pinSalt,
                    linkId,
                    expiresAt,
                    sendKey,
                    onProgress: (fraction) => {
                        this.progress = PROGRESS_PIN_START + fraction * (PROGRESS_PIN_END - PROGRESS_PIN_START);
                        this.progressSeconds = 0;
                    },
                });

                const wrapper = sealShareWrapper({
                    wrapKey: linkKeys.wrapKey,
                    contentKey,
                    linkId,
                    expiresAt,
                    packageEnvelope,
                });

                await this.advance(t('share.stage.uploading'), PROGRESS_UPLOAD);

                await postJson(this.config.endpoints.shares, {
                    id: shareId,
                    payload: packageEnvelope,
                    descriptor,
                    expiresAt: canonicalDate(expiresAt),
                    link: {
                        id: linkId,
                        pinSalt: encodeBase64Url(pinSalt),
                        pinTag: encodeBase64Url(linkKeys.pinTag),
                        wrapper,
                    },
                });

                this.result = {
                    shareId,
                    url: shareUrlFor({ template: this.config.readerUrlTemplate, linkId, sendKey, generatedAt }),
                    pin,
                    expiresAt: canonicalDate(expiresAt),
                    expiresAtLabel: formatDateTime(expiresAt),
                    eventCount: events.length,
                };

                await this.advance(t('share.stage.done'), 1);

                await this.loadShares();
            } catch (failure) {
                this.error = describeShareError(failure);
                this.resetProgress();
            } finally {
                if (contentKey !== null) {
                    zeroize(contentKey);
                }

                if (sendKey !== null) {
                    zeroize(sendKey);
                }

                if (linkKeys !== null) {
                    zeroize(linkKeys.wrapKey);
                    zeroize(linkKeys.pinTag);
                }

                this.busy = false;
            }
        },

        /**
         * Walks the whole range, page by page, with the same cursor as the home dashboard: the date
         * of the oldest event of the page, which the server applies with a strict `<`.
         *
         * Falling short **is an error**, not a warning: see the module header.
         *
         * @param {{from: string|null, to: string|null}} range
         * @returns {Promise<list<{id: string, occurredAt: string, payload: string}>>}
         * @throws {ShareScreenError} If the range does not fit in the page cap.
         */
        async fetchRangeEvents(range) {
            const rawEvents = [];
            let cursor = null;

            for (let page = 0; page < MAX_FETCH_PAGES; page += 1) {
                let pageEvents;

                try {
                    /** Same positional order as `HealthEventPage::fetchEvents(?string, int, ?string, ?string)`. */
                    pageEvents = await this.$wire.fetchEvents(cursor, FETCH_PAGE_SIZE, range.from, range.to);
                } catch (failure) {
                    /**
                     * Named right here, at the only door to the server this screen reads through, so
                     * that a failure to **read** can never be reported as a failure to **encrypt**.
                     * The two have different causes and different fixes, and the honest sentence is
                     * the one that says nothing was shared.
                     */
                    throw new ShareScreenError(describeReadError(failure));
                }

                rawEvents.push(...pageEvents);

                if (pageEvents.length < FETCH_PAGE_SIZE) {
                    return rawEvents;
                }

                cursor = pageEvents[pageEvents.length - 1].occurredAt;
            }

            throw new ShareScreenError(t('share.error.tooManyEvents', { count: MAX_FETCH_PAGES * FETCH_PAGE_SIZE }));
        },

        /**
         * Decrypts the envelopes and keeps the chosen types.
         *
         * An envelope that does not open **aborts**: in the history it is counted and the walk
         * goes on, because there the person sees the whole screen and the notice next to it; in a
         * clipping travelling into other hands, a missing record cannot be told from one that never existed.
         *
         * @param {list<{id: string, occurredAt: string, payload: string}>} rawEvents
         * @param {string} userId
         * @param {list<string>} included
         * @returns {list<{occurredAt: string, content: object}>}
         * @throws {ShareScreenError} If some envelope does not open.
         */
        decryptForSharing(rawEvents, userId, included) {
            const events = [];
            let failed = 0;

            for (const rawEvent of rawEvents) {
                let content;

                try {
                    content = openEvent({
                        userId,
                        occurredAt: rawEvent.occurredAt,
                        envelope: rawEvent.payload,
                    });
                } catch {
                    failed += 1;

                    continue;
                }

                if (included.includes(content?.type)) {
                    events.push({ occurredAt: rawEvent.occurredAt, content });
                }
            }

            if (failed > 0) {
                throw new ShareScreenError(t('share.error.undecryptable', { count: failed }));
            }

            return events;
        },

        /**
         * Shows or hides the preview: the clipping of the range and types chosen right now, painted
         * with the **same** screen the professional will see.
         *
         * It happens on a press and not by default when the range changes: decrypting a month of
         * events costs seconds, and doing it every time somebody touches a checkbox would turn the
         * screen into a toaster.
         *
         * **It is not free, and it is best not to say it is.** No package is uploaded, no link is
         * created and none of the capped ones is consumed; but the events are read from the server
         * exactly as when generating, with the `from`/`to` in the clear (`occurred_at` is a column
         * in the clear, ADR 0006). The difference with the panel is attribution: the server knows
         * which component calls, so an abandoned preview tells it "they were preparing a send of
         * this range and in the end did not send it". The decryption, though, still happens
         * entirely here.
         */
        async togglePreview() {
            if (this.previewVisible) {
                this.hidePreview();

                return;
            }

            if (this.previewBusy) {
                return;
            }

            this.previewBusy = true;
            this.previewError = '';

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    throw new ShareScreenError(t('common.noSession'));
                }

                const { included, excluded } = partitionTypes(this.types);

                if (included.length === 0) {
                    throw new ShareScreenError(t('share.error.noTypes'));
                }

                const range = this.historyRange();

                if (this.rangeError !== '') {
                    throw new ShareScreenError(this.rangeError);
                }

                const events = this.decryptForSharing(await this.fetchRangeEvents(range), userId, included);

                if (events.length === 0) {
                    throw new ShareScreenError(t('share.error.empty'));
                }

                /**
                 * The **same** body that would be encrypted on generating. Building it here in
                 * another way would leave the preview showing something that is not what is sent,
                 * which is exactly what this function exists to rule out.
                 */
                const body = buildSharePackageBody({
                    events,
                    included,
                    excluded,
                    range,
                    generatedAt: new Date(),
                });

                /**
                 * The section is revealed **before** painting, and with `$nextTick` so Alpine has
                 * already applied the `x-show`. Chart.js measures the container width when it is
                 * built, and inside an element with `display: none` that width is zero: the canvas
                 * would come out one pixel wide and would not recover when shown.
                 */
                this.previewVisible = true;
                await this.$nextTick();

                this.preview = renderClippingExplorer(this.$refs.preview, {
                    body,
                    /**
                     * The reader vocabulary (catalog tokens, LOINC terms and units) is painted by
                     * the server in the catalog of this screen, in all supported languages, as in the
                     * reader page. Here it is resolved to the language in force in the panel.
                     */
                    resolved: resolveCatalog(this.config.readerCatalog, currentLocale()),
                    chartPrefix: 'share-preview',
                });
            } catch (failure) {
                this.previewError = describeShareError(failure);
                this.hidePreview();
            } finally {
                this.previewBusy = false;
            }
        },

        /**
         * Unmounts the preview. Destroying the charts is not cosmetic: leaving them alive over
         * canvases no longer in the document keeps in memory the values in the clear they drew.
         * dibujaron.
         */
        hidePreview() {
            this.preview?.destroy();
            this.preview = null;
            this.previewVisible = false;
        },

        /** Shows or hides the QR. On showing it, the PIN disappears from the screen (ADR 0011). */
        toggleQr() {
            this.qrVisible = !this.qrVisible;

            if (!this.qrVisible) {
                this.$refs.qr.replaceChildren();

                return;
            }

            /**
             * The SVG is injected as markup and not with `x-html` over a property: that way the QR
             * only exists in the DOM while it is in sight, and hiding it really erases it.
             */
            this.$refs.qr.innerHTML = qrSvgFor(this.result.url);

            const svg = this.$refs.qr.querySelector('svg');

            if (svg !== null) {
                svg.setAttribute('width', String(QR_MIN_SIDE_PX));
                svg.setAttribute('height', String(QR_MIN_SIDE_PX));
                svg.setAttribute('role', 'img');
                svg.setAttribute('aria-label', t('share.qr.alt'));
            }
        },

        /**
         * Copies **the link**, never the PIN.
         *
         * It is no oversight: the clipboard is what gets pasted into the same conversation where the
         * link has just been pasted, and both halves together in one message turn the PIN into
         * decoration. The PIN is dictated, typed or said out loud.
         */
        async copyLink() {
            try {
                await globalThis.navigator.clipboard.writeText(this.result.url);

                clearTimeout(this.copiedTimer);
                this.copied = true;
                this.copiedTimer = setTimeout(() => {
                    this.copied = false;
                    this.copiedTimer = null;
                }, 4000);
            } catch {
                this.error = t('share.error.copy');
            }
        },

        /**
         * Loads the list of active clippings and paints it by decrypting each descriptor.
         *
         * The server sends identifiers, dates and envelopes; the range and the types come from
         * opening the descriptor here, which is the only place the master key exists.
         */
        async loadShares() {
            this.sharesLoading = true;
            this.sharesError = '';

            try {
                if (!isUnlocked() || ownerId() === null) {
                    this.shares = [];
                    this.renderShares(t('common.locked.history'));

                    return;
                }

                const userId = ownerId();
                const response = await getJson(this.config.endpoints.shares);

                this.shares = response.shares.map((share) => {
                    try {
                        return {
                            ...share,
                            descriptor: openShareDescriptor({
                                userId,
                                shareId: share.id,
                                envelope: share.descriptor,
                            }),
                        };
                    } catch {
                        /**
                         * A descriptor that does not open is not left out (ADR 0004): that clipping
                         * is still alive on the server and still readable by whoever has the link
                         * and the PIN, so hiding it would be hiding something still shared. It is
                         * painted as an error row, with its revoke button, which is all that is needed.
                         */
                        return { ...share, descriptor: null };
                    }
                });

                this.renderShares(null);
            } catch (failure) {
                this.sharesError = describeShareError(failure);
            } finally {
                this.sharesLoading = false;
            }
        },

        /**
         * Asks for confirmation before revoking. Revoking is a physical and irreversible deletion,
         * so a single click cannot be enough.
         *
         * @param {string} shareId
         */
        askRevoke(shareId) {
            this.confirmingRevoke = shareId;
            this.renderShares(null);
        },

        cancelRevoke() {
            this.confirmingRevoke = '';
            this.renderShares(null);
        },

        /** @param {string} shareId */
        async revoke(shareId) {
            this.sharesError = '';

            try {
                await deleteJson(`${this.config.endpoints.shares}/${shareId}`);

                this.confirmingRevoke = '';

                /**
                 * If the link just generated is the one just revoked, the result panel disappears:
                 * leaving on screen a link and a PIN that no longer open anything is worse than not
                 * showing them, because they are taken for good.
                 */
                if (this.result !== null && this.result.shareId === shareId) {
                    this.result = null;
                    this.qrVisible = false;
                    this.$refs.qr.replaceChildren();
                }

                await this.loadShares();
            } catch (failure) {
                this.sharesError = describeShareError(failure);
            }
        },

        /**
         * Paints the list in the DOM, like the rest of the panel screens: the decrypted content is
         * written from JavaScript inside a `wire:ignore` region, so a Livewire re-render does not
         * wipe it (ADR 0002).
         *
         * @param {string|null} notice Message that replaces the list (no key, for example).
         */
        renderShares(notice) {
            const container = this.$refs.shares;

            if (notice !== null) {
                container.replaceChildren(createNote(notice));

                return;
            }

            if (this.shares.length === 0) {
                container.replaceChildren(createNote(t('share.list.empty')));

                return;
            }

            const list = document.createElement('ul');
            list.className = 'flex flex-col';

            for (const share of this.shares) {
                list.appendChild(this.renderShareItem(share));
            }

            container.replaceChildren(list);
        },

        /**
         * Row of an active clipping, with the shape of DESIGN.md § Lists.
         *
         * @param {object} share
         * @returns {HTMLLIElement}
         */
        renderShareItem(share) {
            const item = document.createElement('li');
            item.className = 'flex min-h-12 flex-wrap items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-1';

            const headline = document.createElement('p');
            headline.className = 'text-body text-ink';

            if (share.descriptor === null) {
                headline.textContent = t('share.list.undecryptable');
                headline.classList.add('text-error-ink');
            } else {
                headline.textContent = describeRange(share.descriptor.range);
            }

            body.appendChild(headline);

            if (share.descriptor !== null) {
                const types = document.createElement('p');
                types.className = 'text-body-sm text-ink-secondary';
                types.textContent = t('share.list.types', {
                    types: joinList(share.descriptor.includedTypes.map((type) => this.typeLabel(type))),
                });
                body.appendChild(types);

                const counts = document.createElement('p');
                counts.className = 'text-caption text-ink-secondary';
                counts.textContent = t('share.list.records', { count: share.descriptor.eventCount });
                body.appendChild(counts);
            }

            const expiry = document.createElement('p');
            expiry.className = 'text-caption text-ink-secondary';
            expiry.textContent = t('share.list.expires', { at: formatDateTime(share.expiresAt) });
            body.appendChild(expiry);

            /**
             * `opened_at` is the mark of the **first** access, rounded to the hour, and not a
             * download counter: no such counter exists, and the screen cannot suggest there is one.
             */
            const opened = document.createElement('p');
            opened.className = 'text-caption text-ink-secondary';
            opened.textContent = share.openedAt === null
                ? t('share.list.notOpened')
                : t('share.list.opened', { at: formatDateTime(share.openedAt) });
            body.appendChild(opened);

            item.appendChild(body);
            item.appendChild(this.renderRevokeControls(share));

            return item;
        },

        /**
         * Revoke button, in two steps. The confirmation is not a browser `confirm()`: that dialog
         * cannot be translated or styled, and on mobile it can be disabled.
         *
         * @param {object} share
         * @returns {HTMLElement}
         */
        renderRevokeControls(share) {
            const box = document.createElement('div');
            box.className = 'flex items-center gap-2';

            if (this.confirmingRevoke !== share.id) {
                const ask = document.createElement('button');
                ask.type = 'button';
                ask.className = 'inline-flex min-h-9 items-center justify-center rounded-control border-[1.5px] border-destructive px-4 py-2 text-button text-destructive-text hover:bg-error-surface focus-visible:shadow-error-halo focus-visible:outline-none';
                ask.textContent = t('share.list.revoke');
                ask.addEventListener('click', () => this.askRevoke(share.id));
                box.appendChild(ask);

                return box;
            }

            const warning = document.createElement('p');
            warning.className = 'text-helper text-error-ink';
            warning.textContent = t('share.list.confirmRevoke');
            box.appendChild(warning);

            const confirm = document.createElement('button');
            confirm.type = 'button';
            confirm.className = 'inline-flex min-h-9 items-center justify-center rounded-control bg-destructive px-4 py-2 text-button text-destructive-ink hover:bg-destructive-hover focus-visible:shadow-error-halo focus-visible:outline-none';
            confirm.textContent = t('share.list.confirmRevokeAction');
            confirm.addEventListener('click', () => {
                void this.revoke(share.id);
            });
            box.appendChild(confirm);

            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'inline-flex min-h-9 items-center justify-center rounded-control px-4 py-2 text-button text-accent hover:bg-surface-hover focus-visible:shadow-focus-blue focus-visible:outline-none';
            cancel.textContent = t('share.list.cancel');
            cancel.addEventListener('click', () => this.cancelRevoke());
            box.appendChild(cancel);

            return box;
        },

        /**
         * Translated label of a type. A token the catalog does not know is shown as is instead of
         * disappearing: a shared type that is not named is a type that looks absent.
         *
         * @param {string} token
         * @returns {string}
         */
        typeLabel(token) {
            return (this.config?.types ?? []).find((option) => option.token === token)?.label ?? token;
        },
    };
}

/**
 * Warning paragraph of the list, in the secondary text of DESIGN.md and never in a dull grey
 * (Don'ts #10).
 *
 * @param {string} message
 * @returns {HTMLParagraphElement}
 */
function createNote(message) {
    const note = document.createElement('p');
    note.className = 'text-body text-ink-secondary';
    note.textContent = message;

    return note;
}
