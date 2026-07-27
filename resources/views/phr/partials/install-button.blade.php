{{--
    Botón para instalar el panel en la pantalla de inicio, en la barra superior y junto al menú de
    usuario.

    Va en un render hook con plantilla propia y **no** como entrada de `->userMenuItems()`, aunque
    ese menú sería el sitio natural, porque quién puede instalar y cómo no lo sabe el servidor: en
    Chromium depende de un evento del navegador que llega después de pintar, en iOS no existe ese
    evento y hay que explicar un gesto manual, y si la aplicación ya está instalada no debe salir
    nada. Un item construido en PHP saldría siempre, también en Firefox de escritorio, donde pulsar
    no puede hacer nada. Toda esa decisión vive en `resources/js/pwa/installPrompt.js`, que además
    explica por qué iOS necesita un camino distinto.

    El botón nace oculto (`x-cloak` más `x-show`) y solo aparece si hay algo que ofrecer: en el peor
    caso, la persona no ve nada, que es exactamente lo que ve hoy.
--}}
<div
    x-data="phrInstallButton"
    x-show="mode !== 'hidden'"
    x-cloak
    class="relative"
>
    <button
        type="button"
        x-on:click="install()"
        x-bind:aria-expanded="mode === 'ios' ? (hintVisible ? 'true' : 'false') : null"
        class="inline-flex min-h-11 items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-body-sm text-ink-secondary transition hover:bg-surface-hover hover:text-ink focus-visible:shadow-focus-blue focus-visible:outline-none"
    >
        {{-- Flecha hacia un dispositivo: el icono habitual de «instalar en el dispositivo». --}}
        <svg class="size-5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round"
                  d="M12 3v10.5m0 0 3.75-3.75M12 13.5 8.25 9.75M4.5 16.5v1.875A2.625 2.625 0 0 0 7.125 21h9.75A2.625 2.625 0 0 0 19.5 18.375V16.5" />
        </svg>
        {{-- El texto se esconde en pantallas estrechas, donde la barra superior no da para más; el
             icono se queda solo y el nombre accesible lo sostiene el `sr-only`. --}}
        <span class="hidden sm:inline">{{ __('Install app') }}</span>
        <span class="sr-only sm:hidden">{{ __('Install app') }}</span>
    </button>

    {{--
        Indicación para iOS. No es un aviso permanente: aparece al pulsar, porque es la respuesta al
        clic, y se va al pulsar fuera o con Escape. Se pinta siempre en el HTML y se muestra con
        `x-show` en lugar de construirla en JavaScript para que la traducción siga saliendo de
        `lang/`, como el resto del texto del panel.
    --}}
    <p
        x-show="hintVisible"
        x-cloak
        x-on:click.outside="hintVisible = false"
        x-on:keydown.escape.window="hintVisible = false"
        role="status"
        class="absolute end-0 top-full z-10 mt-2 w-64 rounded-control border border-border bg-surface-overlay px-3.5 py-2.5 text-helper text-ink-secondary shadow-xl"
    >
        {{ __('On iPhone and iPad: tap Share and then Add to Home Screen.') }}
    </p>
</div>
