{{--
    Control de rango de fechas del historial, común a las cuatro pantallas de eventos (glucemia,
    tensión, insulina y comidas). Se incluye dentro de la tarjeta de historial de cada una:

        @include('phr.partials.date-range', ['idPrefix' => 'glucose'])

    `$idPrefix` solo sirve para que los `id`/`for` sean únicos: las cuatro pantallas comparten
    estructura y dos `id` iguales en la misma página romperían la asociación de las etiquetas.

    **El rango sí lo puede aplicar el servidor** (ADR 0006): `occurred_at` es una de las tres
    columnas en claro y ya se usa para ordenar y paginar, así que acotarla no revela nada nuevo. El
    tipo de evento, que va cifrado, se sigue descartando en el navegador.

    **El rango NO viaja en la URL**, ni por `#[Url]` ni de ninguna otra forma (Spec 0001 §9, ADR
    0002): ver el porqué en el JSDoc de `resources/js/health/dateRange.js`. Vive solo en memoria de
    Alpine y sube como argumento de `fetchEvents`.

    Los tres campos van con `x-model` y no con `x-ref`: son estado de interfaz del cliente —no dato
    clínico— y tienen que ser reactivos para que las dos fechas a medida aparezcan solo con el atajo
    correspondiente. `x-model` es de Alpine y no sube nada al servidor; el prohibido por el ADR 0002
    es `wire:model`.

    Los `<option>` los pinta el servidor, como los del formulario de arriba y por el mismo motivo:
    este bloque no está dentro de un `wire:ignore`, así que el morph del DOM restaura el HTML tal
    como lo emitió el servidor y borraría cualquier opción escrita por JavaScript (ADR 0002).

    Estilo: los mismos tokens y las mismas medidas que el formulario de registro (DESIGN.md
    § Forms): etiqueta de 14px semibold, campo de 44px de alto (Do's #2), borde `border-strong`,
    anillo azul al foco. Las fechas van en monoespaciada porque son valores numéricos (Do's #7).
--}}
<div class="mt-4 flex flex-wrap items-end gap-4">
    <div class="min-w-52">
        <label for="{{ $idPrefix }}-range-preset" class="mb-1.5 block text-body-sm font-semibold text-ink">
            {{ __('Period') }}
        </label>
        <select
            id="{{ $idPrefix }}-range-preset"
            x-model="rangePreset"
            @change="applyRange()"
            class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
        >
            {{--
                Mismo vocabulario que el panel de inicio: allí los periodos se llaman igual, y es el
                mismo control.

                «Último día» son las últimas 24 horas, igual que los otros dos atajos cuentan hacia
                atrás desde ahora (`WINDOW_DAYS` de `statistics.js`), y es el periodo con el que
                arrancan tanto el panel de inicio como el historial: descifrar años de eventos de
                oficio se paga en el navegador de quien mira (ver `DEFAULT_RANGE_PRESET` en
                `resources/js/health/dateRange.js`).

                «Todos los registros» sigue existiendo aquí, pero no es la única puerta: el aviso de
                periodo de abajo la duplica como botón, porque un recorte puesto de oficio no puede
                depender de que alguien abra este desplegable.
            --}}
            <option value="all">{{ __('All records') }}</option>
            <option value="day">{{ __('Last day') }}</option>
            <option value="week">{{ __('Last week') }}</option>
            <option value="month">{{ __('Last month') }}</option>
            <option value="custom">{{ __('Custom range') }}</option>
        </select>
    </div>

    {{--
        `x-cloak` además de `x-show`: sin él, los dos campos parpadean visibles en cada carga hasta
        que Alpine arranca, y en una pantalla de historial ese parpadeo se lee como un filtro activo
        que no lo está.
    --}}
    <div x-show="rangePreset === 'custom'" x-cloak class="min-w-40">
        <label for="{{ $idPrefix }}-range-from" class="mb-1.5 block text-body-sm font-semibold text-ink">
            {{ __('Start date') }}
        </label>
        <input
            id="{{ $idPrefix }}-range-from"
            x-model="rangeFromDay"
            type="date"
            class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
        >
    </div>

    <div x-show="rangePreset === 'custom'" x-cloak class="min-w-40">
        <label for="{{ $idPrefix }}-range-to" class="mb-1.5 block text-body-sm font-semibold text-ink">
            {{ __('End date') }}
        </label>
        <input
            id="{{ $idPrefix }}-range-to"
            x-model="rangeToDay"
            type="date"
            class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
        >
    </div>

    {{--
        El botón solo aparece con el rango a medida: los atajos se aplican al elegirlos, pero dos
        fechas se teclean de una en una y recargar el historial a media escritura mostraría el
        tramo equivocado.

        Botón secundario · § Buttons · Secondary, con los mismos tokens y el mismo par de hover que
        el «Añadir alimento» de `meals.blade.php` (ver allí el razonamiento de contraste):
        `border-accent` + `text-accent`, y al pasar por encima `bg-surface-hover` con la tinta
        subida a `accent-tinted` para no quedarse en el 4.51:1 que § Chips descarta.
    --}}
    <button
        x-show="rangePreset === 'custom'"
        x-cloak
        type="button"
        @click="applyRange()"
        class="inline-flex min-h-11 items-center justify-center rounded-control border-[1.5px] border-accent px-6 py-2.5 text-button text-accent hover:bg-surface-hover hover:text-accent-tinted focus-visible:shadow-focus-blue focus-visible:outline-none"
    >
        {{ __('Apply') }}
    </button>
</div>

{{--
    Rango mal formado (una fecha suelta, o el inicio después del fin). Mismo patrón que el aviso de
    error del formulario: `role="alert"`, icono además del color (Do's #3) y los tokens `error-*`,
    que conmutan solos con el tema.
--}}
<div
    x-show="rangeError"
    x-cloak
    role="alert"
    class="mt-3 flex items-start gap-2 rounded-control border border-error-outline bg-error-surface px-3.5 py-2.5"
>
    <svg class="mt-px size-5 shrink-0 text-error-ink" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clip-rule="evenodd" />
    </svg>
    <p x-text="rangeError" class="text-helper text-error-ink"></p>
</div>

{{--
    Aviso de periodo en vigor, y salida a todo el historial.

    Existe porque el historial arranca acotado a las últimas 24 horas (`DEFAULT_RANGE_PRESET` en
    `resources/js/health/dateRange.js`), y un recorte que nadie ha pedido es exactamente el que se
    confunde con una pérdida de datos: en un historial clínico «no aparece» se lee como «se ha
    perdido». La objeción no se descarta, se paga con esto, que es lo que la vuelve aceptable:

    - El periodo se dice **en palabras y junto al historial**, no solo como opción seleccionada
      dentro del desplegable de arriba, que es justo lo que no se mira. Va **debajo** del control y
      pegado a la lista, en el camino visual de quien baja a leerla.
    - La frase nombra el porqué: los registros más antiguos están *ocultos por el periodo*, no
      perdidos.
    - «Ver todos los registros» es un **botón a la vista**, no la primera opción de un desplegable
      cerrado: quitar el recorte cuesta un clic, sin abrir nada ni saber cómo se llama la opción.

    Con `all` el aviso no desaparece, cambia de frase: si se esfumara, un historial corto (poco
    registrado, no recortado) volvería a ser ambiguo. Que el aviso esté siempre significa que el
    periodo es siempre legible.

    No se muestra mientras hay error de rango: ahí lo aplicado es el rango abierto y no lo que dice
    el desplegable, y anunciar el periodo equivocado sería peor que callar. El bloque de error de
    arriba ya lo explica.

    Estilo § Chips · Status Chip (info) llevado a aviso, como el `role="note"` de `profile.blade.php`:
    tokens `info-*`, icono además del color (Do's #3) y el mismo `rounded-control`. El botón es
    § Buttons · Ghost, sin relleno ni borde para no competir con el «Aplicar» del rango a medida,
    pero con los 44px de altura mínima de Do's #2.

    `role="status"`: cambiar de periodo cambia este texto, y un lector de pantalla tiene que
    enterarse del recorte sin que le roben el foco.

    `x-cloak` en las etiquetas: sin él se ven las cinco a la vez hasta que Alpine arranca.
--}}
<div
    x-show="! rangeError"
    role="status"
    class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-info-outline bg-info-surface px-3.5 py-2.5"
>
    <svg class="size-5 shrink-0 text-info-ink" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M12 2.25a9.75 9.75 0 1 0 0 19.5 9.75 9.75 0 0 0 0-19.5Zm.75 4.5a.75.75 0 0 0-1.5 0V12c0 .284.16.544.415.67l3.5 1.75a.75.75 0 0 0 .67-1.34l-3.085-1.543V6.75Z" clip-rule="evenodd" />
    </svg>

    <p class="min-w-0 flex-1 text-body-sm text-info-ink">
        {{ __('Showing:') }}
        <span x-show="rangePreset === 'all'" x-cloak class="font-semibold">{{ __('All records') }}</span>
        <span x-show="rangePreset === 'day'" x-cloak class="font-semibold">{{ __('Last day') }}</span>
        <span x-show="rangePreset === 'week'" x-cloak class="font-semibold">{{ __('Last week') }}</span>
        <span x-show="rangePreset === 'month'" x-cloak class="font-semibold">{{ __('Last month') }}</span>
        {{-- Las dos fechas en monoespaciada, como los campos de los que salen (Do's #7). --}}
        <span
            x-show="rangePreset === 'custom'"
            x-cloak
            x-text="rangeFromDay + ' – ' + rangeToDay"
            class="font-mono font-semibold"
        ></span>
        <span x-show="rangePreset !== 'all'" x-cloak>
            {{ __('Older records are hidden by this period, not deleted.') }}
        </span>
    </p>

    <button
        x-show="rangePreset !== 'all'"
        x-cloak
        type="button"
        @click="showAllRecords()"
        class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-control px-4 py-2.5 text-button text-info-ink underline underline-offset-4 hover:bg-surface-hover focus-visible:shadow-focus-blue focus-visible:outline-none"
    >
        {{ __('Show all records') }}
    </button>
</div>
