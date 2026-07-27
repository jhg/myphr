/**
 * Vite entry point of the reader page (ADR 0011).
 *
 * It is a **separate** entry point from `app.js` on purpose, and not one more panel module.
 * `app.js` drags in the master key ring, the idle lock, the Livewire interceptor and the Alpine
 * components of twelve screens: none of that paints here, and all of it would be code with access
 * to the same document on somebody else's device. This page loads what it needs and not one module more.
 *
 * What it does share with the panel are the event **views** (timeline, statistics and charts, with
 * Chart.js behind them), because the professional sees the same thing as the patient: a table of
 * three hundred glucose readings is not readable during an appointment. They are modules that take
 * decrypted events and return nodes, with no Livewire and no `$wire` (`resources/js/reader/clippingExplorer.js`).
 *
 * No Livewire and no Alpine: the controls are plain DOM with `addEventListener`. A reactive
 * framework here would only add surface, and the Livewire one would also send to the server
 * everything it touched (ADR 0002).
 */

import { startReaderPage } from './reader/readerPage.js';

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startReaderPage(document, window), { once: true });
} else {
    startReaderPage(document, window);
}
