/**
 * Comprobaciones de `health/savedNotice.js`, el aviso de «registro guardado» que comparten las
 * cuatro pantallas de eventos.
 *
 * Lo que importa aquí es el ciclo de vida del aviso, no su aspecto: que aparece, que se va solo, y
 * sobre todo que un guardado nuevo reinicia la cuenta en vez de heredar el temporizador del
 * anterior —si no, el aviso del segundo guardado se apagaría a mitad y quedaría un registro bueno
 * sin confirmar—. El reloj se simula con los temporizadores falsos del corredor de Node: esperar
 * cuatro segundos de verdad haría la suite lenta y frágil.
 *
 * Corredor incorporado de Node, como el resto de `tests/js`.
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SAVED_NOTICE_MS, savedNotice } from '../../resources/js/health/savedNotice.js';

test('savedNotice: arranca oculto', () => {
    const component = savedNotice();

    assert.equal(component.saved, false);
    assert.equal(component.savedTimer, null);
});

test('savedNotice: confirmSaved muestra el aviso y lo retira solo al cumplirse el plazo', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const component = savedNotice();

    component.confirmSaved();

    assert.equal(component.saved, true);

    /** Un instante antes del plazo sigue visible: el aviso dura lo que dice durar. */
    t.mock.timers.tick(SAVED_NOTICE_MS - 1);
    assert.equal(component.saved, true);

    t.mock.timers.tick(1);
    assert.equal(component.saved, false);
    assert.equal(component.savedTimer, null);
});

test('savedNotice: guardar otra vez reinicia la cuenta en lugar de heredar el temporizador', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const component = savedNotice();

    component.confirmSaved();
    t.mock.timers.tick(SAVED_NOTICE_MS - 100);

    /** Segundo guardado casi al final del primer aviso. */
    component.confirmSaved();

    /**
     * Si el temporizador del primero siguiera vivo, aquí ya habría apagado el aviso del segundo,
     * dejando un guardado bueno sin confirmar.
     */
    t.mock.timers.tick(100);
    assert.equal(component.saved, true);

    t.mock.timers.tick(SAVED_NOTICE_MS - 100);
    assert.equal(component.saved, false);
});

test('savedNotice: clearSaved retira el aviso ya y cancela el temporizador', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const component = savedNotice();

    component.confirmSaved();
    component.clearSaved();

    assert.equal(component.saved, false);
    assert.equal(component.savedTimer, null);

    /** Y el temporizador cancelado no puede resucitar el aviso más tarde. */
    t.mock.timers.tick(SAVED_NOTICE_MS);
    assert.equal(component.saved, false);
});
