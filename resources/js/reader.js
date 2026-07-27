/**
 * Entrada de Vite de la página del lector (ADR 0011).
 *
 * Es una entrada **aparte** de `app.js` a propósito, y no un módulo más del panel. `app.js` arrastra
 * el llavero de la clave maestra, el bloqueo por inactividad, el interceptor de Livewire y los
 * componentes Alpine de doce pantallas: nada de eso pinta aquí, y todo eso sería código con acceso
 * al mismo documento en un dispositivo ajeno. Esta página carga lo que necesita y ni un módulo más.
 *
 * Lo que sí comparte con el panel son las **vistas** de eventos (línea temporal, estadísticas y
 * gráficas, con Chart.js detrás), porque el profesional ve lo mismo que el paciente: una tabla de
 * trescientas glucemias no se lee en consulta. Son módulos que reciben eventos descifrados y
 * devuelven nodos, sin Livewire y sin `$wire` (`resources/js/reader/clippingExplorer.js`).
 *
 * Sin Livewire y sin Alpine: los controles son DOM corriente con `addEventListener`. Un framework
 * reactivo aquí solo añadiría superficie, y el de Livewire además mandaría al servidor todo lo que
 * tocara (ADR 0002).
 */

import { startReaderPage } from './reader/readerPage.js';

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startReaderPage(document, window), { once: true });
} else {
    startReaderPage(document, window);
}
