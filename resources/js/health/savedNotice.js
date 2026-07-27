/**
 * Confirmación efímera de guardado, compartida por las cuatro pantallas de eventos (glucemia,
 * tensión, insulina, comidas).
 *
 * El botón ya se deshabilita y cambia a «Guardando…» mientras se cifra y se sube, así que la espera
 * se ve; lo que no se veía era el final. Al terminar, el botón simplemente vuelve a decir «Guardar»
 * y el campo del valor se queda en blanco: exactamente el mismo aspecto que si no hubiera pasado
 * nada. El registro nuevo sí aparece en el historial, pero el historial es otra tarjeta más abajo,
 * fuera de la pantalla en un móvil, y quien está mirando el botón no lo ve. Con el cifrado
 * ocurriendo en el navegador la operación tarda lo suficiente como para dudar, y la reacción
 * natural ante la duda es volver a pulsar: eso guardaría dos veces la misma lectura, y dos lecturas
 * idénticas separadas por segundos no se distinguen después de un valor real repetido.
 *
 * Por eso la confirmación es efímera y no permanente: informa del final de ESTA operación. Si se
 * quedara en pantalla, al abrir la página al día siguiente —o al fallar el guardado siguiente— se
 * seguiría leyendo «Registro guardado», que entonces sería mentira. Se va sola a los pocos
 * segundos, sin pedir que nadie la cierre.
 *
 * El aviso lo pinta cada plantilla junto al botón con `x-show="saved"` y `role="status"`, con el
 * texto en Blade (`__('Record saved.')`), igual que la confirmación de ajustes de
 * `profile.blade.php`: el texto es constante, así que no necesita pasar por el catálogo de
 * JavaScript.
 */

/**
 * Cuánto se queda el aviso en pantalla. Cuatro segundos son suficientes para leer tres palabras sin
 * mirar fijamente, y bastante menos que el tiempo de teclear la lectura siguiente, que es cuando el
 * aviso pasaría a estorbar.
 */
export const SAVED_NOTICE_MS = 4000;

/**
 * Estado y comportamiento del aviso, para mezclar en un componente Alpine con `...savedNotice()`,
 * igual que `progressMixin()` en las pantallas de acceso.
 *
 * @returns {{saved: boolean, savedTimer: ReturnType<typeof setTimeout>|null,
 *            confirmSaved: () => void, clearSaved: () => void}}
 */
export function savedNotice() {
    return {
        /** Si el aviso de «guardado» está visible ahora mismo. */
        saved: false,

        /** Temporizador vivo del aviso, para poder reiniciarlo al guardar otra vez. */
        savedTimer: null,

        /**
         * Muestra el aviso y programa su retirada.
         *
         * Al guardar dos veces seguidas el temporizador anterior se cancela y se cuenta de nuevo: si
         * no, el de la primera vez apagaría el aviso de la segunda a mitad de camino, y quedaría un
         * guardado bueno sin confirmar.
         */
        confirmSaved() {
            clearTimeout(this.savedTimer);

            this.saved = true;
            this.savedTimer = setTimeout(() => {
                this.saved = false;
                this.savedTimer = null;
            }, SAVED_NOTICE_MS);
        },

        /**
         * Retira el aviso ya, sin esperar al temporizador. Se llama al empezar un guardado nuevo:
         * dejar el «guardado» de la vez anterior visible mientras se cifra la siguiente lectura la
         * daría por buena antes de tiempo.
         */
        clearSaved() {
            clearTimeout(this.savedTimer);

            this.saved = false;
            this.savedTimer = null;
        },
    };
}
