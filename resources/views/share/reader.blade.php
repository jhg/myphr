{{--
    Página del lector de un recorte compartido (ADR 0011): la que abre el profesional.

    Es un documento completo y **no** usa `layouts/app.blade.php`: aquel emite `@livewireStyles` y
    `@livewireScripts` y carga `resources/js/app.js`, que arrastra el llavero de la clave maestra,
    el bloqueo por inactividad y los componentes de doce pantallas del panel. Aquí no pinta nada de
    eso, y todo eso sería código corriendo en un dispositivo ajeno.

    **Lo que sí carga, y el ADR 0011 no preveía, es Chart.js**: el profesional ve las mismas
    gráficas que el paciente, porque una tabla de trescientas glucemias no se lee en consulta.
    Entra por los módulos de `resources/js/health/` que comparten las dos pantallas, sigue siendo
    código propio servido desde este origen y no rompe la CSP de abajo, que nunca ha permitido
    recursos de terceros.

    **El servidor no pinta ni un dato clínico.** Manda esta cáscara, el vocabulario público de
    `App\Sharing\ReaderCatalog` (tokens de catálogo y términos LOINC, los mismos para todo el mundo)
    y el identificador del enlace, que ya está en la URL. Todo lo demás lo descifra el navegador con
    la clave que viaja en el fragmento, que nunca llega al servidor.

    **Y no pinta nada de la cuenta del paciente**: ni nombre, ni correo, ni cuántos recortes tiene.
    Tampoco dice si este enlace existe: la respuesta es idéntica para un enlace vivo, uno caducado,
    uno revocado y uno que nunca existió (ver `ShareReaderPageController`).

    **Casi todo el texto visible lo escribe JavaScript** (`t()`, con los tres catálogos de
    `resources/js/i18n/`), no Blade. No es un capricho: el selector de idioma de esta página cambia
    el idioma sin recargar y sin pedirle nada al servidor, y para eso el texto tiene que poder
    volver a pintarse. Lo único que sale de `__()` es lo que el navegador necesita antes de ejecutar
    un solo módulo: el `<title>` y el aviso de `<noscript>`.

    The unlock card is the exception, and it is written **twice on purpose**: the server renders the
    six strings of the card inside the very elements `data-phr-reader-text` overwrites later. The
    markers stay, so the language selector keeps working exactly as before; what changes is that the
    title, the explanation, the label and the button are readable from the first byte of HTML
    instead of after the bundle has downloaded and evaluated. Before this, a slow connection showed
    a card with no title, a field with no label and a button with no text — a page that looks broken
    at the one moment there is nothing to do but read it. It costs no privacy: the whole public
    catalog already travels inside this page in all three languages.

    Estilo: MediCare+ (DESIGN.md) con la hoja propia `resources/css/reader.css`, siempre por el
    PAPEL del token (`text-ink`, `bg-surface`, `border-border-strong`, `bg-accent` +
    `text-accent-ink`) y nunca por un tono de la rampa.
--}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', $locale) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        {{--
            El enlace lleva material de clave en el fragmento y la página enseña datos clínicos: no
            debe acabar en ningún índice ni en ninguna vista previa de enlace, y el `Referer` no
            debe llevarse la URL a ningún sitio (el middleware `NoStore` ya manda `no-referrer`).
        --}}
        <meta name="robots" content="noindex, nofollow, noarchive">

        @production
            {{--
                CSP estricta y sin recursos de terceros (ADR 0011). Va en `<meta>` y no en una
                cabecera porque es de esta página y de ninguna otra, y va solo en producción porque
                el servidor de desarrollo de Vite sirve sus módulos desde otro origen: con la
                directiva puesta, `npm run dev` no cargaría nada y el fallo parecería un error del
                código.

                `default-src 'none'` y de ahí solo se abre lo que esta página usa de verdad: sus
                propios scripts y hojas, sus fuentes autoalojadas, y `connect-src 'self'` para las
                dos llamadas del PIN. Sin `img-src` porque no hay ni una imagen, y con
                `form-action 'none'` porque el único formulario no se envía a ninguna parte: lo
                intercepta JavaScript y todo ocurre en el navegador.
            --}}
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
        @endproduction

        <title>{{ __('Shared health record') }}</title>

        {{-- Familias de MediCare+ autoalojadas: en tiempo de ejecución no hay peticiones a terceros. --}}
        @fonts

        @vite(['resources/css/reader.css', 'resources/js/reader.js'])
    </head>
    <body class="min-h-screen">
        {{--
            Vocabulario público en claro. Trae los tres idiomas porque el selector de esta página
            cambia de idioma sin volver a pedir nada: una segunda petición sería una petición más
            que ata a este lector con este enlace.
        --}}
        <script type="application/json" data-phr-reader-catalog>@json($catalog)</script>

        {{--
            Las dos URL se construyen con `route()` y no concatenando el prefijo: el prefijo público
            del lector es una decisión de superficie que puede cambiar, y el día que cambie tiene
            que cambiar en un solo sitio.
        --}}
        @php($config = [
            'linkId' => $linkId,
            'locale' => $locale,
            'maxAttempts' => $maxAttempts,
            'endpoints' => [
                'challenge' => route('share.challenge', ['link' => $linkId]),
                'open' => route('share.open', ['link' => $linkId]),
            ],
        ])

        <script type="application/json" data-phr-reader-config>@json($config)</script>

        <noscript>
            <p class="m-4 rounded-card border border-warning-outline bg-warning-surface p-card text-body text-warning-ink">
                {{ __('This page decrypts the record inside your browser, so it needs JavaScript. The server cannot read this record and cannot show it to you another way.') }}
            </p>
        </noscript>

        <main class="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-8">
            <header class="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 data-phr-reader-text="reader.title" class="font-display text-headline text-ink">{{ __('Shared health record') }}</h1>
                    <p data-phr-reader-text="reader.intro" class="mt-1 text-body text-ink-secondary">{{ __('Someone shared a read-only extract of their own health record with you. It is encrypted: nobody but this browser, with the PIN, can read it.') }}</p>
                </div>

                {{--
                    Selector de idioma. La página llega en el idioma que pide el navegador del
                    profesional, que no tiene por qué ser el suyo, y nunca en el de la persona
                    propietaria de los datos (ADR 0007: su idioma es columna en claro y no tiene por
                    qué salir de casa). Los botones los pinta el cliente desde el catálogo.
                --}}
                <nav
                    data-phr-reader-locales
                    data-phr-reader-screen-only
                    class="flex flex-wrap gap-2"
                    aria-label="{{ __('Language') }}"
                ></nav>
            </header>

            {{-- Tarjeta del PIN. Desaparece en cuanto el recorte se abre. --}}
            <section
                data-phr-reader-unlock
                data-phr-reader-screen-only
                class="rounded-card border border-border bg-surface p-card shadow-sm"
            >
                <h2 data-phr-reader-text="reader.pin.title" class="font-display text-subhead text-ink">{{ __('Enter the PIN') }}</h2>
                <p data-phr-reader-text="reader.pin.help" class="mt-2 text-body text-ink-secondary">{{ __('The six-digit PIN was given to you separately from this link. Working it out takes a few seconds on purpose, so that a stolen link is not enough by itself.') }}</p>

                <form data-phr-reader-form class="mt-4 flex flex-wrap items-end gap-3">
                    <div>
                        {{-- Etiqueta siempre visible, nunca un `placeholder` que la sustituya (Don'ts #8). --}}
                        <label
                            for="reader-pin"
                            data-phr-reader-text="reader.pin.label"
                            class="mb-1.5 block text-body-sm font-semibold text-ink"
                        >{{ __('PIN') }}</label>

                        {{--
                            Seis dígitos. `inputmode="numeric"` para que el móvil abra el teclado
                            numérico, `autocomplete="off"` para que el PIN no se guarde en el
                            autocompletado de un ordenador de consulta que usan varias personas, y
                            `type="text"` a propósito: con `type="number"` el navegador se come los
                            ceros a la izquierda, y un PIN que empieza por cero es uno de cada diez.
                        --}}
                        <input
                            id="reader-pin"
                            data-phr-reader-pin
                            type="text"
                            inputmode="numeric"
                            pattern="[0-9]*"
                            autocomplete="off"
                            autofocus
                            aria-required="true"
                            class="block min-h-11 w-48 rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body tracking-[0.3em] text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                        >
                    </div>

                    {{-- Botón primario · § Buttons: relleno de acento, 44px de objetivo táctil. --}}
                    <button
                        type="submit"
                        data-phr-reader-submit
                        data-phr-reader-text="reader.pin.submit"
                        class="inline-flex min-h-11 items-center justify-center rounded-control bg-accent px-6 py-2.5 text-button text-accent-ink hover:bg-accent-hover focus-visible:shadow-focus-blue focus-visible:outline-none disabled:opacity-60"
                    >{{ __('Open the record') }}</button>
                </form>

                {{--
                    Barra de progreso del estiramiento del PIN. Argon2id tarda segundos, y en un
                    equipo de consulta bastantes; sin esto la página parece colgada y la persona
                    recarga, que aquí significa volver a empezar. El movimiento va en `transform`
                    (compositor) y no en `width`.
                --}}
                <div
                    data-phr-reader-progress
                    hidden
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    class="mt-4"
                >
                    <div class="h-2 overflow-hidden rounded-full bg-progress-track">
                        <div
                            data-phr-reader-progress-bar
                            class="h-full w-full origin-left bg-accent transition-transform duration-100 ease-linear"
                            style="transform: scaleX(0);"
                        ></div>
                    </div>

                    <p data-phr-reader-progress-stage aria-live="polite" class="mt-2 text-caption text-ink-secondary"></p>
                </div>

                {{--
                    Los errores no se auto-descartan (Don'ts #6) y llevan texto además de color
                    (Do's #3). El mensaje es el mismo para enlace inexistente, caducado, revocado y
                    PIN incorrecto: la pantalla no puede decir cuál de los cuatro es.
                --}}
                <p
                    data-phr-reader-error
                    hidden
                    role="alert"
                    class="mt-4 rounded-card border border-error-outline bg-error-surface p-pad-md text-body text-error-ink"
                ></p>
            </section>

            {{--
                El recorte entero: cabecera, controles de subperiodo, tipos y búsqueda, gráficas,
                estadísticas, línea temporal y la tabla clínica. Lo pinta entero
                `reader/clippingExplorer.js` tras descifrar, que es el mismo módulo que monta la
                vista previa de la pantalla de compartir: el servidor no emite ni una etiqueta de
                esto, y no podría, porque son valores en claro que solo existen en este navegador.
            --}}
            <section data-phr-reader-report hidden class="flex flex-col gap-6"></section>

            <div data-phr-reader-screen-only class="flex flex-wrap gap-3">
                {{-- Botón secundario · § Buttons: sin relleno, borde de 1.5px en el color de acción. --}}
                <button
                    type="button"
                    data-phr-reader-print
                    data-phr-reader-text="reader.print"
                    class="inline-flex min-h-11 items-center justify-center rounded-control border-[1.5px] border-accent px-6 py-2.5 text-button text-accent hover:bg-surface-hover focus-visible:shadow-focus-blue focus-visible:outline-none"
                ></button>
            </div>

            {{--
                Lo que hay que saber sobre lo que se está leyendo, arriba del todo de la letra
                pequeña y sin plegar: es una foto fija, caduca, y quien la abre no se identifica
                ante nadie. Son afirmaciones sobre el sistema, no letra legal.
            --}}
            <footer class="text-body-sm text-ink-secondary">
                <ul class="flex list-disc flex-col gap-1 pl-5">
                    <li data-phr-reader-text="reader.notes.snapshot"></li>
                    <li data-phr-reader-text="reader.notes.expiry"></li>
                    <li data-phr-reader-text="reader.notes.zeroKnowledge"></li>
                    <li data-phr-reader-text="reader.notes.noTracking"></li>
                </ul>
            </footer>
        </main>
    </body>
</html>
