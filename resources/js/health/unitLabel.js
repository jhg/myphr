/**
 * Readable label of a unit of measure, out of the catalog the server emits.
 *
 * UCUM reserves brackets for non-metric units: the pound is `[lb_av]` and Fahrenheit is
 * `[degF]`. The envelope stores that code, because ADR 0005 demands it, but showing it as is in
 * the history would be asking the person to read interchange notation. For an unknown code it
 * returns the code itself, which is ugly but true: it is better than hiding a
 * record.
 *
 * It used to be duplicated in `bodyWeightPage.js` and `temperaturePage.js`, and the price of them
 * diverging was the same unit being shown differently depending on the screen; it is read from the
 * same catalog and with the same key, so there is nothing for the screen to decide.
 *
 * It lives apart from `datetimeLocal.js` on purpose: that one produces AEAD associated data and
 * this one is screen text. Merging them into a "utilities" module would mix two things with no
 * shared risk and no shared reason to change, which is what `eventCommonFields.js` avoids by being one concept.
 *
 * `heightUnitLabel` (weight) and `siteLabel` (temperature) have this shape but read another list
 * of the catalog and are not duplicated: they stay in their screen instead of forcing a generic
 * lookup by key in here.
 *
 * @param {{units: list<{code: string, label: string}>}} catalog
 * @param {string} code
 * @returns {string}
 */
export function unitLabel(catalog, code) {
    return catalog.units.find((row) => row.code === code)?.label ?? code;
}
