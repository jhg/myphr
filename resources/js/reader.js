/**
 * Entrada de Vite de la página del lector (ADR 0011).
 *
 * Es una entrada **aparte** de `app.js` a propósito, y no un módulo más del panel. `app.js` arrastra
 * el llavero de la clave maestra, el bloqueo por inactividad, el interceptor de Livewire, Chart.js y
 * los componentes Alpine de doce pantallas: nada de eso pinta aquí, y todo eso sería código con
 * acceso al mismo documento en un dispositivo ajeno. Esta página carga lo que necesita y ni un
 * módulo más.
 *
 * Sin Livewire y sin Alpine: la pantalla es un formulario con un campo y una tabla que se pinta una
 * vez. Cargar un framework reactivo para eso solo añadiría superficie.
 */

import { startReaderPage } from './reader/readerPage.js';

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startReaderPage(document, window), { once: true });
} else {
    startReaderPage(document, window);
}
