/**
 * Checks of `i18n/index.js` and of the three catalogs.
 *
 * The test that matters most is the first one: **the three catalogs have exactly the same key
 * set**. It is the only way for a translation gap to fail here and not in production, where it
 * would show as a lone English sentence in the middle of a Chinese screen, with no error at all.
 *
 * Node's built-in runner, like the rest of `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { EN } from '../../resources/js/i18n/en.js';
import { ES } from '../../resources/js/i18n/es.js';
import {
    currentLocale,
    DEFAULT_LOCALE,
    formatNumber,
    joinList,
    resolveLocale,
    setLocale,
    SUPPORTED_LOCALES,
    t,
} from '../../resources/js/i18n/index.js';
import { ZH_CN } from '../../resources/js/i18n/zh_CN.js';

const CATALOGS = { en: EN, es: ES, zh_CN: ZH_CN };

afterEach(() => {
    setLocale(DEFAULT_LOCALE);
});

// --- Catalog integrity --------------------------------------------------------------------------

test('the three catalogs have exactly the same keys', () => {
    const reference = Object.keys(EN).sort();

    for (const [locale, catalog] of Object.entries(CATALOGS)) {
        assert.deepEqual(Object.keys(catalog).sort(), reference, `el catálogo "${locale}" no cuadra con el inglés`);
    }
});

test('no translation is empty', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
        for (const [key, entry] of Object.entries(catalog)) {
            const variants = typeof entry === 'object' ? Object.values(entry) : [entry];

            for (const variant of variants) {
                assert.equal(typeof variant, 'string', `${locale}/${key} no es texto`);
                assert.notEqual(variant.trim(), '', `${locale}/${key} está vacía`);
            }
        }
    }
});

test('every translation uses the same placeholders as the English one', () => {
    const markersOf = (entry) => {
        const text = typeof entry === 'object' ? Object.values(entry).join(' ') : entry;

        return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
    };

    for (const [locale, catalog] of Object.entries(CATALOGS)) {
        for (const key of Object.keys(EN)) {
            assert.deepEqual(
                markersOf(catalog[key]),
                markersOf(EN[key]),
                `${locale}/${key} no lleva los mismos marcadores que el inglés`,
            );
        }
    }
});

test('the entries with a count have the variants their language needs', () => {
    for (const [key, entry] of Object.entries(EN)) {
        if (typeof entry !== 'object') {
            continue;
        }

        assert.ok(EN[key].one !== undefined && EN[key].other !== undefined, `en/${key}: faltan one y other`);
        assert.ok(ES[key].one !== undefined && ES[key].other !== undefined, `es/${key}: faltan one y other`);
        /** Chinese does not pluralize: `other` is its only category, and adding `one` would be noise. */
        assert.deepEqual(Object.keys(ZH_CN[key]), ['other'], `zh_CN/${key}: el chino solo necesita "other"`);
    }
});

// --- resolveLocale ------------------------------------------------------------------------------

test('resolveLocale: accepts both forms of Chinese and any region', () => {
    for (const tag of ['zh_CN', 'zh-CN', 'zh', 'zh-Hans', 'ZH-cn']) {
        assert.equal(resolveLocale(tag), 'zh_CN', tag);
    }

    assert.equal(resolveLocale('es'), 'es');
    assert.equal(resolveLocale('es-ES'), 'es');
    assert.equal(resolveLocale('en-GB'), 'en');
});

test('resolveLocale: any unsupported language falls back to the default one', () => {
    for (const tag of ['fr', 'pt-BR', '', '   ', null, undefined, 42]) {
        assert.equal(resolveLocale(tag), DEFAULT_LOCALE, String(tag));
    }
});

test('the default language is English, as in config/app.php', () => {
    assert.equal(DEFAULT_LOCALE, 'en');
    assert.equal(currentLocale(), 'en');
    assert.deepEqual(SUPPORTED_LOCALES, ['en', 'es', 'zh_CN']);
});

test('setLocale: a language that does not exist picks no catalog, it falls back to the default', () => {
    assert.equal(setLocale('fr'), 'en');
    assert.equal(setLocale('zh-CN'), 'zh_CN');
});

// --- t ------------------------------------------------------------------------------------------

test('t: translates in the three languages', () => {
    setLocale('en');
    assert.equal(t('glucose.missingValue'), 'Enter a value.');
    setLocale('es');
    assert.equal(t('glucose.missingValue'), 'Introduce un valor.');
    setLocale('zh_CN');
    assert.equal(t('glucose.missingValue'), '请填写数值。');
});

test('t: replaces the placeholders, including the same one twice', () => {
    setLocale('es');

    assert.equal(
        t('common.noLoincCode', { method: 'capillary', unit: 'mg/dL' }),
        'No hay código LOINC para el método "capillary" con la unidad "mg/dL".',
    );
});

test('t: a placeholder with no value is left as is, it does not disappear in silence', () => {
    setLocale('es');

    assert.match(t('common.badDatetime'), /\{value\}/);
});

test('t: a key that does not exist is returned as is, so the gap is visible', () => {
    assert.equal(t('no.existe.esta.clave'), 'no.existe.esta.clave');
});

test('t: it really picks singular or plural, never "record(s)"', () => {
    setLocale('es');
    assert.match(t('common.recordsUndecrypted', { count: 1 }), /^1 registro no se pudo descifrar/);
    assert.match(t('common.recordsUndecrypted', { count: 3 }), /^3 registros no se pudieron descifrar/);

    setLocale('en');
    assert.match(t('common.recordsUndecrypted', { count: 1 }), /^1 record could not be decrypted/);
    assert.match(t('common.recordsUndecrypted', { count: 3 }), /^3 records could not be decrypted/);

    /** Chinese does not pluralize: the same form for one and for many. */
    setLocale('zh_CN');
    assert.equal(t('common.recordsUndecrypted', { count: 1 }), '有 1 条记录无法解密，未予显示。');
    assert.equal(t('common.recordsUndecrypted', { count: 3 }), '有 3 条记录无法解密，未予显示。');
});

// --- Formatting ---------------------------------------------------------------------------------

test('formatNumber: the decimal comma belongs to Spanish, not to the datum', () => {
    setLocale('es');
    assert.equal(formatNumber(98.5), '98,5');

    setLocale('en');
    assert.equal(formatNumber(98.5), '98.5');

    /** A Chinese glucose meter says 7.8, not 7,8: showing a comma would be misreading the value. */
    setLocale('zh_CN');
    assert.equal(formatNumber(7.8), '7.8');
});

test('joinList: Chinese enumerates with 、 and not with a Western comma', () => {
    setLocale('es');
    assert.equal(joinList(['Capilar', 'Intersticial']), 'Capilar, Intersticial');

    setLocale('zh_CN');
    assert.equal(joinList(['毛细血管血', '组织间液']), '毛细血管血、组织间液');
});
