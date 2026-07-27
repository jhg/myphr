/**
 * Navigation after login and hard reload after sign-out (Spec 0001 §5, step 20, and §8).
 *
 * Two different operations that must not be mixed up:
 *
 * * `navigate()` keeps the JavaScript context, and with it the master key in memory. That is
 *   what is needed when signing in: a hard reload here would kill the key right after it was
 *   born.
 * * `hardReload()` destroys the JavaScript context, and with it the DOM snapshots Livewire
 *   keeps with decrypted data (ADR 0003). That is what is needed when signing out, and only
 *   **after** the server confirms the sign-out (§4.6).
 */

/**
 * Navigates without reloading. Uses the Alpine router when it exists; otherwise it falls back to
 * a normal navigation, which is correct even though it costs the key in memory.
 *
 * @param {string|undefined} url
 */
export function navigate(url) {
    if (typeof url !== 'string' || url === '') {
        return;
    }

    if (typeof window.Alpine?.navigate === 'function') {
        window.Alpine.navigate(url);

        return;
    }

    window.location.assign(url);
}

/**
 * Hard reload. `location.reload()` may be served from the back-forward cache; assigning the
 * target URL to `href` is not.
 *
 * @param {string} url
 */
export function hardReload(url) {
    window.location.href = url;
}
