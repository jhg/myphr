{{--
    Pantalla de glucemia (ADR 0002, ADR 0004, ADR 0005, ADR 0006, ADR 0008).

    Estructura fija: otro agente escribe `phrGlucosePage` en Alpine contra este contrato, así que
    los `x-ref`, el nombre del componente y `data-phr-glucose-catalog` no se tocan aquí.

    El formulario no lleva `wire:model`: Alpine lee los campos del DOM, cifra en el navegador y
    llama a `storeEvent` —el método común de `HealthEventPage`, que es donde vive de verdad; el
    nombre lo comprueba `tests/Feature/GlucosePageTest.php` para que no se repita el
    `MethodNotFoundException` de producción— como acción de método, fuera de cualquier island.

    De las dos regiones descifradas, **solo el historial va dentro de un `@island`**; la gráfica no,
    y no es un descuido: ver el comentario que la precede, más abajo. Las dos llevan `wire:ignore` y
    `wire:key` estable, que es lo que impide que un re-render de Livewire las borre (ADR 0002).

    Los `<option>` de `unit`, `method`, `mealContext` y `recordedBy` se renderizan aquí, en
    Blade, en vez de rellenarlos por JavaScript en `init()`. Esos `<select>` NO están dentro de un `wire:ignore`, así
    que en cuanto Livewire hace su primera petición (p. ej. `fetchEvents`), el morph del DOM
    restaura el HTML tal como lo emitió el servidor y borra cualquier opción que Alpine hubiera
    escrito, sin error visible (ADR 0002, "el morph del DOM sobrescribe el texto que Alpine haya
    escrito"). El catálogo es dato público de referencia en claro (ADR 0005), así que el servidor sí
    puede emitirlo: al ser el propio servidor quien pinta las opciones, el morph reproduce
    exactamente lo mismo y no hay nada que perder.

    Estilo: MediCare+ (DESIGN.md). Todo valor sale de los tokens del tema del panel
    (resources/css/filament/phr/theme.css y PhrPanelProvider), y siempre por su PAPEL, nunca    por un tono de la rampa: `text-ink`, `text-ink-secondary`, `placeholder:text-ink-muted`,    `border-border-strong`, `bg-accent` + `text-accent-ink`, `text-destructive-text`. La rampa    gris se reasigna entera en `:root.dark` (§ Ramp Mapping — Dark), así que un `text-gray-900`    sin pareja `dark:` no se atenúa: se invierte y el dato clínico desaparece. `shadow-sm` es la    elevación Subtle y `shadow-focus-blue` el anillo de foco azul. Aquí no se inventa ningún    color ni tamaño.
--}}
{{--
    El contenido va envuelto en `<x-filament-panels::page>` porque esta página define su propia
    `$view` y, sin ese componente, se salta el contenedor `fi-page-header-main-ctn` de Filament, que
    es el que aporta el `py-8` y la cabecera. Sin él, la primera tarjeta queda pegada a la barra
    superior. La clase `fi-page` la pone ya ese componente, así que aquí no se repite.
--}}
<x-filament-panels::page>
<div
    x-data="phrGlucosePage"
    wire:key="glucose-page"
    class="space-y-6"
>
    @php($catalog = $this->catalog())

    {{-- Catálogo público, dato de referencia en claro (ADR 0005) --}}
    <script type="application/json" data-phr-glucose-catalog>@json($catalog)</script>

    {{-- Card · DESIGN.md § Cards: relleno blanco, borde 1px #E2E8F0, radio 8px, sombra Subtle, 24px --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        {{-- Subhead · Figtree 20px semibold --}}
        <h2 class="font-display text-subhead text-ink">
            {{ __('Record a blood glucose reading') }}
        </h2>

        {{-- Sin `x-ref="form"`: ningún `$refs` del módulo lo lee, y un `x-ref` que nadie usa solo
             sugiere un contrato de DOM que no existe. --}}
        <form @submit.prevent="submit" class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
                {{-- Label · Open Sans 14px 600 #0F172A, 6px de margen inferior; asterisco #DC2626 en obligatorios --}}
                <label for="glucose-value" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Value') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                {{-- IBM Plex Mono: es un valor de medida (DESIGN.md § Do's #7) --}}
                {{--
                    Numérico, no texto: con un campo de texto se puede teclear tanto `7,8` como
                    `7.8`, y esa ambigüedad de separador decimal es un error de lectura/parseo que
                    en un dato clínico cifrado no se puede corregir después. `step="any"` deja que
                    el navegador incremente de uno en uno con las flechas y a la vez acepte
                    decimales (con `step="1"` marcaría `7.5` como inválido); el límite de 2
                    decimales lo impone `numericValue.js` en el cliente, antes de cifrar.
                --}}
                <input
                    id="glucose-value"
                    x-ref="value"
                    type="number"
                    min="0"
                    step="any"
                    inputmode="decimal"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div>
                <label for="glucose-unit" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Unit') }}
                </label>
                {{-- Los códigos UCUM (mg/dL, mmol/L) van en monoespaciada --}}
                <select
                    id="glucose-unit"
                    x-ref="unit"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    @foreach ($catalog['units'] as $unit)
                        <option value="{{ $unit['code'] }}">{{ $unit['label'] }}</option>
                    @endforeach
                </select>
            </div>

            <div>
                <label for="glucose-method" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Measurement method') }}
                </label>
                <select
                    id="glucose-method"
                    x-ref="method"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    @foreach ($catalog['methods'] as $method)
                        <option value="{{ $method['token'] }}">{{ $method['label'] }}</option>
                    @endforeach
                </select>
            </div>

            <div>
                <label for="glucose-meal-context" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Relative to meals') }}
                </label>
                {{--
                    Primera opción vacía y seleccionada de entrada (ADR 0006, decisión del
                    2026-07-25): el contexto de comida es opcional y no viene preseleccionado, para
                    que quien no toca el desplegable no guarde "en ayunas" como si lo hubiera
                    afirmado. Alpine lee esta cadena vacía y `buildGlucoseContent` la omite del
                    contenido cifrado en vez de guardarla.
                --}}
                <select
                    id="glucose-meal-context"
                    x-ref="mealContext"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    <option value="" selected>{{ __('Not specified') }}</option>
                    @foreach ($catalog['mealContexts'] as $mealContext)
                        <option value="{{ $mealContext['token'] }}">{{ $mealContext['label'] }}</option>
                    @endforeach
                </select>
            </div>

            <div>
                <label for="glucose-occurred-at" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Date and time') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                {{-- Marca temporal numérica: monoespaciada para que no se lea mal --}}
                <input
                    id="glucose-occurred-at"
                    x-ref="occurredAt"
                    type="datetime-local"
                    step="1"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            {{--
                Campos comunes a todo evento (ADR 0006, "Campos que se capturan aunque hoy no se
                usen"): aparato, quién registra y nota libre. Van en un bloque plegable, abierto por
                `open` para que la nota no quede escondida tras dos clics, pero visualmente por
                detrás del valor y la fecha, que son lo principal.

                No hay campo de "origen del dato" (manual/aparato): la inserción aquí es siempre
                manual, la persona lee el valor en su glucómetro o sensor y lo teclea, así que
                preguntarlo no tiene respuesta real. `origin` sigue viajando en el sobre cifrado
                (ADR 0006) pero `buildCommonEventFields()` lo fija a `manual` sin preguntarlo — ver
                el JSDoc de `resources/js/health/eventCommonFields.js` para la distinción entre
                `origin` (cómo entró el dato) y este campo `device` de abajo (con qué se midió).
            --}}
            <div class="sm:col-span-2">
                {{--
                    `bg-background` y `border-border` (y no `bg-gray-50` / `border-gray-200`): son
                    los papeles de § Colors, no tonos de la rampa, y por eso conmutan solos con el
                    tema. En oscuro, el `gray-50` de la rampa es casi blanco y el `gray-200` es la
                    tinta: este bloque saldría como un rectángulo claro con marco blanco.
                --}}
                <details open class="rounded-card border border-border bg-background p-pad-md">
                    {{--
                        El `<summary>` es un elemento interactivo, así que le toca lo mismo que a
                        los botones y los campos: 44px de objetivo táctil (Do's #2) con `min-h-11`
                        más `py-3`, y el anillo azul de dos capas al foco de teclado (§ Elevation,
                        Do's #9). El selector de foco de `controls.css` enumera clases `fi-*` y no
                        llega hasta aquí, de modo que sin esto se quedaba con el contorno por
                        defecto del navegador y el recorrido de teclado cambiaba de señal.
                    --}}
                    <summary class="min-h-11 cursor-pointer rounded-control py-3 text-body-sm font-semibold text-ink focus-visible:shadow-focus-blue focus-visible:outline-none">
                        {{ __('Record details (optional)') }}
                    </summary>

                    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label for="glucose-device" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Device') }}
                            </label>
                            <input
                                id="glucose-device"
                                x-ref="device"
                                type="text"
                                placeholder="{{ __('E.g. Freestyle Libre 3') }}"
                                class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                            >
                        </div>

                        <div>
                            <label for="glucose-recorded-by" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Recorded by') }}
                            </label>
                            <select
                                id="glucose-recorded-by"
                                x-ref="recordedBy"
                                class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                            >
                                @foreach ($catalog['recordedByRoles'] ?? [] as $recordedByRole)
                                    <option value="{{ $recordedByRole['token'] }}">{{ $recordedByRole['label'] }}</option>
                                @endforeach
                            </select>
                        </div>

                        <div class="sm:col-span-2">
                            <label for="glucose-note" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Note') }}
                            </label>
                            <textarea
                                id="glucose-note"
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
                    deshabilitado. Los botones de login y de establecer contraseña tampoco la
                    llevan; así los tres se comportan igual.

                    Entre el clic y el repintado del historial hay sellado AEAD e ida y vuelta a
                    Livewire. `loading` deshabilita el botón, marca `aria-busy` y cambia el texto,
                    para que la espera se vea (Do's #3) y no se pulse dos veces, igual que en las
                    pantallas de acceso.
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
            Error de validación o de cifrado. DESIGN.md § Helper Text pide 13px en rojo con icono
            de aviso delante (Do's #3: nunca solo color). El texto lo escribe `x-text`, no un
            `$refs`, así que el `<p>` no necesita `x-ref`; el icono va fuera para que Alpine no lo
            sobrescriba al escribir el texto.

            Los tres colores salen de los tokens `error-surface` / `error-outline` / `error-ink`,
            que conmutan solos entre § Chips y § Dark Mode · Status Chip. La tinta clara es #B91C1C
            y no el #DC2626 de § Chips porque ese par sobre #FEF2F2 da 4.41:1, por debajo del 4.5:1
            de Do's #1; el porqué está en `theme.css`, junto a los tokens.

            `role="alert"` ya implica `aria-live="assertive"`; declarar `polite` encima lo degrada y
            deja el anuncio a merced del lector de pantalla. Va solo el rol, como en login y en
            establecer contraseña. Mismo relleno y mismo tamaño de texto que esos dos avisos.
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
                x-text="error"
                class="text-helper text-error-ink"
            ></p>
        </div>
    </section>

    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('History') }}
        </h2>

        @island(name: 'glucose-list')
            <div wire:ignore x-ref="list" wire:key="glucose-list-region" class="mt-4"></div>
        @endisland
    </section>

    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Chart') }}
        </h2>

        {{--
            Región descifrada, con `wire:ignore` y `wire:key` estable (ADR 0002). Sin `@island`,
            por el motivo que explica el comentario que precede al contenedor, más abajo.

            El contenedor de altura fija envuelve **solo** al `<canvas>`: Chart.js exige que el
            padre del lienzo esté dedicado en exclusiva a la gráfica cuando corre con
            `maintainAspectRatio: false`. El pie va fuera, como hermano del contenedor, o desbordaría
            por debajo y podría disparar el bucle de redimensionado del lienzo.

            320px de alto son 40 veces la unidad base de 8px de DESIGN.md § Spacing. Es una
            dimensión de contenedor, no un espaciado: la escala de 4…80px gobierna márgenes y
            rellenos, no el alto de un lienzo.

            El `<canvas>` es un objeto gráfico sin texto: lleva `role="img"` con nombre accesible y
            `aria-describedby` al pie, que es donde están en texto los métodos incluidos y los
            registros excluidos (Do's #3: la tendencia no puede comunicarse solo por color de
            línea).
        --}}
{{--
            El lienzo y su pie NO van dentro de un `@island`, a diferencia del historial. Comprobado
            ejecutando el componente: tras cualquier petición de Livewire el servidor emite el island
            vacío, y el `<canvas>` y el pie desaparecen del HTML, así que `$refs.chart` y
            `$refs.chartCaption` quedan indefinidos y guardar un registro revienta con «Cannot set
            properties of undefined». El island no aporta nada aquí: esta región no la renderiza
            nunca el servidor, la construye Alpine entera, y `wire:ignore` ya es el mecanismo que
            impide que el morph la toque (ADR 0002).
        --}}
            <div wire:ignore wire:key="glucose-chart-region">
                <div class="mt-4 h-80">
                    <canvas
                        x-ref="chart"
                        role="img"
                        aria-label="{{ __('Blood glucose trend by measurement method') }}"
                        aria-describedby="glucose-chart-caption"
                    ></canvas>
                </div>

                {{-- Caption: Open Sans 12px medium, texto secundario #475569. --}}
                <p
                    id="glucose-chart-caption"
                    x-ref="chartCaption"
                    class="mt-2 text-caption text-ink-secondary"
                ></p>
            </div>
    </section>
</div>
</x-filament-panels::page>
