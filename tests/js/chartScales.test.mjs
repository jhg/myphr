/**
 * Guard over every `scales: { ... }` block in `resources/js`: a scale with an id of our own has to
 * say whether it is horizontal or vertical.
 *
 * Chart.js only guesses the direction of a scale from its id (`x`, `y`, `r`, or an id starting with
 * one of those) or from `position`. With an id such as `marks` it can guess neither and it throws
 * `Cannot determine type of 'marks' axis. Please provide 'axis' or 'position' option.` That is
 * exactly what reached production with the glucose context chart: the failure only shows up in the
 * browser console when the canvas is painted, so no test on the data pipeline —which is what the
 * rest of `tests/js` covers— would ever have caught it.
 *
 * The check is static on purpose. Painting the charts here would mean a DOM, a canvas and a Chart.js
 * instance per chart; reading the options as source catches the same mistake in every module at
 * once, including the ones that do not exist yet.
 *
 * Node's built-in runner, like the rest of `tests/js`:
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SOURCE_ROOT = fileURLToPath(new URL('../../resources/js', import.meta.url));

/** Ids Chart.js resolves on its own, by exact match or by first letter. */
const SELF_EXPLANATORY_AXIS = /^[xyr]/;

/**
 * Every `.js` file under `resources/js`, recursively.
 *
 * @param {string} directory
 * @returns {list<string>}
 */
function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
            return sourceFiles(path);
        }

        return entry.name.endsWith('.js') ? [path] : [];
    });
}

/**
 * The same source with comments and string literals blanked out, keeping every offset.
 *
 * Without this a `position` written in prose inside a JSDoc, or a colon inside a string, would be
 * read as code. Offsets are preserved so line numbers still point at the real file.
 *
 * @param {string} source
 * @returns {string}
 */
function withoutCommentsOrStrings(source) {
    const blanked = [...source];
    let index = 0;

    /** @param {number} from @param {number} to */
    const blank = (from, to) => {
        for (let at = from; at < to && at < blanked.length; at += 1) {
            if (blanked[at] !== '\n') {
                blanked[at] = ' ';
            }
        }
    };

    while (index < source.length) {
        const pair = source.slice(index, index + 2);

        if (pair === '//') {
            const end = source.indexOf('\n', index);
            const stop = end === -1 ? source.length : end;

            blank(index, stop);
            index = stop;

            continue;
        }

        if (pair === '/*') {
            const end = source.indexOf('*/', index + 2);
            const stop = end === -1 ? source.length : end + 2;

            blank(index, stop);
            index = stop;

            continue;
        }

        const quote = source[index];

        if (quote === '\'' || quote === '"' || quote === '`') {
            let at = index + 1;

            while (at < source.length && source[at] !== quote) {
                at += source[at] === '\\' ? 2 : 1;
            }

            blank(index, at + 1);
            index = at + 1;

            continue;
        }

        index += 1;
    }

    return blanked.join('');
}

/**
 * Keys and values at the top level of the object literal that opens at `start`.
 *
 * @param {string} source Already blanked by {@see withoutCommentsOrStrings}.
 * @param {number} start Index of the opening `{`.
 * @returns {list<{key: string, value: string, index: number}>}
 */
function topLevelEntries(source, start) {
    const entries = [];
    const openers = { '{': '}', '[': ']', '(': ')' };
    let depth = 0;
    let pending = null;

    for (let index = start; index < source.length; index += 1) {
        const character = source[index];

        if (character in openers) {
            depth += 1;

            continue;
        }

        if (character === '}' || character === ']' || character === ')') {
            depth -= 1;

            if (depth === 0) {
                if (pending !== null) {
                    entries.push({ ...pending, value: source.slice(pending.from, index) });
                }

                return entries;
            }

            continue;
        }

        if (depth !== 1) {
            continue;
        }

        if (character === ',' && pending !== null) {
            entries.push({ ...pending, value: source.slice(pending.from, index) });
            pending = null;

            continue;
        }

        const key = /^([A-Za-z_$][\w$]*)\s*:/.exec(source.slice(index));

        if (pending === null && key !== null) {
            pending = { key: key[1], index, from: index + key[0].length };
            index += key[0].length - 1;
        }
    }

    return entries;
}

/**
 * Every scale declared in a file, with the position it was written at.
 *
 * @param {string} path
 * @returns {list<{key: string, value: string, line: number}>}
 */
function declaredScales(path) {
    const source = withoutCommentsOrStrings(readFileSync(path, 'utf8'));
    const scales = [];

    for (const match of source.matchAll(/\bscales\s*:\s*\{/g)) {
        const brace = match.index + match[0].length - 1;

        for (const entry of topLevelEntries(source, brace)) {
            scales.push({
                ...entry,
                line: source.slice(0, entry.index).split('\n').length,
            });
        }
    }

    return scales;
}

test('every scale with an id of its own declares axis or position', () => {
    const offenders = sourceFiles(SOURCE_ROOT).flatMap((path) => declaredScales(path)
        .filter((scale) => !SELF_EXPLANATORY_AXIS.test(scale.key))
        .filter((scale) => !/\b(axis|position)\s*:/.test(scale.value))
        .map((scale) => `${path.slice(SOURCE_ROOT.length + 1)}:${scale.line} → '${scale.key}'`));

    assert.deepEqual(offenders, [], `Chart.js cannot tell whether these scales are horizontal or vertical:\n${offenders.join('\n')}`);
});

test('the marker lane of the glucose context chart is a vertical scale', () => {
    const marks = declaredScales(join(SOURCE_ROOT, 'health/glucoseContextChart.js'))
        .find((scale) => scale.key === 'marks');

    assert.notEqual(marks, undefined);
    /** String literals are blanked out by the reader, so the id of the axis is checked on the raw file. */
    assert.match(marks.value, /\baxis\s*:/);
    assert.match(
        readFileSync(join(SOURCE_ROOT, 'health/glucoseContextChart.js'), 'utf8'),
        /marks:\s*\{[^}]*axis:\s*'y'/,
    );
    /** Invisible on purpose: it is a lane, not a quantity anyone should read. */
    assert.match(marks.value, /display\s*:\s*false/);
});

test('the scale reader tells a key apart from the text around it', () => {
    const source = withoutCommentsOrStrings([
        'const chart = {',
        '    scales: {',
        '        /** A comment naming position: left, which is not code. */',
        '        x: { type: \'linear\', ticks: { callback: (value) => label(value, { position: 1 }) } },',
        '        marks: { display: false },',
        '    },',
        '};',
    ].join('\n'));

    const entries = topLevelEntries(source, source.indexOf('{', source.indexOf('scales')));

    assert.deepEqual(entries.map((entry) => entry.key), ['x', 'marks']);
    assert.equal(/\b(axis|position)\s*:/.test(entries[1].value), false);
    /** The `position` buried in the nested callback belongs to `x`, and it is still not an axis hint. */
    assert.equal(entries[0].value.includes('position'), true);
});
