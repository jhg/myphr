/**
 * Button to install the panel on the home screen.
 *
 * **Why we need a button of our own.** The application is already installable —manifest, icons and
 * the service worker of `public/sw.js`, which caches nothing on purpose—, but offering the
 * install was left entirely to the browser, and there each one does as it pleases: Chrome hides it
 * in the three-dot menu, Edge in the address bar, and **iOS Safari never offers it**. On iOS the
 * only way is "Share" → "Add to Home Screen", which nobody finds unless they know. A visible
 * button in the panel brings the three situations together in one place.
 *
 * **Why the decision lives here and not in the Filament user menu.** That menu is built in PHP
 * when the panel is registered, and here there is nothing the server can know: whether the browser
 * accepts installing depends on a client event (`beforeinstallprompt`) that arrives —or not—
 * after painting, and on whether the application is already installed, which only `matchMedia`
 * knows. A server-rendered menu item would also show up in desktop Firefox, where pressing it can
 * do absolutely nothing.
 *
 * **The two branches, and why they really are different:**
 *
 * 1. *Chromium* (Chrome, Edge, Android). It fires `beforeinstallprompt`. `preventDefault()` is
 *    called on it so the browser does not raise its own notice —we would have two offers
 *    competing— and the event is stored, as it is the only thing able to open the real dialog. An
 *    event **is spent when used**: after `prompt()` it is no good a second time, so it is dropped
 *    and the button disappears, whether the person accepts or declines. The browser will send a
 *    new one if it again considers the install timely.
 * 2. *iOS Safari* (iPhone and iPad). `beforeinstallprompt` **does not exist** in WebKit and there
 *    is no API that opens the install dialog: it is not that we do not use it, it is that there
 *    is none. There the button can install nothing, and the only honest thing it can do is say
 *    where the system option is. That is why this branch shows text instead of calling anything.
 *
 * In any other case the button is not painted. With no event and no iOS there is nothing to offer,
 * and a button that on press explains it cannot do its job is worse than no button.
 *
 * The stored event lives in the scope of this module, not in the Alpine component, and that is the
 * reason the module exists apart from the template: the panel navigates as an SPA and replaces the
 * whole `<body>`, so the component is rebuilt on every screen while the event —which arrives once,
 * usually on opening— has to survive those navigations. It is the same reason the master key lives
 * in the scope of `auth/keyring.js` (ADR 0003).
 */

/**
 * The `BeforeInstallPromptEvent` the browser handed us, or `null` if it has not arrived or is spent.
 *
 * @type {{prompt: () => Promise<unknown>}|null}
 */
let deferredPrompt = null;

/**
 * Our own event, used to tell an already painted button that install availability has changed (the
 * browser offer arrived, or the application has just been installed).
 */
const AVAILABILITY_EVENT = 'phr:install-availability';

/**
 * Is it already running as an installed application?
 *
 * Two checks because they are two worlds: `display-mode: standalone` is the standard Chromium
 * answers, and `navigator.standalone` is the non-standard WebKit property, the only signal on iOS.
 * If either says yes, there is nothing to install and the button is pointless.
 *
 * @param {Window} win
 * @returns {boolean}
 */
export function isInstalled(win) {
    if (win?.navigator?.standalone === true) {
        return true;
    }

    return win?.matchMedia?.('(display-mode: standalone)')?.matches === true;
}

/**
 * Is it an iPhone or an iPad?
 *
 * The iPad on iPadOS lies in its `userAgent` and presents itself as a desktop Mac, so the string
 * is not enough: we add that a real Mac has no touch screen, hence the `maxTouchPoints`. The
 * browser is not told apart because on iOS **all** of them are WebKit by platform rule: iPhone
 * Chrome and Firefox have exactly the same limitation as Safari.
 *
 * @param {Window} win
 * @returns {boolean}
 */
export function isIos(win) {
    const nav = win?.navigator;

    if (nav === undefined || nav === null) {
        return false;
    }

    const agent = String(nav.userAgent ?? '');

    if (/iPhone|iPad|iPod/.test(agent)) {
        return true;
    }

    return /Macintosh/.test(agent) && Number(nav.maxTouchPoints ?? 0) > 1;
}

/**
 * What the button can offer right now.
 *
 * A pure function, kept apart from everything else so the four situations can be tested without a
 * browser. The order matters: "already installed" always wins, because on iOS an installed app is
 * still detected as iOS.
 * @param {{installed: boolean, ios: boolean, hasPrompt: boolean}} signals
 * @returns {'hidden'|'prompt'|'ios'}
 */
export function installMode({ installed, ios, hasPrompt }) {
    if (installed) {
        return 'hidden';
    }

    if (hasPrompt) {
        return 'prompt';
    }

    return ios ? 'ios' : 'hidden';
}

/**
 * Starts listening to the browser. Called once from `app.js`, when the module is evaluated.
 *
 * It has to hook in as early as possible: `beforeinstallprompt` fires without warning and does not
 * repeat, so a listener added when Alpine mounts the button would arrive late on the first load.
 *
 * @param {Window} win
 * @returns {void}
 */
export function captureInstallPrompt(win) {
    win.addEventListener('beforeinstallprompt', (event) => {
        /** Without this the browser raises its own notice and there would be two install offers at once. */
        event.preventDefault();
        deferredPrompt = event;
        win.dispatchEvent(new CustomEvent(AVAILABILITY_EVENT));
    });

    /**
     * Installed from the button itself or from the browser menu: the stored event is no longer any
     * good and the button has to go without waiting for the page to reload.
     */
    win.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        win.dispatchEvent(new CustomEvent(AVAILABILITY_EVENT));
    });
}

/**
 * Alpine component of the button (`x-data="phrInstallButton"`).
 *
 * @param {Window} [win]
 * @returns {object}
 */
export function installButton(win = window) {
    return {
        /** @type {'hidden'|'prompt'|'ios'} */
        mode: 'hidden',

        /**
         * iOS hint, visible only after pressing: it is an answer, not a permanent notice.
         *
         * The text is not built here, the template writes it with `__()`: it is a fixed sentence,
         * with no data, and painting it in Blade keeps it in the same place as the rest of the
         * panel text instead of splitting the translation between `lang/` and the client catalogs.
         */
        hintVisible: false,

        /** Live listener on `window`, stored so it can be removed when the component is destroyed. */
        onAvailability: null,

        init() {
            this.refresh();

            /**
             * The event may arrive after the button mounts —the normal case on a reload— and also
             * before, if the person navigated to another screen. Both are covered: the late arrival
             * here, and in `refresh()` the one already stored at mount time.
             */
            this.onAvailability = () => this.refresh();
            win.addEventListener(AVAILABILITY_EVENT, this.onAvailability);
        },

        /**
         * The listener is on `window`, which survives SPA navigation, while the component is
         * rebuilt on every screen: without removing it, one listener per visited screen would pile
         * up, all pointing at components already unmounted.
         */
        destroy() {
            win.removeEventListener(AVAILABILITY_EVENT, this.onAvailability);
            this.onAvailability = null;
        },

        refresh() {
            this.mode = installMode({
                installed: isInstalled(win),
                ios: isIos(win),
                hasPrompt: deferredPrompt !== null,
            });

            if (this.mode !== 'ios') {
                this.hintVisible = false;
            }
        },

        async install() {
            if (this.mode === 'ios') {
                /** On iOS there is no dialog to open: all we can do is point at where the option is. */
                this.hintVisible = !this.hintVisible;

                return;
            }

            const event = deferredPrompt;

            if (event === null) {
                this.mode = 'hidden';

                return;
            }

            /**
             * It is dropped **before** awaiting the answer: the event is already spent as soon as
             * `prompt()` is called, and keeping it while the dialog is open would allow a second
             * click that would fail with a browser exception.
             */
            deferredPrompt = null;
            this.mode = 'hidden';

            try {
                await event.prompt();
            } catch {
                /**
                 * Dismissing the dialog, or clicking twice too fast, throws. There is nothing to
                 * report: the person has just seen the dialog and knows better than us what they chose.
                 */
            }
        },
    };
}
