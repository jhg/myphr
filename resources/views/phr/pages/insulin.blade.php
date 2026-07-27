{{--
    Pantalla de insulina inyectada (ADR 0002, ADR 0004, ADR 0005, ADR 0006).

    Estructura fija: el componente Alpine que este fichero contrata es `phrInsulinPage`
    (`resources/js/health/insulinPage.js`), así que los `x-ref`, el nombre del componente y
    `data-phr-insulin-catalog` no se cambian sin actualizar ese fichero también.

    El formulario no lleva `wire:model`: Alpine lee los campos del DOM, cifra en el navegador y
    llama a `storeEvent` (la acción común de `HealthEventPage`) como acción de método, fuera de
    cualquier island.

    De las dos regiones descifradas, **solo el historial va dentro de un `@island`**; la gráfica no,
    y no es un descuido: ver el comentario que la precede, más abajo. Las dos llevan `wire:ignore` y
    `wire:key` estable, que es lo que impide que un re-render de Livewire las borre (ADR 0002).

    Los `<option>` de `insulinType`, `site` y `recordedBy` se renderizan aquí, en Blade, en vez de
    rellenarlos por JavaScript en `init()`. Esos `<select>` NO están dentro de un `wire:ignore`, así
    que en cuanto Livewire hace su primera petición (p. ej. `fetchEvents`), el morph del DOM
    restaura el HTML tal como lo emitió el servidor y borra cualquier opción que Alpine hubiera
    escrito, sin error visible (ADR 0002). El catálogo es dato público de referencia en claro (ADR
    0005), así que el servidor sí puede emitirlo: al ser el propio servidor quien pinta las
    opciones, el morph reproduce exactamente lo mismo y no hay nada que perder.

    NO hay campo de "origen del dato" (manual/aparato): hoy la entrada siempre es manual, no existe
    ninguna integración con ningún aparato en esta pantalla, y preguntarlo no tiene una respuesta
    real. `origin` sigue viajando en el sobre cifrado porque el ADR 0006 lo exige, pero
    `insulinPage.js` lo fija a `manual` sin mostrar ningún control (ver JSDoc de ese fichero). El
    campo de aparato (`device`) sí se pregunta: en insulina es el bolígrafo o la bomba, información
    útil incluso con entrada manual.

    Riesgo propio de esta pantalla: una dosis mal leída es una dosis mal puesta. La dosis va en
    monoespaciada, con 44px de alto mínimo y contraste alto, tanto en el formulario como en el
    historial (DESIGN.md, objetivos táctiles y Do's #7).

    Estilo: MediCare+ (DESIGN.md). Todo valor sale de los tokens del tema del panel
    (resources/css/filament/phr/theme.css y PhrPanelProvider), y siempre por su PAPEL, nunca    por un tono de la rampa: `text-ink`, `text-ink-secondary`, `placeholder:text-ink-muted`,    `border-border-strong`, `bg-accent` + `text-accent-ink`, `text-destructive-text`. La rampa    gris se reasigna entera en `:root.dark` (§ Ramp Mapping — Dark), así que un `text-gray-900`    sin pareja `dark:` no se atenúa: se invierte y el dato clínico desaparece. `shadow-sm` es la    elevación Subtle y `shadow-focus-blue` el anillo de foco azul. Aquí no se inventa ningún    color ni tamaño.

    Las superficies y los bordes van en tokens de papel (`bg-surface`, `bg-background`,
    `border-border`, `rounded-card`, `p-card`, `rounded-control`, `error-*`) y no en tonos de la
    rampa: los papeles conmutan solos con § Dark Mode, mientras que un `bg-white` o un `bg-gray-50`
    fijos dejan la tarjeta blanca —y el texto blanco sobre blanco— en tema oscuro.
--}}
{{--
    El contenido va envuelto en `<x-filament-panels::page>` porque esta página define su propia
    `$view` y, sin ese componente, se salta el contenedor `fi-page-header-main-ctn` de Filament, que
    es el que aporta el `py-8` y la cabecera. Sin él, la primera tarjeta queda pegada a la barra
    superior. La clase `fi-page` la pone ya ese componente, así que aquí no se repite.
--}}
<x-filament-panels::page>
<div
    x-data="phrInsulinPage"
    wire:key="insulin-page"
    class="space-y-6"
>
    @php($catalog = $this->catalog())

    {{-- Catálogo público, dato de referencia en claro (ADR 0005) --}}
    <script type="application/json" data-phr-insulin-catalog>@json($catalog)</script>

    {{-- Card · DESIGN.md § Cards: relleno blanco, borde 1px #E2E8F0, radio 8px, sombra Subtle, 24px --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        {{-- Subhead · Figtree 20px semibold --}}
        <h2 class="font-display text-subhead text-ink">
            {{ __('Record insulin') }}
        </h2>

        <form @submit.prevent="submit" class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
                {{-- Label · Open Sans 14px 600 #0F172A, 6px de margen inferior; asterisco #DC2626 en obligatorios --}}
                <label for="insulin-dose" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Dose') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                {{--
                    IBM Plex Mono y contraste alto (DESIGN.md § Do's #7, y el riesgo propio de esta
                    pantalla): una dosis mal leída es una dosis mal puesta, así que nunca va en gris
                    claro.

                    Numérico, no texto: con un campo de texto se puede teclear tanto `0,5` como
                    `0.5`, y esa ambigüedad de separador decimal en una dosis ya cifrada no se puede
                    corregir después. `step="any"` deja que las flechas incrementen de uno en uno y
                    a la vez acepte decimales —media unidad es una dosis real en pediatría y con
                    `step="1"` el navegador marcaría `0.5` como inválida—; el límite de 2 decimales
                    lo impone `numericValue.js` en el cliente, antes de cifrar, y la dosis viaja al
                    sobre como cadena con punto (ADR 0004).

                    Sin `font-semibold`: de IBM Plex Mono solo se empaqueta el peso 400, así que
                    pedir 600 haría que el navegador sintetizara una falsa negrita y deformara justo
                    los dígitos de la dosis.
                --}}
                {{--
                    El cursor arranca en la dosis: es el dato que se viene a registrar, y unidad,
                    tipo de insulina y fecha ya llegan con un valor puesto. Sin esto hace falta un
                    clic antes de escribir, y en móvil ese clic retrasa la aparición del teclado.

                    Dos atributos porque son dos situaciones distintas: `autofocus` lo aplica el
                    navegador al parsear el documento y solo cubre la carga inicial; al panel se
                    entra casi siempre navegando con `wire:navigate`, que sustituye el cuerpo del
                    documento sin volver a parsearlo y deja `autofocus` sin efecto. `x-init` cubre
                    ese caso, porque Livewire vuelve a inicializar Alpine sobre el HTML nuevo. Un
                    morph de Livewire no reinicializa un elemento que ya existe, así que guardar un
                    registro no vuelve a robar el foco. Mismo patrón que en `glucose.blade.php`.
                --}}
                <input
                    id="insulin-dose"
                    x-ref="dose"
                    type="number"
                    min="0"
                    step="any"
                    inputmode="decimal"
                    {{-- El foco se declara tras el bloque numérico, que los tests leen junto. --}}
                    autofocus
                    x-init="$el.focus()"
                    aria-required="true"
                    placeholder="{{ __('E.g. 6 or 0.5') }}"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body-lg text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div>
                <label for="insulin-unit" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Unit') }}
                </label>
                {{--
                    Único valor posible hoy (UI, código UCUM `[iU]`, ADR 0005): se muestra pero no
                    se deja editar, para que quede visible sin invitar a elegir entre opciones que
                    no existen.

                    Relleno `bg-input-surface-disabled` y borde `border-border`: es exactamente
                    § Inputs · Disabled (#F8FAFC sobre borde #E2E8F0) y su pareja oscura
                    § Components — Dark · Text Input · Disabled (#1B2740 sobre #2A3A55). Antes iba
                    con `bg-background`, que es el fondo de PÁGINA y no el de un campo apagado.

                    La tinta es `text-ink-secondary` y no `text-ink-disabled`: aquí se lee la
                    unidad de una dosis, y Don'ts #10 prohíbe pintar un dato con el gris atenuado
                    por muy apagado que esté el control.
                --}}
                <select
                    id="insulin-unit"
                    disabled
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border bg-input-surface-disabled px-3.5 py-2.5 font-mono text-body text-ink-secondary focus:outline-none"
                >
                    @foreach ($catalog['units'] as $unit)
                        <option value="{{ $unit['code'] }}">{{ $unit['label'] }}</option>
                    @endforeach
                </select>
            </div>

            <div>
                <label for="insulin-type" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Insulin type') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                {{--
                    Sin opción preseleccionada, a diferencia del método de glucemia: confundir
                    rápida con lenta es un error clínico serio, así que el desplegable obliga a
                    elegir en vez de arrancar en el primer caso del catálogo.
                --}}
                <select
                    id="insulin-type"
                    x-ref="insulinType"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    <option value="" selected disabled>{{ __('Select a type') }}</option>
                    @foreach ($catalog['insulinTypes'] as $insulinType)
                        <option value="{{ $insulinType['token'] }}">{{ $insulinType['label'] }}</option>
                    @endforeach
                </select>
            </div>

            <div>
                <label for="insulin-occurred-at" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Date and time') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                {{-- Marca temporal numérica: monoespaciada para que no se lea mal --}}
                <input
                    id="insulin-occurred-at"
                    x-ref="occurredAt"
                    type="datetime-local"
                    step="1"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div>
                <label for="insulin-site" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Injection site') }}
                </label>
                {{--
                    Primera opción vacía y seleccionada de entrada (mismo criterio que el contexto
                    de comida de glucemia, ADR 0006): la zona es opcional y no viene preseleccionada,
                    para que quien no toca el desplegable no guarde una zona como si la hubiera
                    afirmado. `buildInsulinContent` omite la zona de `data` cuando llega vacía.
                --}}
                <select
                    id="insulin-site"
                    x-ref="site"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    <option value="" selected>{{ __('Not specified') }}</option>
                    @foreach ($catalog['injectionSites'] as $site)
                        <option value="{{ $site['token'] }}">{{ $site['label'] }}</option>
                    @endforeach
                </select>
            </div>

            <div class="sm:col-span-2">
                <label for="insulin-product" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Product') }}
                </label>
                {{--
                    Texto libre (ADR 0006): "rápida", "lenta" o "mixta" no es un código de
                    medicamento y el formato de exportación exige uno, así que el nombre comercial
                    es lo único que permite resolverlo después.
                --}}
                <input
                    id="insulin-product"
                    x-ref="product"
                    type="text"
                    placeholder="{{ __('E.g. NovoRapid, Lantus, Humalog Mix 25') }}"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            {{--
                Campos comunes a todo evento (ADR 0006, "Campos que se capturan aunque hoy no se
                usen"): aparato, quién registra y nota libre. Van en un bloque plegable, abierto por
                `open` para que la nota no quede escondida tras dos clics, pero visualmente por
                detrás de la dosis y el tipo, que son lo principal.

                NO hay campo de origen del dato aquí (ver comentario de cabecera): a diferencia de
                `glucose.blade.php`, este bloque no incluye un `<select>` de manual/aparato.
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
                            <label for="insulin-device" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Device') }}
                            </label>
                            <input
                                id="insulin-device"
                                x-ref="device"
                                type="text"
                                placeholder="{{ __('E.g. NovoPen pen, Omnipod pump') }}"
                                class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                            >
                        </div>

                        <div>
                            <label for="insulin-recorded-by" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Recorded by') }}
                            </label>
                            <select
                                id="insulin-recorded-by"
                                x-ref="recordedBy"
                                class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                            >
                                @foreach ($catalog['recordedByRoles'] ?? [] as $recordedByRole)
                                    <option value="{{ $recordedByRole['token'] }}">{{ $recordedByRole['label'] }}</option>
                                @endforeach
                            </select>
                        </div>

                        <div class="sm:col-span-2">
                            <label for="insulin-note" class="mb-1.5 block text-body-sm font-semibold text-ink">
                                {{ __('Note') }}
                            </label>
                            <textarea
                                id="insulin-note"
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
                    deshabilitado. Igual que en glucemia y en las pantallas de acceso.

                    Entre el clic y el repintado del historial hay sellado AEAD e ida y vuelta a
                    Livewire. `loading` deshabilita el botón, marca `aria-busy` y cambia el texto,
                    para que la espera se vea (Do's #3) y no se pulse dos veces: aquí pulsar dos
                    veces guarda dos dosis.
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
                        (ver `savedNotice.js`), porque confirma ESTA operación y no un estado.

                        Nunca repite el valor guardado: no hace falta para confirmar y son datos
                        clínicos, igual que en `profile.blade.php`.

                        `role="status"` (que ya implica `aria-live="polite"`) y no `alert`: es una
                        buena noticia, no interrumpe lo que se esté leyendo. El aviso de error de
                        más abajo sí lleva `alert`, que es lo que corresponde a un fallo.
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
            Error de validación o de cifrado. DESIGN.md § Helper Text pide 13px en rojo con icono
            de aviso delante (Do's #3: nunca solo color). El `<p>` lleva el `x-text`; el icono va
            fuera para que Alpine no lo sobrescriba al escribir el texto.

            Los tres colores salen de los tokens `error-surface` / `error-outline` / `error-ink`,
            que conmutan solos entre § Chips y § Dark Mode · Status Chip, y cuya tinta clara es
            #B91C1C y no el #DC2626 de § Chips porque ese par sobre #FEF2F2 da 4.41:1, por debajo
            del 4.5:1 de Do's #1 (el porqué está en `theme.css`, junto a los tokens).

            `role="alert"` ya implica `aria-live="assertive"`; declarar `polite` encima lo degrada y
            deja el anuncio a merced del lector de pantalla, así que va solo el rol. Mismo relleno y
            mismo tamaño de texto que el aviso de glucemia y los de acceso.
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

        {{--
            Rango de fechas del historial. Va FUERA del `@island`: el island lo vacía el servidor en
            cada petición de Livewire (ver el comentario de la región descifrada), y el control es
            marcado que el servidor sí renderiza y tiene que sobrevivir a la recarga que él mismo
            dispara.
        --}}
        @include('phr.partials.date-range', ['idPrefix' => 'insulin'])

        @island(name: 'insulin-list')
            <div wire:ignore x-ref="list" wire:key="insulin-list-region" class="mt-4"></div>
        @endisland
    </section>

    {{--
        Gráfica de barras de dosis diaria por tipo (ver JSDoc de `groupInsulinByDay` en
        `insulinPage.js`): una dosis no es una magnitud continua como la glucemia, así que aquí no
        cabe una línea que sugiera un valor "entre" dos inyecciones. Se agrupa por día y tipo en vez
        de trazar cada inyección suelta.
    --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Daily dose by type') }}
        </h2>

        {{--
            Región descifrada: `@island` por fuera y `wire:ignore` con `wire:key` estable por
            dentro, las dos capas que pide ADR 0002 § Decision. Las barras salen de las dosis
            descifradas igual que la lista, así que esta región no puede llevar menos protección que
            la de historial: sin el island, la primera petición de Livewire (un `fetchEvents`
            posterior, por ejemplo) puede llevarse por delante el lienzo.

            El contenedor de altura fija envuelve **solo** al `<canvas>`: Chart.js exige que el
            padre del lienzo esté dedicado en exclusiva a la gráfica cuando corre con
            `maintainAspectRatio: false`. El pie va fuera, como hermano de ese contenedor, o
            desbordaría por debajo y podría disparar el bucle de redimensionado del lienzo.

            El `<canvas>` es un objeto gráfico sin texto: lleva `role="img"` con nombre accesible y
            `aria-describedby` al pie, que es donde están en texto los tipos incluidos y la dosis
            acumulada de cada uno (Do's #3: el color no puede ser el único portador de un dato
            clínico). El pie es además el estado vacío de esta tarjeta.
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
            <div wire:ignore wire:key="insulin-chart-region">
                <div class="mt-4 h-80">
                    <canvas
                        x-ref="chart"
                        role="img"
                        aria-label="{{ __('Total daily insulin dose by type') }}"
                        aria-describedby="insulin-chart-caption"
                    ></canvas>
                </div>

                {{-- Caption: Open Sans 12px medium, texto secundario #475569. --}}
                <p
                    id="insulin-chart-caption"
                    x-ref="chartCaption"
                    class="mt-2 text-caption text-ink-secondary"
                ></p>
            </div>
    </section>
</div>
</x-filament-panels::page>
