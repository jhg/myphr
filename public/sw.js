/**
 * Service worker de myphr.
 *
 * **No guarda nada en caché, y eso es la decisión, no una versión reducida por hacer.**
 *
 * Un service worker puede interceptar toda petición del origen y archivar la respuesta en la Cache
 * API, que persiste en disco. En una aplicación de conocimiento cero eso crearía un sitio nuevo, con
 * su propio ciclo de vida, donde acabarían copias de las respuestas del panel: sobres cifrados, sí,
 * pero también la estructura de qué se pide y cuándo. Y sobre todo `app.js`, la pieza de la que
 * depende toda la garantía: un bundle servido desde caché es un bundle que un despliegue nuevo no
 * puede corregir, así que una versión antigua o manipulada sobreviviría a su propio arreglo.
 *
 * Tampoco hay modo sin conexión, por el mismo motivo de fondo: la clave maestra vive en memoria y
 * muere al cerrar la pestaña, así que sin servidor no habría nada que enseñar salvo texto cifrado.
 * Un «funciona sin conexión» aquí sería una promesa vacía.
 *
 * Lo único que aporta este fichero es que el navegador considere la aplicación instalable, para que
 * se pueda tener en la pantalla de inicio y abrir sin barra de direcciones. El `fetch` va sin
 * `respondWith`, así que cada petición sigue exactamente el camino que seguiría sin él.
 */

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        /**
         * Barrido defensivo: si alguna versión futura llegara a cachear algo, o si quedaran restos
         * de una instalación anterior, se borran al activar. Que no cacheemos hoy no garantiza que
         * el disco esté limpio de ayer.
         */
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));

        await self.clients.claim();
    })());
});

/** Sin `respondWith`: el navegador resuelve la petición como si este worker no existiera. */
self.addEventListener('fetch', () => {});
