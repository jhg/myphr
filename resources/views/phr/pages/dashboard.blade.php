{{--
    Panel de inicio (ADR 0002, ADR 0004, ADR 0006, ADR 0007, ADR 0008).

    Línea temporal de todos los tipos de evento y estadísticas, las dos cosas **del periodo y de los
    tipos que elige la persona**. Es la primera pantalla que ve al entrar, y todo el cálculo ocurre en
    el navegador sobre eventos descifrados (`resources/js/health/dashboardPage.js`, que reutiliza
    `health/statistics.js`): el servidor nunca ve un valor clínico, así que aquí no hay ningún
    `wire:model` ni propiedad pública con datos.

    **El periodo por defecto es el último día**, no «todo»: esta pantalla se abre sola en cada visita
    y descifrar un año de eventos en el navegador se nota. El control es el mismo que el de las
    pantallas de historial (`phr.partials.date-range`), no uno propio, y el rango viaja a
    `fetchEvents` para que el servidor acote por `occurred_at`, que es columna en claro (ADR 0006).

    **El filtro por tipo, en cambio, es cosa del cliente y sale gratis**: el servidor no puede filtrar
    por tipo (va cifrado, ADR 0006), así que la petición baja igualmente todos los tipos del periodo y
    marcar o desmarcar uno solo repinta lo que ya está descifrado en memoria. Por eso las casillas
    llaman a `applyTypeFilter()` y no recargan nada.

    Las casillas las pinta el servidor, como los `<option>` del control de rango y por el mismo
    motivo: este bloque no está dentro de un `wire:ignore`, así que el morph del DOM restaura el HTML
    tal como lo emitió el servidor y borraría cualquier casilla escrita por JavaScript (ADR 0002).

    Estructura fija: `dashboardPage.js` escribe contra este contrato, así que los `x-ref` y el nombre
    del componente no se tocan aquí sin tocar allí.

    Sobre los islands (ADR 0002), con la verdad y no con la versión cómoda: esta pantalla **sí** hace
    peticiones de Livewire —`dashboardPage.js` llama a `await this.$wire.fetchEvents(...)`— y
    **después** escribe en `$refs.timeline` y `$refs.stats`, que viven cada uno dentro de su
    `@island`. Esa es exactamente la precondición que las pantallas con gráfica documentan como fatal
    para una región en island: el servidor reemite el island y el contenido que Alpine había escrito
    desaparece. Aquí no se ha reproducido —la petición la lanza `init()` desde el `<div>` de fuera, y
    lo que protege el contenido es el `wire:ignore` con `wire:key` estable de dentro, no el island—,
    pero la diferencia es de matiz, no de categoría.

    Si algún día el panel pierde sus tarjetas tras cargar, esto es lo primero que hay que mirar: la
    salida es quitar los `@island` y dejar `wire:ignore` + `wire:key`, como hacen los lienzos de las
    otras pantallas. La forma actual la fija `tests/Feature/DashboardPageTest.php`, que exige tres
    islands, así que cambiarla es cambiar también ese test, a conciencia.

    Estilo: MediCare+ (DESIGN.md), las mismas tarjetas que `glucose.blade.php`: superficie
    `bg-surface`, borde `border-border`, radio 8px, sombra Subtle, 24px de relleno.
--}}
{{--
    El contenido va envuelto en `<x-filament-panels::page>` por el mismo motivo que
    `glucose.blade.php`: esta página define su propia `$view`, y sin ese componente se pierde el
    contenedor `fi-page-header-main-ctn` de Filament (el `py-8` y la cabecera).
--}}
<x-filament-panels::page>
{{--
    Destinos de los estados vacíos. Van en `data-*` y no escritos en el módulo de JavaScript porque
    la ruta del panel la decide `PhrPanelProvider`, y una ruta duplicada a mano en el cliente es de
    las que se quedan obsoletas sin que nadie lo note hasta que alguien pulsa el botón.
--}}
<div
    x-data="phrDashboardPage"
    wire:key="dashboard-page"
    class="space-y-6"
    data-glucose-url="{{ \App\Filament\Pages\Glucose::getUrl() }}"
    data-blood-pressure-url="{{ \App\Filament\Pages\BloodPressure::getUrl() }}"
    data-insulin-url="{{ \App\Filament\Pages\Insulin::getUrl() }}"
    data-meals-url="{{ \App\Filament\Pages\Meals::getUrl() }}"
    data-body-weight-url="{{ \App\Filament\Pages\BodyWeight::getUrl() }}"
    data-temperature-url="{{ \App\Filament\Pages\Temperature::getUrl() }}"
>
    {{--
        Qué se está mirando: el periodo y los tipos. Va lo primero porque gobierna todo lo de abajo,
        y porque leer un resumen sin saber de qué tramo es, es leerlo mal.
    --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Period and event types') }}
        </h2>

        @include('phr.partials.date-range', ['idPrefix' => 'dashboard'])

        {{--
            Filtro por tipo de evento. Es multiselección con todo marcado de salida: estrenar el
            panel con algún tipo fuera escondería registros que existen sin que nadie lo pida.

            `<fieldset>` con su `<legend>`: son seis casillas con un único encabezado, que es
            exactamente para lo que existe el elemento; un `<div>` con un `<p>` encima dejaría al
            lector de pantalla sin la relación entre el título y las casillas.
        --}}
        <fieldset class="mt-4">
            <legend class="mb-1.5 block text-body-sm font-semibold text-ink">
                {{ __('Event types') }}
            </legend>

            <div class="flex flex-wrap gap-2">
                {{--
                    Los tokens son los del sobre cifrado (ADR 0006) y el contrato con `EVENT_TYPES`
                    de `dashboardPage.js`. Las etiquetas se traducen aquí con `__()`, igual que los
                    `<option>` del control de rango.
                --}}
                @foreach ([
                    'glucose' => __('Blood glucose'),
                    'bloodPressure' => __('Blood pressure'),
                    'insulin' => __('Insulin'),
                    'meal' => __('Meals'),
                    'bodyWeight' => __('Body weight'),
                    'temperature' => __('Temperature'),
                ] as $token => $label)
                    {{--
                        Filter Chip · DESIGN.md § Chips, con una casilla de verdad dentro: `sr-only`
                        y no `hidden`, para que siga siendo enfocable con el teclado y anunciada como
                        casilla. El estado marcado se pinta con `peer-checked:` sobre el rótulo, y el
                        foco con `peer-focus-visible:`, así que el chip nunca es solo color: la
                        casilla existe de verdad debajo (Do's #3).

                        Los colores van por su papel (`chip-*` sin marcar, `accent`/`accent-ink`
                        marcado) y conmutan solos con el tema; escritos con la rampa saldrían casi
                        blancos en oscuro.
                    --}}
                    <label class="inline-flex min-h-11 cursor-pointer items-center">
                        <input
                            type="checkbox"
                            class="peer sr-only"
                            x-model="selectedTypes['{{ $token }}']"
                            @change="applyTypeFilter()"
                        >
                        <span
                            class="inline-flex min-h-11 items-center rounded-chip border border-chip-outline bg-chip-surface px-3.5 py-1.5 text-body-sm font-semibold text-chip-ink peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:shadow-focus-blue"
                        >
                            {{ $label }}
                        </span>
                    </label>
                @endforeach
            </div>
        </fieldset>
    </section>

    {{--
        Avisos de carga: sobres que no abrieron, resumen recortado, cuántos registros hay detrás de
        lo que se enseña, o un fallo al pedir datos. El contenido lo escribe Alpine a partir de lo
        descifrado, así que lleva las dos capas del ADR 0002 igual que las dos regiones de abajo:
        `@island` por fuera, `wire:ignore` con `wire:key` estable por dentro.
    --}}
    @island(name: 'dashboard-notice')
        <div wire:ignore x-ref="notice" wire:key="dashboard-notice-region"></div>
    @endisland

    {{--
        Línea temporal unificada: los tipos marcados, del más reciente al más antiguo y agrupados por
        día.

        Va antes que las estadísticas a conciencia. Cada tarjeta de abajo resume una magnitud; esta
        es la única que enseña la relación entre comer, pincharse insulina y lo que hace la glucosa
        después, que es lo que se mira al abrir la aplicación. Sale gratis en peticiones: el servidor
        no puede filtrar por tipo (ADR 0006), así que la petición que ya hacen las estadísticas trae
        de todos modos todos los tipos del periodo.
    --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Timeline') }}
        </h2>

        @island(name: 'dashboard-timeline')
            <div wire:ignore x-ref="timeline" wire:key="dashboard-timeline-region" class="mt-4"></div>
        @endisland
    </section>

    {{--
        Gráficas del periodo: una por tipo marcado, con la mediana de cada día y una banda del
        mínimo al máximo de ese día.

        **Estos bloques NO van dentro de un `@island`, y es la lección cara de las pantallas de
        glucemia, tensión e insulina**, escrita arriba en el comentario de los islands: tras
        cualquier petición de Livewire el servidor reemite el island y el `<canvas>` desaparece del
        HTML con todo lo que Alpine había dibujado. Aquí la petición la lanza el propio componente
        (`fetchEvents`), así que la precondición se cumple entera. Lo que protege esta región es
        `wire:ignore` con `wire:key` estable, que es el mecanismo del ADR 0002 para el marcado que el
        morph no debe tocar; el island no aportaría nada porque el servidor no renderiza nunca este
        contenido.

        Por eso tampoco hay `x-ref` aquí: `dashboardPage.js` busca sus lienzos por `id` (ver
        `chartElementIds`), igual que `chartLegend.js` busca el `<ul>` de la leyenda, y
        `DashboardPageTest` exige que fuera de los islands no haya ningún `x-ref`.

        El marcado de los cinco tipos lo emite el servidor —cabecera, lienzo, leyenda y pie— y Alpine
        solo muestra u oculta el bloque según el filtro y según si hay lecturas. Las comidas no están:
        no tienen magnitud que promediar, así que tampoco tienen gráfica (ni tarjeta de estadísticas).

        El contenedor de altura fija envuelve **solo** al `<canvas>`: con `maintainAspectRatio:
        false`, Chart.js exige que el padre del lienzo sea suyo en exclusiva. La leyenda y el pie van
        fuera, como hermanos, o desbordarían por debajo y podrían disparar el bucle de
        redimensionado. El `<canvas>` es un objeto gráfico sin texto: lleva `role="img"` con nombre
        accesible y `aria-describedby` al pie y a la leyenda, que es donde están en texto las series
        que incluye y lo que significa la banda (Do's #3).
    --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Charts') }}
        </h2>

        <div wire:ignore wire:key="dashboard-charts-region" class="mt-4 space-y-8">
            @foreach ([
                'glucose' => __('Blood glucose'),
                'bloodPressure' => __('Blood pressure'),
                'insulin' => __('Insulin'),
                'bodyWeight' => __('Body weight'),
                'temperature' => __('Temperature'),
            ] as $token => $label)
                {{--
                    Oculto de salida: lo descubre `renderCharts()` cuando ese tipo está marcado y
                    tiene lecturas en el periodo. Un lienzo con los ejes vacíos parece un fallo, no
                    un estado vacío.
                --}}
                <div id="dashboard-chart-{{ $token }}" class="hidden">
                    <h3 class="font-display text-body-sm font-semibold text-ink">
                        {{ $label }}
                    </h3>

                    <div class="mt-2 h-80">
                        <canvas
                            id="dashboard-chart-{{ $token }}-canvas"
                            role="img"
                            aria-label="{{ __('Daily median and daily range for :type', ['type' => $label]) }}"
                            aria-describedby="dashboard-chart-{{ $token }}-caption dashboard-chart-{{ $token }}-legend"
                        ></canvas>
                    </div>

                    <ul id="dashboard-chart-{{ $token }}-legend" class="mt-3 flex flex-wrap gap-x-4 gap-y-1"></ul>

                    {{-- Caption: Open Sans 12px, tinta secundaria; lo escribe `chartCaptionText()`. --}}
                    <p id="dashboard-chart-{{ $token }}-caption" class="mt-2 text-caption text-ink-secondary"></p>
                </div>
            @endforeach
        </div>
    </section>

    {{--
        Estadísticas del periodo elegido: una tarjeta por tipo marcado, que escribe Alpine.

        La cabecera de cada tarjeta no se puede pintar aquí porque qué tarjetas existen depende del
        filtro, y una cabecera del servidor se quedaría sobre una tarjeta que ya no está. Lo que sí
        pone el servidor es el encabezado de la sección.
    --}}
    <section>
        <h2 class="font-display text-subhead text-ink">
            {{ __('Statistics') }}
        </h2>

        @island(name: 'dashboard-stats')
            <div wire:ignore x-ref="stats" wire:key="dashboard-stats-region" class="mt-4 space-y-6"></div>
        @endisland
    </section>
</div>
</x-filament-panels::page>
