{{--
    Pantalla de comidas (ADR 0002, ADR 0004, ADR 0005, ADR 0006).

    Estructura calcada de `glucose.blade.php`: `phrMealsPage` en Alpine contra este contrato, así
    que los `x-ref`, el nombre del componente y `data-phr-meals-catalog` no se tocan a la ligera.
    Cada `x-ref` de aquí lo lee `resources/js/health/mealsPage.js`, y cada `this.$refs.X` de ese
    módulo está declarado aquí: `tests/Feature/MealsPageTest.php` compara las dos listas y falla si
    divergen, que es la clase de error que no avisa hasta que alguien pulsa el botón.

    El formulario no lleva `wire:model`: Alpine lee los campos del DOM, cifra en el navegador y
    llama a `storeEvent` (heredado de `HealthEventPage`) como acción de método, fuera de cualquier
    island. La región descifrada (el historial) vive dentro del `@island` con `wire:ignore`
    **dentro** y `wire:key` estable, para que un re-render de Livewire no la borre (ADR 0002).

    Los `<option>` de `mealType`, `recordedBy` y la unidad de cada alimento los renderiza el
    servidor en Blade, nunca Alpine (ADR 0002: "el morph de Livewire los borraría"). La lista de
    alimentos es un caso particular: sus filas se crean y destruyen en el navegador según el usuario
    añade o quita alimentos, así que no pueden salir de un `<select>` estático. La solución es un
    `<template>` — HTML real que emite Blade, con sus `<option>` ya escritos por el servidor — que
    Alpine clona por cada fila nueva. El contenido de cada fila sigue siendo Blade, solo que se
    inserta en el DOM más de una vez; y todo el contenedor de filas va dentro de `wire:ignore`, así
    que ningún morph de Livewire llega a tocarlo, se haya clonado una fila o cien.

    No hay selector de "origen del dato": hoy toda comida se teclea a mano, no existe ninguna
    integración con un aparato que registre comidas, así que preguntar "¿manual o aparato?" no tiene
    una segunda respuesta real. El cliente fija `origin` a `manual` sin preguntarlo (ver JSDoc de
    `buildMealContent` en `mealsPage.js`); el día que exista una importación automática será ella
    quien escriba `device`.

    Estilo: MediCare+ (DESIGN.md), mismos tokens que `glucose.blade.php`. Superficies y bordes van
    por su papel (`bg-surface`, `bg-background`, `border-border`) y no por la rampa ni por
    `bg-white`: la rampa se reasigna en `:root.dark` y `bg-white` no conmuta de ninguna manera, así
    que una tarjeta escrita con `bg-white` sale blanca sobre el tema oscuro. Igual con los radios
    (`rounded-card` / `rounded-control`, nunca `rounded-lg`) y los tamaños de texto
    (`text-button`, `text-helper`), para no tener dos vocabularios para el mismo píxel.
    Etiquetas siempre visibles, 44px de alto mínimo, cantidades en monoespaciada.
--}}
{{--
    El contenido va envuelto en `<x-filament-panels::page>` porque esta página define su propia
    `$view` y, sin ese componente, se salta el contenedor `fi-page-header-main-ctn` de Filament, que
    es el que aporta el `py-8` y la cabecera. Sin él, la primera tarjeta queda pegada a la barra
    superior. La clase `fi-page` la pone ya ese componente, así que aquí no se repite.
--}}
<x-filament-panels::page>
<div
    x-data="phrMealsPage"
    wire:key="meals-page"
    class="space-y-6"
>
    @php($catalog = $this->catalog())

    {{-- Catálogo público, dato de referencia en claro (ADR 0005) --}}
    <script type="application/json" data-phr-meals-catalog>@json($catalog)</script>

    {{--
        Plantilla de una fila de alimento. No se renderiza como tal (un <template> nunca aparece en
        el DOM visible): es la fuente que Alpine clona en `x-ref="foods"` por cada alimento, para
        que el <select> de unidad de cada fila nueva siga siendo HTML escrito por Blade (ver
        comentario de cabecera).
    --}}
    <template x-ref="foodRowTemplate">
        <div data-food-row class="grid grid-cols-1 gap-3 border-b border-border py-4 last:border-b-0 sm:grid-cols-[1fr_140px_160px_auto] sm:items-end">
            <div>
                <label class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Food') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <input
                    type="text"
                    data-food-name
                    aria-label="{{ __('Food') }}"
                    placeholder="{{ __('E.g. grilled chicken breast') }}"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div>
                <label class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Quantity') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                {{--
                    IBM Plex Mono: es un valor de medida (DESIGN.md § Do's #7).

                    Numérico, no texto: con un campo de texto se puede teclear tanto `250,5` como
                    `250.5`, y esa ambigüedad de separador decimal es un error de lectura/parseo que
                    en un dato clínico cifrado no se puede corregir después. `step="any"` deja que
                    el navegador incremente de uno en uno con las flechas y a la vez acepte
                    decimales (con `step="1"` marcaría `0.5` como inválido); el límite de 2
                    decimales lo impone `numericValue.js` en el cliente, antes de cifrar, y el valor
                    se guarda como cadena (ADR 0004).
                --}}
                <input
                    type="number"
                    min="0"
                    step="any"
                    inputmode="decimal"
                    data-food-quantity
                    aria-label="{{ __('Quantity') }}"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div>
                <label class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Unit') }}
                </label>
                {{-- Los códigos UCUM (g, mL, [oz_av]…) van en monoespaciada --}}
                <select
                    data-food-unit
                    aria-label="{{ __('Unit') }}"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    @foreach ($catalog['units'] as $unit)
                        <option value="{{ $unit['code'] }}">{{ $unit['label'] }}</option>
                    @endforeach
                </select>
            </div>

            <div>
                {{--
                    En reposo es un botón neutro (borde interactivo + tinta secundaria) y solo al
                    pasar por encima se tiñe de rojo, que es el único papel que Don'ts #4 permite
                    al rojo: una acción destructiva. El borde toma `border-destructive` (#DC2626 /
                    #F87171), que § Colors — Dark reserva a «fills, borders, halos and icons» con
                    umbral 3:1, y la tinta toma `text-destructive-text` (#DC2626 / #FCA5A5),
                    porque el texto rojo nunca puede ser #F87171: cae a 4.36:1 sobre Surface
                    Overlay. Antes iban en `border-danger-300` / `text-danger-600`, tonos de una
                    rampa que no se reasigna en oscuro.
                --}}
                <button
                    type="button"
                    data-food-remove
                    aria-label="{{ __('Remove this food') }}"
                    class="inline-flex min-h-11 w-full items-center justify-center rounded-control border-[1.5px] border-border-strong bg-surface px-4 py-2.5 text-body-sm font-semibold text-ink-secondary hover:border-destructive hover:text-destructive-text focus-visible:shadow-focus-blue focus-visible:outline-none sm:w-11"
                >
                    <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                    <span class="sr-only">{{ __('Remove') }}</span>
                </button>
            </div>
        </div>
    </template>

    {{-- Card · DESIGN.md § Cards: relleno blanco, borde 1px #E2E8F0, radio 8px, sombra Subtle, 24px --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Record a meal') }}
        </h2>

        <form @submit.prevent="submit" class="mt-4 space-y-6">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                    <label for="meal-type" class="mb-1.5 block text-body-sm font-semibold text-ink">
                        {{ __('Meal type') }}
                        <span class="text-destructive-text" aria-hidden="true">*</span>
                    </label>
                    <select
                        id="meal-type"
                        x-ref="mealType"
                        aria-required="true"
                        class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                    >
                        @foreach ($catalog['mealTypes'] as $mealType)
                            <option value="{{ $mealType['token'] }}">{{ $mealType['label'] }}</option>
                        @endforeach
                    </select>
                </div>

                <div>
                    <label for="meal-occurred-at" class="mb-1.5 block text-body-sm font-semibold text-ink">
                        {{ __('Date and time') }}
                        <span class="text-destructive-text" aria-hidden="true">*</span>
                    </label>
                    {{-- Marca temporal numérica: monoespaciada para que no se lea mal --}}
                    <input
                        id="meal-occurred-at"
                        x-ref="occurredAt"
                        type="datetime-local"
                        step="1"
                        aria-required="true"
                        class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                    >
                </div>
            </div>

            {{--
                Lista ordenada de alimentos (ADR 0006: el orden es parte del dato). Todo el
                contenedor va dentro de `wire:ignore`: las filas las crea y destruye Alpine en el
                navegador, sin pasar nunca por Livewire, así que un morph no debe llegar a tocarlas
                (ver comentario de cabecera sobre el `<template>`).
            --}}
            <div>
                <div class="mb-2 flex items-center justify-between">
                    <span class="text-body-sm font-semibold text-ink">{{ __('Foods') }}</span>
                    {{--
                        Botón secundario · § Buttons · Secondary: borde y tinta en el azul de
                        acción, relleno de la superficie. En tokens (`border-accent`,
                        `text-accent`) y no en `border-primary-600` / `text-primary-600`: la rampa
                        `primary` no se reasigna en oscuro, así que ese azul se quedaba en #0077B6
                        —4.87:1 sobre una tarjeta blanca, pero solo 1.87:1 sobre la superficie
                        oscura #152238—. Con el token pasa a #48CAE4 en oscuro (8.23:1).

                        El relleno del hover es `bg-surface-hover`: #F0F7FF en claro, que es
                        exactamente el «Hover: Background #F0F7FF» de § Buttons · Secondary. En
                        oscuro vale #1A2A42 (§ Dark Mode · Default List Item · hover) y no el
                        #16304A que § Dark Mode · Button Secondary pide, porque ese segundo tono
                        solo existe hoy como `--color-chip-surface` y usar el token del chip para
                        un botón sería nombrar mal el papel. Ambos son el mismo peldaño de tinte
                        azul sobre Surface y el azul de acción los supera de sobra.

                        Con ese relleno debajo, la tinta sube a `hover:text-accent-tinted`: #0077B6
                        sobre #F0F7FF es 4.51:1, el par que § Chips descarta por escrito («neither
                        clears Do's #1 with any margin»), y #006399 lo lleva a 6.00:1. El token ya
                        existe —es el mismo que usa el ítem de navegación activo—, así que no hace
                        falta ningún `--color-accent-surface`. En oscuro vale lo mismo que
                        `--color-accent`, así que allí no cambia nada.
                    --}}
                    <button
                        type="button"
                        @click="addFoodRow()"
                        class="inline-flex min-h-11 items-center justify-center rounded-control border-[1.5px] border-accent px-4 py-2 text-body-sm font-semibold text-accent hover:bg-surface-hover hover:text-accent-tinted focus-visible:shadow-focus-blue focus-visible:outline-none"
                    >
                        {{ __('Add food') }}
                    </button>
                </div>

                <div wire:ignore x-ref="foods" wire:key="meals-foods-region" class="rounded-card border border-border bg-surface px-4"></div>
            </div>

            {{--
                Campos comunes a todo evento (ADR 0006): aparato, quién registra y nota libre. No
                incluye el origen del dato: hoy toda comida se teclea a mano, así que preguntarlo no
                tiene una segunda respuesta real (ver comentario de cabecera). El bloque va abierto
                por `open` para que la nota no quede escondida tras dos clics.

                `bg-background` y `border-border` (y no `bg-gray-50` / `border-gray-200`): son los
                papeles de § Colors, no tonos de la rampa, y por eso conmutan solos con el tema.
            --}}
            <details open class="rounded-card border border-border bg-background p-pad-md">
                {{-- Interactivo: 44px de objetivo táctil (Do's #2) y anillo azul al foco
                     (§ Elevation, Do's #9); el selector de `controls.css` solo cubre `fi-*`. --}}
                <summary class="min-h-11 cursor-pointer rounded-control py-3 text-body-sm font-semibold text-ink focus-visible:shadow-focus-blue focus-visible:outline-none">
                    {{ __('Record details (optional)') }}
                </summary>

                <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label for="meal-device" class="mb-1.5 block text-body-sm font-semibold text-ink">
                            {{ __('Device') }}
                        </label>
                        <input
                            id="meal-device"
                            x-ref="device"
                            type="text"
                            placeholder="{{ __('E.g. connected kitchen scale') }}"
                            class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                        >
                    </div>

                    <div>
                        <label for="meal-recorded-by" class="mb-1.5 block text-body-sm font-semibold text-ink">
                            {{ __('Recorded by') }}
                        </label>
                        <select
                            id="meal-recorded-by"
                            x-ref="recordedBy"
                            class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                        >
                            @foreach ($catalog['recordedByRoles'] ?? [] as $recordedByRole)
                                <option value="{{ $recordedByRole['token'] }}">{{ $recordedByRole['label'] }}</option>
                            @endforeach
                        </select>
                    </div>

                    <div class="sm:col-span-2">
                        <label for="meal-note" class="mb-1.5 block text-body-sm font-semibold text-ink">
                            {{ __('Note') }}
                        </label>
                        <textarea
                            id="meal-note"
                            x-ref="note"
                            rows="3"
                            placeholder="{{ __('Anything that does not fit in the fields above') }}"
                            class="block w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted focus:border-accent focus:shadow-focus-blue focus:outline-none"
                        ></textarea>
                    </div>
                </div>
            </details>

            <div>
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
                    deshabilitado. Los botones de glucemia y de acceso tampoco la llevan.

                    Entre el clic y el repintado del historial hay sellado AEAD e ida y vuelta a
                    Livewire. `loading` deshabilita el botón, marca `aria-busy` y cambia el texto,
                    para que la espera se vea (Do's #3) y no se guarde la misma comida dos veces.
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
            de aviso delante (Do's #3: nunca solo color). Los tres colores salen de los tokens
            `error-surface` / `error-outline` / `error-ink`, que conmutan solos entre § Chips y
            § Dark Mode · Status Chip y ya traen la tinta corregida a AA (#B91C1C, no #DC2626).

            `role="alert"` ya implica `aria-live="assertive"`; declarar `polite` encima lo degrada y
            deja el anuncio a merced del lector de pantalla, así que va solo el rol, como en
            glucemia y en las pantallas de acceso.
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

        @island(name: 'meals-list')
            <div wire:ignore x-ref="list" wire:key="meals-list-region" class="mt-4"></div>
        @endisland
    </section>
</div>
</x-filament-panels::page>
