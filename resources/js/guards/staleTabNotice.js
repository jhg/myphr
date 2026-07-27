/**
 * What an open tab does when the server no longer recognises it.
 *
 * A tab that was served by one release and calls the next one is not an edge case in a health
 * record: people leave the panel open for days, and a deploy happens while they do. Livewire's own
 * answers to that are two, and neither of them can be shown to a patient:
 *
 * * a snapshot the server cannot place answers **404**, and Livewire dumps the raw error page into
 *   a modal — a wall of HTML with a stack trace behind it;
 * * an invalidated session or a release-token mismatch answers **419**, and Livewire calls the
 *   browser's native `confirm()` with an English sentence, untranslated in the supported locales, whose
 *   only two outcomes are "reload right now" or "nothing at all".
 *
 * Both look, to the person reading, like the screen they were on broke. This replaces them with one
 * sentence that says what actually happened and a button that fixes it.
 *
 * **It does not reload on its own.** The reload is survivable — the master key is restored from the
 * session secret on the next load (`auth/sessionBootstrap.js`) — but anything half typed into the
 * screen is not, and a form of clinical readings is exactly the thing not to throw away without
 * asking. So the tab warns and lets the person choose the moment.
 *
 * The notice is deliberately **not** rendered by the screens themselves: any of them can be the one
 * that gets caught, and a per-screen banner would be six copies of the same thing, five of which
 * would rot.
 */

import { t } from '../i18n/index.js';

/**
 * Response statuses that mean "this tab no longer matches this server".
 *
 * `404` is what `HandleRequests::handleUpdate()` answers to a snapshot naming a component it cannot
 * resolve; `419` is both the expired session and Livewire's own release-token mismatch, which is the
 * deployment case stated in so many words.
 *
 * A `500` is **not** here on purpose: that is the server breaking on work the tab asked for, and
 * telling someone to reload would hide a real failure behind a hopeful gesture.
 *
 * @type {Readonly<list<number>>}
 */
export const STALE_TAB_STATUSES = Object.freeze([404, 419]);

/** @param {unknown} status @returns {boolean} */
export function isStaleTabStatus(status) {
    return STALE_TAB_STATUSES.includes(status);
}

/** Id of the notice element, so a second failed message does not stack a second banner. */
export const STALE_TAB_NOTICE_ID = 'phr-stale-tab-notice';

/**
 * Builds and inserts the notice, once per tab.
 *
 * Every string goes in through `textContent`, never `innerHTML`: this element is built while the
 * page is already in an unknown state, and it is not the place to open a path that interprets
 * markup.
 *
 * @param {Document} [doc]
 * @param {() => void} [reload] Injected so the tests can watch it without navigating.
 * @returns {HTMLElement|null} The notice, or `null` if it was already up.
 */
export function showStaleTabNotice(doc = document, reload = () => window.location.reload()) {
    if (doc.getElementById(STALE_TAB_NOTICE_ID) !== null) {
        return null;
    }

    const notice = doc.createElement('div');

    notice.id = STALE_TAB_NOTICE_ID;
    notice.setAttribute('role', 'alert');
    notice.className = 'fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center '
        + 'gap-3 border-t border-error-outline bg-error-surface px-4 py-3';

    const message = doc.createElement('p');

    message.className = 'text-helper text-error-ink';
    message.textContent = t('common.staleTab');

    const button = doc.createElement('button');

    button.type = 'button';
    button.className = 'inline-flex min-h-11 items-center justify-center rounded-control '
        + 'border-[1.5px] border-accent px-6 py-2.5 text-button text-accent hover:bg-surface-hover '
        + 'focus-visible:shadow-focus-blue focus-visible:outline-none';
    button.textContent = t('common.reload');
    button.addEventListener('click', () => reload());

    notice.append(message, button);
    doc.body.append(notice);

    return notice;
}

/**
 * Installs the guard over Livewire.
 *
 * It hangs off the message interceptor, the same hook as `livewirePayloadGuard.js`, and calls
 * `preventDefault()` so Livewire skips its own handling of the response. That call is the whole
 * point: without it the modal or the native `confirm()` still shows, on top of this notice.
 *
 * @param {{interceptMessage?: Function}} [livewire] Defaults to `window.Livewire`.
 * @param {Document} [doc]
 * @returns {boolean} `false` if Livewire does not expose the interceptor.
 */
export function installStaleTabNotice(livewire = window.Livewire, doc = document) {
    if (typeof livewire?.interceptMessage !== 'function') {
        return false;
    }

    livewire.interceptMessage(({ onError }) => {
        onError(({ response, preventDefault }) => {
            if (!isStaleTabStatus(response?.status)) {
                return;
            }

            preventDefault();
            showStaleTabNotice(doc);
        });
    });

    return true;
}
