/**
 * Comprobaciones de `i18n/index.js` y de los tres catálogos.
 *
 * El test que más importa es el primero: **los tres catálogos tienen exactamente el mismo juego de
 * claves**. Es la única forma de que un hueco de traducción falle aquí y no en producción, donde se
 * vería como una frase en inglés suelta en medio de una pantalla en chino, sin ningún error.
 *
 * Corredor incorporado de Node, como el resto de `tests/js`.
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

// --- Integridad de los catálogos ----------------------------------------------------------------

test('los tres catálogos tienen exactamente las mismas claves', () => {
    const reference = Object.keys(EN).sort();

    for (const [locale, catalog] of Object.entries(CATALOGS)) {
        assert.deepEqual(Object.keys(catalog).sort(), reference, `el catálogo "${locale}" no cuadra con el inglés`);
    }
});

test('ninguna traducción está vacía', () => {
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

test('cada traducción usa los mismos marcadores que el inglés', () => {
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

test('las entradas con recuento tienen las variantes que su idioma necesita', () => {
    for (const [key, entry] of Object.entries(EN)) {
        if (typeof entry !== 'object') {
            continue;
        }

        assert.ok(EN[key].one !== undefined && EN[key].other !== undefined, `en/${key}: faltan one y other`);
        assert.ok(ES[key].one !== undefined && ES[key].other !== undefined, `es/${key}: faltan one y other`);
        /** El chino no pluraliza: `other` es su única categoría, y añadir `one` sería ruido. */
        assert.deepEqual(Object.keys(ZH_CN[key]), ['other'], `zh_CN/${key}: el chino solo necesita "other"`);
    }
});

// --- resolveLocale ------------------------------------------------------------------------------

test('resolveLocale: acepta las dos formas del chino y cualquier región', () => {
    for (const tag of ['zh_CN', 'zh-CN', 'zh', 'zh-Hans', 'ZH-cn']) {
        assert.equal(resolveLocale(tag), 'zh_CN', tag);
    }

    assert.equal(resolveLocale('es'), 'es');
    assert.equal(resolveLocale('es-ES'), 'es');
    assert.equal(resolveLocale('en-GB'), 'en');
});

test('resolveLocale: cualquier idioma no soportado cae en el de por defecto', () => {
    for (const tag of ['fr', 'pt-BR', '', '   ', null, undefined, 42]) {
        assert.equal(resolveLocale(tag), DEFAULT_LOCALE, String(tag));
    }
});

test('el idioma por defecto es el inglés, igual que config/app.php', () => {
    assert.equal(DEFAULT_LOCALE, 'en');
    assert.equal(currentLocale(), 'en');
    assert.deepEqual(SUPPORTED_LOCALES, ['en', 'es', 'zh_CN']);
});

test('setLocale: un idioma que no existe no elige catálogo, cae en el de por defecto', () => {
    assert.equal(setLocale('fr'), 'en');
    assert.equal(setLocale('zh-CN'), 'zh_CN');
});

// --- t ------------------------------------------------------------------------------------------

test('t: traduce en los tres idiomas', () => {
    setLocale('en');
    assert.equal(t('glucose.missingValue'), 'Enter a value.');
    setLocale('es');
    assert.equal(t('glucose.missingValue'), 'Introduce un valor.');
    setLocale('zh_CN');
    assert.equal(t('glucose.missingValue'), '请填写数值。');
});

test('t: sustituye los marcadores, también el mismo dos veces', () => {
    setLocale('es');

    assert.equal(
        t('common.noLoincCode', { method: 'capillary', unit: 'mg/dL' }),
        'No hay código LOINC para el método "capillary" con la unidad "mg/dL".',
    );
});

test('t: un marcador sin valor se deja tal cual, no desaparece en silencio', () => {
    setLocale('es');

    assert.match(t('common.badDatetime'), /\{value\}/);
});

test('t: una clave que no existe se devuelve tal cual, para que el hueco se vea', () => {
    assert.equal(t('no.existe.esta.clave'), 'no.existe.esta.clave');
});

test('t: elige singular o plural de verdad, nunca «registro(s)»', () => {
    setLocale('es');
    assert.match(t('common.recordsUndecrypted', { count: 1 }), /^1 registro no se pudo descifrar/);
    assert.match(t('common.recordsUndecrypted', { count: 3 }), /^3 registros no se pudieron descifrar/);

    setLocale('en');
    assert.match(t('common.recordsUndecrypted', { count: 1 }), /^1 record could not be decrypted/);
    assert.match(t('common.recordsUndecrypted', { count: 3 }), /^3 records could not be decrypted/);

    /** El chino no pluraliza: la misma forma para uno y para muchos. */
    setLocale('zh_CN');
    assert.equal(t('common.recordsUndecrypted', { count: 1 }), '有 1 条记录无法解密，未予显示。');
    assert.equal(t('common.recordsUndecrypted', { count: 3 }), '有 3 条记录无法解密，未予显示。');
});

// --- Formato ------------------------------------------------------------------------------------

test('formatNumber: la coma decimal es del castellano, no del dato', () => {
    setLocale('es');
    assert.equal(formatNumber(98.5), '98,5');

    setLocale('en');
    assert.equal(formatNumber(98.5), '98.5');

    /** Un glucómetro chino dice 7.8, no 7,8: mostrar coma sería leer mal el valor. */
    setLocale('zh_CN');
    assert.equal(formatNumber(7.8), '7.8');
});

test('joinList: el chino enumera con 、 y no con coma occidental', () => {
    setLocale('es');
    assert.equal(joinList(['Capilar', 'Intersticial']), 'Capilar, Intersticial');

    setLocale('zh_CN');
    assert.equal(joinList(['毛细血管血', '组织间液']), '毛细血管血、组织间液');
});
