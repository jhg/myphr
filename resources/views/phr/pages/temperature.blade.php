{{--
    Pantalla de temperatura corporal (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).

    Estructura calcada de `blood-pressure.blade.php`: componente Alpine `phrTemperaturePage`, sin
    `wire:model` (ADR 0002). Alpine lee los campos del DOM, cifra en el navegador y llama a
    `storeEvent` —el método común de `App\Filament\Pages\HealthEventPage`— como acción de método,
    fuera de cualquier island.

    El historial descifrado vive dentro de su `@island`, con `wire:ignore` **dentro** y `wire:key`
    estable, las dos capas que pide ADR 0002 § Decision. La gráfica lleva `wire:ignore` y `wire:key`
    pero NO island: el porqué, comprobado ejecutando el componente en las otras pantallas, está
    junto al lienzo.

    Los `<option>` de `unit`, `site` y `recordedBy` se renderizan aquí, en Blade, y no por
    JavaScript: esos `<select>` no están dentro de un `wire:ignore`, así que el morph de Livewire los
    borraría si los rellenara Alpine (ver el mismo razonamiento en `glucose.blade.php`). El catálogo
    es dato público de referencia en claro (ADR 0005, ADR 0008).

    El sitio de medida es el método de esta magnitud (ADR 0008): la axilar y la rectal no dan el
    mismo número, así que se pregunta y no se deduce. Además decide el código LOINC, al contrario que
    el brazo y la postura de la tensión (ver `App\Catalog\TemperatureLoincCode`). No lleva opción
    vacía: es obligatorio y la primera opción del catálogo llega preseleccionada para confirmarla o
    cambiarla, en vez de forzar un desplegable vacío en un campo obligatorio.

    El formulario NO pregunta el origen del dato (manual o aparato): en esta aplicación la inserción
    es siempre manual —se lee el número en el termómetro y se teclea—, así que preguntarlo no tiene
    una respuesta real. `origin` sigue viajando en el sobre cifrado porque el ADR 0006 lo exige, pero
    `temperaturePage.js` lo fija a `manual` sin preguntar.

    Estilo: MediCare+ (DESIGN.md). Todo valor sale de los tokens del tema del panel
    (resources/css/filament/phr/theme.css) y siempre por su PAPEL —`text-ink`, `bg-surface`,
    `border-border`, `error-*`…—, nunca por un tono de la rampa, que no se reasigna en tema oscuro.
--}}
{{--
    El contenido va envuelto en `<x-filament-panels::page>` porque esta página define su propia
    `$view` y, sin ese componente, se salta el contenedor `fi-page-header-main-ctn` de Filament, que
    es el que aporta el `py-8` y la cabecera. Sin él, la primera tarjeta queda pegada a la barra
    superior.
--}}
<x-filament-panels::page>
<div
    x-data="phrTemperaturePage"
    wire:key="temperature-page"
    class="space-y-6"
>
    @php($catalog = $this->catalog())

    {{-- Catálogo público, dato de referencia en claro (ADR 0005, ADR 0008) --}}
    <script type="application/json" data-phr-temperature-catalog>@json($catalog)</script>

    {{-- Card · DESIGN.md § Cards: superficie, borde 1px, radio 8px, sombra Subtle, 24px --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Record body temperature') }}
        </h2>

        <form x-ref="form" @submit.prevent="submit" class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
                <label for="temperature-value" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Temperature') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                {{--
                    IBM Plex Mono: es un valor de medida (DESIGN.md § Do's #7). Numérico y no texto,
                    mismo motivo que en el resto de pantallas: la ambigüedad de separador decimal
                    (`36,8` frente a `36.8`) es un error de lectura que en un dato cifrado no se
                    corrige después, y en una temperatura la décima es justo lo que se mira.
                    `step="any"` acepta decimales y a la vez incrementa de uno en uno con las
                    flechas; el límite de 2 decimales lo impone `numericValue.js`.
                --}}
                {{--
                    El cursor arranca en el valor: es lo que se viene a registrar, y unidad, sitio y
                    fecha ya llegan con un valor puesto. Dos atributos porque son dos situaciones
                    distintas: `autofocus` solo cubre la carga inicial del documento, y al panel se
                    entra casi siempre con `wire:navigate`, que sustituye el cuerpo sin volver a
                    parsearlo; `x-init` cubre ese caso. Un morph de Livewire no reinicializa un
                    elemento que ya existe, así que guardar un registro no vuelve a robar el foco.
                --}}
                <input
                    id="temperature-value"
                    x-ref="value"
                    type="number"
                    min="0"
                    step="any"
                    inputmode="decimal"
                    {{-- El foco se declara tras el bloque numérico, que los tests leen junto. --}}
                    autofocus
                    x-init="$el.focus()"
                    aria-required="true"
                    placeholder="36.8"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div>
                <label for="temperature-unit" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Unit') }}
                </label>
                {{--
                    La etiqueta visible no es el código UCUM: el de Fahrenheit es `[degF]`, con los
                    corchetes que UCUM reserva a las unidades no métricas. Se guarda el código y se
                    muestra `°C` o `°F`, que es la distinción del ADR 0005.
                --}}
                <select
                    id="temperature-unit"
                    x-ref="unit"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    @foreach ($catalog['units'] as $unit)
                        <option value="{{ $unit['code'] }}">{{ $unit['label'] }}</option>
                    @endforeach
                </select>
            </div>

            <div>
                <label for="temperature-site" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Measurement site') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                {{-- Sin opción vacía: es el método de medición (ADR 0008) y es obligatorio. --}}
                <select
                    id="temperature-site"
                    x-ref="site"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    @foreach ($catalog['sites'] as $site)
                        <option value="{{ $site['token'] }}">{{ $site['label'] }}</option>
                    @endforeach
                </select>
            </div>

            <div>
                <label for="temperature-occurred-at" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Date and time') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <input
                    id="temperature-occurred-at"
                    x-ref="occurredAt"
                    type="datetime-local"
                    step="1"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            {{--
                Campos comunes a todo evento (ADR 0006): aparato, quién registra y nota libre. Mismo
                bloque plegable que las demás pantallas, abierto por `open` para que la nota no quede
                escondida tras dos clics.

                `bg-background` y `border-border` (y no `bg-gray-50` / `border-gray-200`): son los
                papeles de § Colors, no tonos de la rampa, y por eso conmutan solos con el tema.
            --}}
            <div class="sm:col-span-2">
                <details open class="rounded-card border border-border bg-background p-pad-md">
                    {{-- Interactivo: 44px de objetivo táctil (Do's #2) y anillo azul al foco
                         (§ Elevation, Do's #9); el selector de `controls.css` solo cubre `fi-*`. --}}
                    <summary class="min-h-11 cursor-pointer rounded-control py-3 text-body-sm font-semibold text-ink focus-visible:shadow-focus-blue focus-visible:outline-none">
                        {{ __('Record details (optional)') }}
                    </summary>

                    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label for="temperature-device" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Device') }}
                            </label>
                            <input
                                id="temperature-device"
                                x-ref="device"
                                type="text"
                                placeholder="{{ __('E.g. Braun ThermoScan') }}"
                                class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                            >
                        </div>

                        <div>
                            <label for="temperature-recorded-by" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Recorded by') }}
                            </label>
                            <select
                                id="temperature-recorded-by"
                                x-ref="recordedBy"
                                class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                            >
                                @foreach ($catalog['recordedByRoles'] ?? [] as $recordedByRole)
                                    <option value="{{ $recordedByRole['token'] }}">{{ $recordedByRole['label'] }}</option>
                                @endforeach
                            </select>
                        </div>

                        <div class="sm:col-span-2">
                            <label for="temperature-note" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Note') }}
                            </label>
                            <textarea
                                id="temperature-note"
                                x-ref="note"
                                rows="3"
                                placeholder="{{ __('Anything that does not fit in the fields above') }}"
                                class="block w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                            ></textarea>
                        </div>
                    </div>
                </details>
            </div>

            <div class="sm:col-span-2">
                {{--
                    Botón primario · § Buttons · Primary, con los mismos tokens que el resto del
                    panel: `bg-accent` + `text-accent-ink`, que conmutan solos en oscuro (§ Dark Mode
                    · Components), y `disabled:bg-surface-disabled` + `disabled:text-ink-disabled`
                    para el estado deshabilitado. Sin la clase `fi-btn`, que añadiría un anillo de
                    foco en `currentColor` y un `opacity: 70%` en deshabilitado.

                    Entre el clic y el repintado del historial hay sellado AEAD e ida y vuelta a
                    Livewire. `loading` deshabilita el botón, marca `aria-busy` y cambia el texto,
                    para que la espera se vea (Do's #3) y no se pulse dos veces: un segundo clic no
                    es un doble envío inocuo, es una lectura duplicada en el historial.
                --}}
                <div class="flex flex-wrap items-center gap-4">
                    <button
                        type="submit"
                        class="inline-flex min-h-11 items-center justify-center rounded-control bg-accent px-6 py-2.5 text-button text-accent-ink hover:bg-accent-hover focus-visible:shadow-focus-blue focus-visible:outline-none active:bg-accent-active disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-ink-disabled disabled:hover:bg-surface-disabled"
                        x-bind:disabled="loading"
                        x-bind:aria-busy="loading ? 'true' : 'false'"
                    >
                        <span x-show="! loading">{{ __('Save') }}</span>
                        <span x-show="loading" x-cloak>{{ __('Saving…') }}</span>
                    </button>

                    {{--
                        Confirmación de guardado, al lado del botón y no al pie de la página: es ahí
                        donde está mirando quien acaba de pulsar. Se va sola a los pocos segundos
                        (ver `savedNotice.js`). Nunca repite el valor guardado: no hace falta para
                        confirmar y son datos clínicos.

                        `role="status"` (que ya implica `aria-live="polite"`) y no `alert`: es una
                        buena noticia, no interrumpe lo que se esté leyendo.
                    --}}
                    <p
                        x-show="saved"
                        x-cloak
                        role="status"
                        class="text-body-sm font-semibold text-ink"
                    >
                        {{ __('Record saved.') }}
                    </p>
                </div>
            </div>
        </form>

        {{--
            Error de validación o de cifrado. DESIGN.md § Helper Text pide 13px en rojo con icono de
            aviso delante (Do's #3: nunca solo color). Los tres colores salen de los tokens
            `error-surface` / `error-outline` / `error-ink`, que conmutan solos con el tema.

            `role="alert"` ya implica `aria-live="assertive"`: va solo el rol, como en las demás
            pantallas.
        --}}
        <div
            x-show="error"
            x-cloak
            role="alert"
            class="mt-4 flex items-start gap-2 rounded-control border border-error-outline bg-error-surface px-3.5 py-2.5"
        >
            <svg class="mt-px size-5 shrink-0 text-error-ink" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clip-rule="evenodd" />
            </svg>
            <p
                x-ref="error"
                x-text="error"
                class="text-helper text-error-ink"
            ></p>
        </div>
    </section>

    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('History') }}
        </h2>

        {{--
            Rango de fechas del historial. Va FUERA del `@island`: el island lo vacía el servidor en
            cada petición de Livewire (ver el comentario de la región descifrada), y el control es
            marcado que el servidor sí renderiza y tiene que sobrevivir a la recarga que él mismo
            dispara.
        --}}
        @include('phr.partials.date-range', ['idPrefix' => 'temperature'])

        @island(name: 'temperature-list')
            <div wire:ignore x-ref="list" wire:key="temperature-list-region" class="mt-4"></div>
        @endisland
    </section>

    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Temperature chart') }}
        </h2>

        {{--
            Región descifrada, con `wire:ignore` y `wire:key` estable (ADR 0002).

            El lienzo y su pie NO van dentro de un `@island`, a diferencia del historial. Comprobado
            ejecutando las otras pantallas: tras cualquier petición de Livewire el servidor emite el
            island vacío, y el `<canvas>` y el pie desaparecen del HTML, así que `$refs.chart` y
            `$refs.chartCaption` quedan indefinidos y guardar un registro revienta con «Cannot set
            properties of undefined». El island no aporta nada aquí: esta región no la renderiza
            nunca el servidor, la construye Alpine entera, y `wire:ignore` ya es el mecanismo que
            impide que el morph la toque.

            El contenedor de altura fija envuelve **solo** al `<canvas>`: Chart.js exige que el padre
            del lienzo esté dedicado en exclusiva a la gráfica cuando corre con
            `maintainAspectRatio: false`. El pie va fuera, como hermano del contenedor.

            El `<canvas>` es un objeto gráfico sin texto: lleva `role="img"` con nombre accesible y
            `aria-describedby` al pie, que es donde están en texto los sitios de medida incluidos
            (Do's #3: la tendencia no puede comunicarse solo por color de línea).
        --}}
        <div wire:ignore wire:key="temperature-chart-region">
            <div class="mt-4 h-80">
                <canvas
                    x-ref="chart"
                    role="img"
                    aria-label="{{ __('Body temperature trend by measurement site') }}"
                    aria-describedby="temperature-chart-caption"
                ></canvas>
            </div>

            {{-- Caption: Open Sans 12px medium, texto secundario #475569. --}}
            <p
                id="temperature-chart-caption"
                x-ref="chartCaption"
                class="mt-2 text-caption text-ink-secondary"
            ></p>
        </div>
    </section>
</div>
</x-filament-panels::page>
