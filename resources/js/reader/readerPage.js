/**
 * The screen the professional opens (ADR 0011).
 *
 * Whoever lands here **has no account, does not know this application and is in an appointment**.
 * The screen is written for that person: one single thing to do (type the PIN), an explained wait
 * while the key is derived, and then the whole clipping, with the **same** interface the patient
 * sees in their panel: charts, statistics, timeline, search and sub-periods, plus the usual
 * clinical table to read and print. All of that is painted by `clippingExplorer.js`, the same
 * module the preview of the share screen uses: if this screen had its own copy, patient and doctor
 * would end up looking at two different documents of the same data.
 *
 * **What this page does not do, and it is deliberate:**
 *
 * * It uses no Livewire, no Filament and no cookie. The route already drops the session and the
 *   CSRF (`routes/web.php`), and `fetch` goes with `credentials: 'omit'` so that not even a
 *   cookie the browser already had gets sent: a cookie here would be a stable identifier of a
 *   professional, correlatable across the clippings of two different patients.
 * * It cannot ask for one more event. The only endpoint serving clinical data is the one already
 *   behind the PIN, and what it delivers is the whole package at once. Narrowing the sub-period
 *   or searching text works on what is already decrypted in memory: the professional can
 *   **narrow** what they look at, never widen it beyond the clipping the patient chose to share.
 * * It writes nothing on the device. No `localStorage`, no `sessionStorage`, no IndexedDB, no
 *   cookie, not even the language preference: the decrypted package lives in the memory of this
 *   tab and closing it wipes it, just like the patient's master key (ADR 0003).
 * * It shows nothing of the patient's account. It does not show it because it does not have it:
 *   the server sends no name, no email, no clipping count. All that arrives is the encrypted package.
 * * It does not tell failure causes apart. Non-existent link, expired, revoked and wrong PIN give
 *   the **same** message, because telling them apart would turn this page into an oracle of which
 *   clippings are still alive. What can be said, and is said, is how many attempts have been made
 *   from this browser.
 *
 * **The cryptographic order** (ADR 0011): `challenge` gives the salt → Argon2id stretches the PIN
 * once → out of that stretching come the `pinTag` (which is sent) and, afterwards, the `wrapKey`
 * (which never leaves here) → `open` returns wrapper and package only if the PIN matches → the
 * `wrapKey` opens the wrapper and takes out `CK` → `CK` opens the package. The server sees no PIN,
 * no `S`, no `CK`, and not a single line of the content.
 *
 * The logic that can be tested without a DOM lives in `clinicalReport.js`, in
 * `clippingExplorer.js` and in the exported functions of this module (`tests/js/readerPage.test.mjs`,
 * `tests/js/clippingExplorer.test.mjs`).
 */

import { canonicalDate } from '../crypto/canonicalDate.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { openSharePackage, ShareEnvelopeError } from '../crypto/shareEnvelope.js';
import { derivePinTag, deriveWrapKey, normalizePin, PIN_LENGTH, stretchPinAsync } from '../crypto/shareKeys.js';
import { decodeShareFragment, openShareWrapper } from '../crypto/shareLink.js';
import { zeroize } from '../crypto/zeroize.js';
import { decodeBase64Url, encodeBase64Url } from '../crypto/base64url.js';
import { setLocale, textDirection, t } from '../i18n/index.js';
import { resolveCatalog } from './clinicalReport.js';

/**
 * The clipping view —and with it Chart.js, which is the bulk of it— is **not** imported here at the
 * top. Statically it lands in the same chunk as this file, and the browser would have to download
 * and evaluate 391 KB before painting a PIN field that needs none of it: the professional stares at
 * a card with no title on a mobile connection, which is the first of the "slow steps" they report.
 *
 * Loading it starts as soon as the screen mounts, so it travels **while the PIN is being typed and
 * while Argon2id runs** — time that is already being spent — and by the time the package is
 * decrypted it is normally here. `renderReport()` awaits it, so it is correct even if it is not.
 *
 * @type {Promise<typeof import('./clippingExplorer.js')>|null}
 */
let explorerModule = null;

/** @returns {Promise<typeof import('./clippingExplorer.js')>} */
function loadExplorer() {
    explorerModule ??= import('./clippingExplorer.js');

    return explorerModule;
}

/**
 * Waits for the browser to actually paint.
 *
 * Two frames, not one: the first is scheduled before the DOM change has been laid out, so only the
 * second guarantees that what reached the screen includes it. It is used before the one stretch of
 * this screen that still blocks the thread on purpose —building the charts— so that the state
 * announced just before it is seen rather than skipped.
 *
 * @returns {Promise<void>}
 */
function nextPaint() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/** Error of this screen: caused by what was typed or by what the server answered. */
export class ReaderError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'ReaderError';
    }
}

/**
 * Reads the URL fragment, which is where `S` and the generation instant travel.
 *
 * **The fragment never reaches the server**, and that is exactly the half that makes a database
 * dump not enough to read the clipping. But it is easily lost: the URL rewriters of healthcare
 * mail and captive portals eat the `#`, and then the link arrives incomplete. That is why, if it
 * is missing, we warn **before** touching the server: asking for the PIN only to end in a
 * decryption error would spend one of the five attempts on a problem that is not the PIN's.
 *
 * @param {string} hash Value of `location.hash`, with or without the `#`.
 * @returns {{sendKey: Uint8Array, generatedAt: Date}}
 * @throws {ReaderError} If there is no fragment or it does not have the expected shape.
 */
export function readFragment(hash) {
    const raw = typeof hash === 'string' ? hash.replace(/^#/, '').trim() : '';

    if (raw === '') {
        throw new ReaderError(t('reader.error.noFragment'));
    }

    try {
        return decodeShareFragment(raw);
    } catch {
        throw new ReaderError(t('reader.error.badFragment'));
    }
}

/**
 * PIN exactly as typed: six digits, no spaces and no separators.
 *
 * It is cleaned before checking because whoever dictates it usually says it in two halves ("four
 * two one, eight zero three") and whoever types it writes the space. Rejecting that would spend an
 * attempt on a space.
 *
 * @param {string} value
 * @returns {string} Exactly `PIN_LENGTH` digits.
 * @throws {ReaderError} If it is not.
 */
export function sanitizePin(value) {
    const digits = (typeof value === 'string' ? value : '').replace(/[\s-]/g, '');

    if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(digits)) {
        throw new ReaderError(t('reader.error.badPin', { length: PIN_LENGTH }));
    }

    return normalizePin(digits);
}

/**
 * Message of a failed attempt.
 *
 * It says how many attempts have been made **from this browser**, in those words, and not "you
 * have N left": the real counter lives in a server column and never leaves it, because answering
 * "you have 4 left" about a link that never existed would reveal which ones exist. Counting them
 * here is an oracle of nothing and it is what the person needs to know whether they have room left.
 *
 * @param {number} used Failed attempts in this tab.
 * @param {number} max Attempt cap of the link (`ShareLink::MAX_ATTEMPTS`).
 * @returns {string}
 */
export function attemptMessage(used, max) {
    if (used >= max) {
        return `${t('reader.error.generic')} ${t('reader.error.attemptsSpent', { max })}`;
    }

    return `${t('reader.error.generic')} ${t('reader.error.attempts', { used, max })}`;
}

/**
 * Translates any failure into something readable, never saying which failure it is when the cause
 * is on the link side.
 *
 * `EnvelopeError` and `ShareEnvelopeError` do get a message of their own: by then the PIN was
 * already correct (the server delivered the package), so what fails is the integrity of what was
 * delivered, and that has to be said out loud, never showing the content half-way (ADR 0004).
 *
 * @param {unknown} failure
 * @returns {string}
 */
export function describeReaderError(failure) {
    if (failure instanceof ReaderError) {
        return failure.message;
    }

    if (failure instanceof EnvelopeError || failure instanceof ShareEnvelopeError) {
        return t('reader.error.tampered');
    }

    return t('reader.error.network');
}

/**
 * JSON request against the two public reader routes.
 *
 * `credentials: 'omit'` is not cosmetic: without it the browser would send any cookie it already
 * had for this domain —the panel session, if whoever opens the link is also a user— and that
 * cookie would tie the reading of a clipping to a concrete account in the logs of any
 * intermediary. There is no CSRF because there is no session to forge (ADR 0011).
 *
 * @param {string} url
 * @param {object} body
 * @returns {Promise<{status: number, data: object|null}>}
 */
async function post(url, body) {
    let response;

    try {
        response = await fetch(url, {
            method: 'POST',
            credentials: 'omit',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', Accept: '*/*' },
            body: JSON.stringify(body),
        });
    } catch {
        throw new ReaderError(t('reader.error.network'));
    }

    const text = await response.text();
    let data = null;

    try {
        data = JSON.parse(text);
    } catch {
        data = null;
    }

    return { status: response.status, data };
}

/**
 * First step of ADR 0011: asks for the salt the PIN is stretched with.
 *
 * It is its own function because it does not depend on the PIN, and that is worth exploiting: the
 * screen fires it while the page is still loading, so by the time the professional has typed six
 * digits the salt is already here and one full round trip has left the critical path. Nothing about
 * the request changes by happening earlier — it takes no PIN, consumes no attempt, and the server
 * answers the same 16 bytes to anyone who asks (`ShareLinkGate::challenge()`), a deterministic
 * decoy when the link is dead. What changes is only *when* it happens.
 *
 * The salt always arrives, whether the link exists or not, so this screen cannot tell a live link
 * from a dead one: Argon2id runs all the same and the failure arrives later, in `open`.
 *
 * @param {{challenge: string}} endpoints
 * @returns {Promise<Uint8Array>} 16 bytes.
 */
export async function requestPinSalt(endpoints) {
    const challenge = await post(endpoints.challenge, {});

    if (challenge.status !== 200 || typeof challenge.data?.pinSalt !== 'string') {
        throw new ReaderError(t('reader.error.network'));
    }

    return decodeBase64Url(challenge.data.pinSalt, 'pin salt');
}

/**
 * Opens the whole clipping: PIN → salt → Argon2id → proof → package → content in the clear.
 *
 * All key material is wiped in the `finally` with `zeroize` (ADR 0004): the PIN stretching opens
 * the wrapper and `CK` opens the package, so leaving them in memory after use is leaving the
 * clipping open on a device that belongs to nobody in this conversation.
 *
 * @param {object} params
 * @param {{challenge: string, open: string}} params.endpoints
 * @param {string} params.linkId
 * @param {string} params.pin Already cleaned by `sanitizePin`.
 * @param {Uint8Array} params.sendKey `S`, from the fragment.
 * @param {Date} params.generatedAt Generation instant, from the fragment.
 * @param {(fraction: number) => void} [params.onProgress] Real Argon2id progress.
 * @param {Promise<Uint8Array>} [params.pinSalt] Salt already being fetched by {@see requestPinSalt}.
 * @returns {Promise<object>} Package body in the clear.
 */
export async function openClipping({ endpoints, linkId, pin, sendKey, generatedAt, onProgress, pinSalt: pending }) {
    /** @type {Uint8Array|null} */
    let stretched = null;
    /** @type {Uint8Array|null} */
    let pinTag = null;
    /** @type {Uint8Array|null} */
    let wrapKey = null;
    /** @type {Uint8Array|null} */
    let contentKey = null;

    try {
        const pinSalt = await (pending ?? requestPinSalt(endpoints));

        stretched = await stretchPinAsync({ pin, pinSalt, onProgress });
        pinTag = derivePinTag({ stretched, pinSalt, linkId });

        const opened = await post(endpoints.open, { pinTag: encodeBase64Url(pinTag) });

        if (opened.status !== 200 || typeof opened.data?.package !== 'string') {
            throw new ReaderError('');
        }

        const { wrapper, package: packageEnvelope, shareId, expiresAt } = opened.data;

        /**
         * `expiresAt` and `shareId` are set by the server and go into the associated data of both
         * layers, so there is no need to trust them: if it lied about either, the wrapper or the
         * package would stop opening and the integrity warning would show. The generation instant
         * does not come from there: it comes from the fragment, which the server never sees.
         */
        wrapKey = deriveWrapKey({ stretched, sendKey, pinSalt, linkId, expiresAt });

        contentKey = openShareWrapper({
            wrapKey,
            wrapper,
            linkId,
            expiresAt,
            packageEnvelope,
        });

        return await openSharePackage({
            contentKey,
            envelope: packageEnvelope,
            shareId,
            generatedAt: canonicalDate(generatedAt),
        });
    } finally {
        for (const material of [stretched, pinTag, wrapKey, contentKey]) {
            if (material !== null) {
                zeroize(material);
            }
        }
    }
}

/**
 * Starts the screen over the DOM of `resources/views/share/reader.blade.php`.
 *
 * The contract is the set of `data-phr-reader-*` of that view. If any were missing, the page would
 * paint and respond to nothing, so they are all read up here and at once.
 *
 * @param {Document} document
 * @param {Window} window
 * @returns {void}
 */
export function startReaderPage(document, window) {
    const config = JSON.parse(document.querySelector('[data-phr-reader-config]').textContent);
    const catalog = JSON.parse(document.querySelector('[data-phr-reader-catalog]').textContent);

    const nodes = {
        unlock: document.querySelector('[data-phr-reader-unlock]'),
        form: document.querySelector('[data-phr-reader-form]'),
        pin: document.querySelector('[data-phr-reader-pin]'),
        submit: document.querySelector('[data-phr-reader-submit]'),
        error: document.querySelector('[data-phr-reader-error]'),
        progress: document.querySelector('[data-phr-reader-progress]'),
        progressBar: document.querySelector('[data-phr-reader-progress-bar]'),
        progressStage: document.querySelector('[data-phr-reader-progress-stage]'),
        report: document.querySelector('[data-phr-reader-report]'),
        locales: document.querySelector('[data-phr-reader-locales]'),
        print: document.querySelector('[data-phr-reader-print]'),
    };

    const state = {
        locale: setLocale(config.locale),
        /**
         * Package body already decrypted. It lives in the memory of this tab and dies on reload: it
         * is not written to `localStorage`, nor to `sessionStorage`, nor to IndexedDB, nor to any
         * cookie. Closing the tab wipes it, which is the only real guarantee on somebody else's computer.
         */
        body: null,

        /** Mounted view of the clipping ({@see renderClippingExplorer}), so it can be unmounted. */
        explorer: null,
        attempts: 0,
        busy: false,
        /** @type {{sendKey: Uint8Array, generatedAt: Date}|null} */
        fragment: null,
        /** Salt request already in flight ({@see requestPinSalt}). */
        pinSalt: null,
        error: '',
    };

    /**
     * The fragment is read **once** and erased from the address bar right afterwards with
     * `history.replaceState` (ADR 0011). It does not remove it from the browser history —a page
     * cannot do that—, but it does keep it from staying in plain sight on a clinic screen and from
     * being copied by accident when the address is shared.
     */
    try {
        state.fragment = readFragment(window.location.hash);
    } catch (failure) {
        state.error = describeReaderError(failure);
    }

    window.history.replaceState(null, '', window.location.pathname);

    renderStaticText();
    renderLocaleChoices();
    renderError();

    /**
     * Two things start now and are waited on later, so that the two idle stretches of this
     * screen —the person reading the card and typing six digits, and the seconds of Argon2id— are
     * spent on the network instead of being spent twice.
     *
     * The salt is only asked for when the link came whole: with no fragment there is nothing to
     * open, and a request for a link nobody can read is a request that says this identifier was
     * visited, for no gain.
     */
    if (state.fragment !== null) {
        state.pinSalt = requestPinSalt(config.endpoints);

        /**
         * A salt that failed to arrive is dropped, so the next attempt asks again instead of
         * replaying the same rejection for ever. This handler is also what keeps the browser from
         * logging it as unhandled, since nothing is awaiting the promise yet.
         */
        state.pinSalt.catch(() => {
            state.pinSalt = null;
        });
    }

    void loadExplorer().catch(() => {});

    nodes.form.addEventListener('submit', (event) => {
        event.preventDefault();
        void unlock();
    });

    nodes.print.addEventListener('click', () => window.print());

    /** Fixed texts of the shell. Painted from here so the language selector can change them. */
    function renderStaticText() {
        for (const element of document.querySelectorAll('[data-phr-reader-text]')) {
            element.textContent = t(element.dataset.phrReaderText);
        }

        document.documentElement.lang = state.locale.replace('_', '-');
        document.documentElement.dir = textDirection(state.locale);
        nodes.pin.setAttribute('inputmode', 'numeric');
        nodes.pin.setAttribute('maxlength', String(PIN_LENGTH + 2));
    }

    /**
     * Language selector.
     *
     * The page arrives in the language of the professional's `Accept-Language`, which is the
     * browser's and not necessarily theirs: in a clinic the machine is usually in whatever language
     * the person who installed it left. The selector changes the language **without reloading and
     * without asking the server for anything**, because the catalog brings all supported languages
     * inside, and
     * without writing any preference anywhere: a language cookie would be exactly the cookie this route drops.
     */
    function renderLocaleChoices() {
        nodes.locales.replaceChildren();

        for (const option of catalog.locales) {
            const button = document.createElement('button');

            button.type = 'button';
            button.textContent = option.label;
            button.setAttribute('aria-pressed', String(option.code === state.locale));
            button.className = option.code === state.locale
                ? 'min-h-9 rounded-control border-[1.5px] border-accent bg-accent px-3 py-1.5 text-button text-accent-ink'
                : 'min-h-9 rounded-control border-[1.5px] border-border-strong px-3 py-1.5 text-button text-accent hover:bg-surface-hover';
            button.addEventListener('click', () => {
                state.locale = setLocale(option.code);
                renderStaticText();
                renderLocaleChoices();
                renderError();
                void renderReport();
            });

            nodes.locales.appendChild(button);
        }
    }

    function renderError() {
        nodes.error.textContent = state.error;
        nodes.error.hidden = state.error === '';
    }

    /**
     * Argon2id with the OPAQUE KSF parameters takes from one to several seconds, and on a clinic
     * machine it can take much longer. With nothing on screen that reads as a hung page, so the bar
     * advances with the **real** progress the stretching reports and the text says what is going
     * on: that it is decrypting, not that it has stopped.
     *
     * @param {string} stage
     * @param {number} fraction
     */
    function renderProgress(stage, fraction) {
        nodes.progress.hidden = !state.busy;
        nodes.progressStage.textContent = stage;
        nodes.progressBar.style.transform = `scaleX(${fraction})`;
        nodes.progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    }

    async function unlock() {
        if (state.busy || state.fragment === null) {
            return;
        }

        state.error = '';
        renderError();

        let pin = '';

        try {
            pin = sanitizePin(nodes.pin.value);
        } catch (failure) {
            state.error = describeReaderError(failure);
            renderError();

            return;
        }

        state.busy = true;
        nodes.submit.disabled = true;
        renderProgress(t('reader.stage.deriving'), 0.05);

        try {
            const body = await openClipping({
                endpoints: config.endpoints,
                linkId: config.linkId,
                pin,
                pinSalt: state.pinSalt ?? undefined,
                sendKey: state.fragment.sendKey,
                generatedAt: state.fragment.generatedAt,
                onProgress: (fraction) => renderProgress(t('reader.stage.deriving'), 0.05 + fraction * 0.85),
            });

            /**
             * The full bar is painted **before** the report is built, and we wait for the paint.
             * Building it is a synchronous stretch of Chart.js work, so without this wait the 100 %
             * would be written to a DOM that goes straight into that stretch and never gets shown:
             * the bar would stop at 90 % and the screen would sit there with no explanation.
             */
            state.body = body;
            renderProgress(t('reader.stage.rendering'), 1);
            await nextPaint();

            nodes.unlock.hidden = true;
            await renderReport();
        } catch (failure) {
            /**
             * A `ReaderError` with no message is the generic server failure: it does not exist, it
             * expired, it was revoked or the PIN was wrong. All four arrive here exactly alike, and
             * here we add the only thing we can tell, the attempts made from this browser.
             */
            if (failure instanceof ReaderError && failure.message === '') {
                state.attempts += 1;
                state.error = attemptMessage(state.attempts, config.maxAttempts);
            } else {
                state.error = describeReaderError(failure);
            }

            renderError();
        } finally {
            /** The PIN does not stay in the field: the tab may be left open in a shared room. */
            nodes.pin.value = '';
            state.busy = false;
            nodes.submit.disabled = false;
            nodes.progress.hidden = true;
        }
    }

    /**
     * Paints the whole clipping. It is called again when the language changes, and then the
     * previous view is unmounted before mounting the new one: without the `destroy()`, the Chart.js
     * instance of the previous language would stay tied to a canvas no longer in the document.
     */
    async function renderReport() {
        if (state.body === null) {
            return;
        }

        const { renderClippingExplorer } = await loadExplorer();

        state.explorer?.destroy();

        nodes.report.hidden = false;
        state.explorer = renderClippingExplorer(nodes.report, {
            body: state.body,
            resolved: resolveCatalog(catalog, state.locale),
            /** Own prefix for the chart `id`s, so they do not clash with those of another screen. */
            chartPrefix: 'reader',
        });
    }
}
