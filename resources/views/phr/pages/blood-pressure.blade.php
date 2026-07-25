{{--
    Pantalla de tensión arterial (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).

    Estructura calcada de `glucose.blade.php`: componente Alpine `phrBloodPressurePage`, sin
    `wire:model` (ADR 0002). Alpine lee los campos del DOM, cifra en el navegador y llama a
    `storeEvent` —el método común de `App\Filament\Pages\HealthEventPage`— como acción de método,
    fuera de cualquier island.

    El historial descifrado vive dentro de su `@island`, con `wire:ignore` **dentro** y `wire:key`
    estable, las dos capas que pide ADR 0002 § Decision. Las dos gráficas llevan `wire:ignore` y
    `wire:key` pero NO island: el porqué, comprobado ejecutando el componente, está junto a la
    gráfica de tensión.

    Los `<option>` de `arm`, `posture` y `recordedBy` se renderizan aquí, en Blade, y no por
    JavaScript: esos `<select>` no están dentro de un `wire:ignore`, así que el morph de Livewire los
    borraría si los rellenara Alpine (ver el mismo razonamiento en `glucose.blade.php`). El catálogo
    es dato público de referencia en claro (ADR 0005, ADR 0008).

    Un solo evento con sistólica, diastólica y pulso juntos (ADR 0006): un único formulario con tres
    campos numéricos, no tres formularios. El pulso no lleva asterisco: es opcional, porque no todos
    los tensiómetros lo miden.

    El formulario NO pregunta el origen del dato (manual o aparato): en esta aplicación la
    inserción es siempre manual —se lee un valor en un tensiómetro y se teclea—, así que
    preguntarlo no tiene una respuesta real y solo invita a contestar mal. `origin` sigue viajando
    en el sobre cifrado porque el ADR 0006 lo exige y no se recupera después, pero
    `bloodPressurePage.js` lo fija a `manual` sin preguntar. El día que exista una importación
    automática desde un aparato, será ese flujo el que ponga `device`, no este formulario.

    Estilo: MediCare+ (DESIGN.md). Todo valor sale de los tokens del tema del panel
    (resources/css/filament/phr/theme.css): `rounded-card`, `p-card`, `bg-surface`, `border-border`,
    `text-helper`, `error-*`… y no de las rampas `gray`/`danger` en crudo, que no se reasignan en
    tema oscuro y pintaban esta pantalla como un bloque blanco con marco claro. Mismas clases
    exactas que `glucose.blade.php`.
--}}
{{--
    El contenido va envuelto en `<x-filament-panels::page>` porque esta página define su propia
    `$view` y, sin ese componente, se salta el contenedor `fi-page-header-main-ctn` de Filament, que
    es el que aporta el `py-8` y la cabecera. Sin él, la primera tarjeta queda pegada a la barra
    superior.
--}}
<x-filament-panels::page>
<div
    x-data="phrBloodPressurePage"
    wire:key="blood-pressure-page"
    class="space-y-6"
>
    @php($catalog = $this->catalog())

    {{-- Catálogo público, dato de referencia en claro (ADR 0005, ADR 0008) --}}
    <script type="application/json" data-phr-blood-pressure-catalog>@json($catalog)</script>

    {{-- Card · DESIGN.md § Cards: superficie, borde 1px, radio 8px, sombra Subtle, 24px --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Record blood pressure') }}
        </h2>

        <form x-ref="form" @submit.prevent="submit" class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
                <label for="bp-systolic" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Systolic') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                {{--
                    IBM Plex Mono: es un valor de medida (DESIGN.md § Do's #7). Numérico y no
                    texto, mismo motivo que en `glucose.blade.php`: la ambigüedad de separador
                    decimal (`7,8` frente a `7.8`) es un error de lectura que en un dato cifrado no
                    se corrige después. `step="any"` acepta decimales y a la vez incrementa de uno
                    en uno con las flechas; el límite de 2 decimales lo impone `numericValue.js`.
                --}}
                <input
                    id="bp-systolic"
                    x-ref="systolic"
                    type="number"
                    min="0"
                    step="any"
                    inputmode="decimal"
                    aria-required="true"
                    placeholder="120"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div>
                <label for="bp-diastolic" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Diastolic') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <input
                    id="bp-diastolic"
                    x-ref="diastolic"
                    type="number"
                    min="0"
                    step="any"
                    inputmode="decimal"
                    aria-required="true"
                    placeholder="80"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div>
                <label for="bp-pulse" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Pulse') }}
                </label>
                {{-- Sin asterisco: opcional, no todos los tensiómetros lo miden (ADR 0006) --}}
                <input
                    id="bp-pulse"
                    x-ref="pulse"
                    type="number"
                    min="0"
                    step="any"
                    inputmode="decimal"
                    placeholder="72"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div>
                <label for="bp-arm" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Arm') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                {{--
                    Sin opción vacía: el brazo forma parte del método de medición (ADR 0008) y no
                    tiene un valor por defecto razonable, pero sí es obligatorio, así que se deja
                    la primera opción del catálogo preseleccionada y quien registra la confirma o
                    la cambia, en vez de forzar un desplegable vacío en un campo obligatorio.
                --}}
                <select
                    id="bp-arm"
                    x-ref="arm"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    @foreach ($catalog['arms'] as $arm)
                        <option value="{{ $arm['token'] }}">{{ $arm['label'] }}</option>
                    @endforeach
                </select>
            </div>

            <div>
                <label for="bp-posture" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Posture') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <select
                    id="bp-posture"
                    x-ref="posture"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    @foreach ($catalog['postures'] as $posture)
                        <option value="{{ $posture['token'] }}">{{ $posture['label'] }}</option>
                    @endforeach
                </select>
            </div>

            <div>
                <label for="bp-occurred-at" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Date and time') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <input
                    id="bp-occurred-at"
                    x-ref="occurredAt"
                    type="datetime-local"
                    step="1"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            {{--
                Campos comunes a todo evento (ADR 0006): aparato, quién registra y nota libre. Mismo
                bloque plegable que `glucose.blade.php`, abierto por `open` para que la nota no quede
                escondida tras dos clics.

                `bg-background` y `border-border` (y no `bg-gray-50` / `border-gray-200`): son los
                papeles de § Colors, no tonos de la rampa, y por eso conmutan solos con el tema. En
                oscuro, el `gray-50` de la rampa es casi blanco y el `gray-200` es la tinta: este
                bloque salía como un rectángulo claro con marco blanco.
            --}}
            <div class="sm:col-span-3">
                <details open class="rounded-card border border-border bg-background p-pad-md">
                    {{-- Interactivo: 44px de objetivo táctil (Do's #2) y anillo azul al foco
                         (§ Elevation, Do's #9); el selector de `controls.css` solo cubre `fi-*`. --}}
                    <summary class="min-h-11 cursor-pointer rounded-control py-3 text-body-sm font-semibold text-ink focus-visible:shadow-focus-blue focus-visible:outline-none">
                        {{ __('Record details (optional)') }}
                    </summary>

                    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label for="bp-device" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Device') }}
                            </label>
                            <input
                                id="bp-device"
                                x-ref="device"
                                type="text"
                                placeholder="{{ __('E.g. Omron M3') }}"
                                class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                            >
                        </div>

                        <div>
                            <label for="bp-recorded-by" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Recorded by') }}
                            </label>
                            <select
                                id="bp-recorded-by"
                                x-ref="recordedBy"
                                class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                            >
                                @foreach ($catalog['recordedByRoles'] ?? [] as $recordedByRole)
                                    <option value="{{ $recordedByRole['token'] }}">{{ $recordedByRole['label'] }}</option>
                                @endforeach
                            </select>
                        </div>

                        <div class="sm:col-span-2">
                            <label for="bp-note" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Note') }}
                            </label>
                            <textarea
                                id="bp-note"
                                x-ref="note"
                                rows="3"
                                placeholder="{{ __('Anything that does not fit in the fields above') }}"
                                class="block w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                            ></textarea>
                        </div>
                    </div>
                </details>
            </div>

            <div class="sm:col-span-3">
                {{--
                    Botón primario · § Buttons · Primary: relleno #0077B6, tinta #FFFFFF, 15px semibold,
                    10/24 de padding, 44px de alto mínimo.
                    
                    Va en `bg-accent` + `text-accent-ink`, no en `bg-primary-600` + `text-white`: la rampa
                    `primary` NO se reasigna en oscuro, así que el relleno seguía siendo #0077B6 y el
                    blanco encima daba 4.87:1 sobre un fondo de página #0B1220 — y sobre todo dejaba de
                    cumplir § Dark Mode · Components, que fija #48CAE4 de relleno con tinta #0B1220 y dice
                    con todas las letras que «white text on this fill cannot reach AA» (1.94:1). Con los dos
                    tokens el par es #FFFFFF sobre #0077B6 (4.87:1) en claro y #0B1220 sobre #48CAE4
                    (9.67:1) en oscuro, sin ninguna variante `dark:` que se pueda olvidar.
                    
                    El estado deshabilitado va por el mismo camino: `disabled:bg-surface-disabled` +
                    `disabled:text-ink-disabled` son #E2E8F0/#94A3B8 en claro (§ Buttons · Disabled) y
                    #1B2740/#8093AE en oscuro (§ Dark Mode · Button Disabled, 4.75:1).

                    Sin la clase `fi-btn`: el CSS del vendor le añadiría un `focus-visible:ring-2`
                    en `currentColor` —blanco, sobre el anillo azul de § Elevation— y un
                    `[disabled] { opacity: 70% }` que rebajaría todavía más el contraste del estado
                    deshabilitado. Los botones de login, de glucemia y de establecer contraseña
                    tampoco la llevan.

                    Entre el clic y el repintado del historial hay sellado AEAD e ida y vuelta a
                    Livewire. `loading` deshabilita el botón, marca `aria-busy` y cambia el texto,
                    para que la espera se vea (Do's #3) y no se pulse dos veces: en esta pantalla un
                    segundo clic no es un doble envío inocuo, es una lectura de tensión duplicada en
                    el historial.
                --}}
                <button
                    type="submit"
                    class="inline-flex min-h-11 items-center justify-center rounded-control bg-accent px-6 py-2.5 text-button text-accent-ink hover:bg-accent-hover focus-visible:shadow-focus-blue focus-visible:outline-none active:bg-accent-active disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-ink-disabled disabled:hover:bg-surface-disabled"
                    x-bind:disabled="loading"
                    x-bind:aria-busy="loading ? 'true' : 'false'"
                >
                    <span x-show="! loading">{{ __('Save') }}</span>
                    <span x-show="loading" x-cloak>{{ __('Saving…') }}</span>
                </button>
            </div>
        </form>

        {{--
            Error de validación o de cifrado. DESIGN.md § Helper Text pide 13px en rojo con icono de
            aviso delante (Do's #3: nunca solo color). Los tres colores salen de los tokens
            `error-surface` / `error-outline` / `error-ink`, que conmutan solos entre § Chips y
            § Dark Mode · Status Chip.

            `role="alert"` ya implica `aria-live="assertive"`; el `aria-live="polite"` que había aquí
            lo degradaba y dejaba el anuncio a merced del lector de pantalla. Va solo el rol, como en
            glucemia, login y establecer contraseña.
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

        @island(name: 'blood-pressure-list')
            <div wire:ignore x-ref="list" wire:key="blood-pressure-list-region" class="mt-4"></div>
        @endisland
    </section>

    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Blood pressure chart') }}
        </h2>

        {{--
            Región descifrada, con `wire:ignore` y `wire:key` estable (ADR 0002).

            El lienzo y su pie NO van dentro de un `@island`, a diferencia del historial. Comprobado
            ejecutando el componente: tras cualquier petición de Livewire el servidor emite el island
            vacío, y el `<canvas>` y el pie desaparecen del HTML, así que `$refs.chart` y
            `$refs.chartCaption` quedan indefinidos y guardar un registro revienta con «Cannot set
            properties of undefined». El island no aporta nada aquí: esta región no la renderiza
            nunca el servidor, la construye Alpine entera, y `wire:ignore` ya es el mecanismo que
            impide que el morph la toque (ADR 0002).

            Las tres pantallas con gráfica hacen lo mismo: glucemia, insulina y esta envuelven su
            historial en un `@island` y dejan el lienzo fuera, en un `wire:ignore` con `wire:key`
            estable. No hay ninguna incoherencia que armonizar, y meter el lienzo en un island es
            exactamente la regresión descrita arriba.

            El contenedor de altura fija envuelve **solo** al `<canvas>`: Chart.js exige que el padre
            del lienzo esté dedicado en exclusiva a la gráfica cuando corre con
            `maintainAspectRatio: false`. El pie va fuera, como hermano del contenedor; antes lo
            creaba el JavaScript e iba dentro, que es justo lo que podía disparar el bucle de
            redimensionado del lienzo.

            El `<canvas>` es un objeto gráfico sin texto: lleva `role="img"` con nombre accesible y
            `aria-describedby` al pie, que es donde están en texto los métodos incluidos (Do's #3: la
            tendencia no puede comunicarse solo por color de línea).
        --}}
        <div wire:ignore wire:key="blood-pressure-chart-region">
            <div class="mt-4 h-80">
                <canvas
                    x-ref="chart"
                    role="img"
                    aria-label="{{ __('Blood pressure trend by measurement method') }}"
                    aria-describedby="blood-pressure-chart-caption"
                ></canvas>
            </div>

            {{-- Caption: Open Sans 12px medium, texto secundario #475569. --}}
            <p
                id="blood-pressure-chart-caption"
                x-ref="chartCaption"
                class="mt-2 text-caption text-ink-secondary"
            ></p>
        </div>
    </section>

    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        {{-- El pulso va aparte: no comparte escala con la presión (ADR 0006, un solo evento, dos gráficas) --}}
        <h2 class="font-display text-subhead text-ink">
            {{ __('Pulse chart') }}
        </h2>

        {{-- Sin `@island`, por el mismo motivo que la gráfica de tensión de arriba. --}}
        <div wire:ignore wire:key="blood-pressure-pulse-chart-region">
            <div class="mt-4 h-80">
                <canvas
                    x-ref="pulseChart"
                    role="img"
                    aria-label="{{ __('Pulse trend by measurement method') }}"
                    aria-describedby="blood-pressure-pulse-chart-caption"
                ></canvas>
            </div>

            <p
                id="blood-pressure-pulse-chart-caption"
                x-ref="pulseChartCaption"
                class="mt-2 text-caption text-ink-secondary"
            ></p>
        </div>
    </section>
</div>
</x-filament-panels::page>
