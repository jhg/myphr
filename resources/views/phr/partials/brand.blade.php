{{--
    Marca del panel: el icono y el nombre juntos.

    Es el mismo PNG que instala el PWA en la pantalla de inicio, y esa es la gracia: quien abre la
    aplicación desde el icono del móvil reconoce lo mismo arriba a la izquierda. Se sirve desde
    `public/icons/`, sin pasar por Vite, porque el manifiesto lo referencia por esa ruta fija y tener
    dos copias con nombres distintos sería la forma segura de que un día dejen de coincidir.

    El `alt` va vacío a propósito: el nombre está a su lado como texto, así que describir el icono lo
    haría que un lector de pantalla dijese «myphr» dos veces.
--}}
<span class="flex items-center gap-2">
    <img
        src="/icons/icon-192.png"
        alt=""
        width="28"
        height="28"
        class="size-7 rounded-md"
    >
    <span class="font-display text-body-lg font-bold text-ink">myphr</span>
</span>
