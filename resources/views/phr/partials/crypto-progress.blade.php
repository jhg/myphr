{{--
    Barra de progreso del estiramiento de clave (Spec 0001 §5, paso 6, y §6.1, paso 5).

    Es obligatoria, no decorativa: Argon2id (t=3, m=64 MiB, p=4) corre de forma síncrona en el hilo
    principal y deja la pestaña bloqueada varios segundos. Sin nada en pantalla, la persona pulsa el
    botón otra vez, y en la pantalla de establecimiento de contraseña ese segundo intento se come el
    enlace de registro, que es de un solo uso.

    El movimiento va en `transform: scaleX(...)`, no en `width`: solo `transform` y `opacity` se
    animan en el compositor. Animar el ancho exigiría el hilo principal, que es exactamente el que
    está ocupado derivando, y la barra se quedaría congelada justo durante la espera que tiene que
    cubrir. El componente lanza la transición y espera un repintado **antes** de llamar al WebAssembly.

    Los colores salen de los tokens de MediCare+ (DESIGN.md § Colors): pista en Tertiary #90E0EF
    —«highlights, progress bars»— y relleno en Primary #0077B6. Las utilidades vienen del tema del
    panel (`resources/css/filament/phr/theme.css`, que declara `resources/views/phr/**` como
    `@source`); el panel no carga `resources/css/app.css`, así que ahí no hay nada que añadir.

    Pista y relleno van en tokens de papel (`bg-progress-track` y `bg-accent`), no en
    `bg-primary-300` / `bg-primary-600`: la rampa `primary` no se reasigna en `:root.dark`, así que
    la barra se quedaba con el azul claro y el azul medio del tema claro sobre el fondo oscuro.

    La pista NO es `bg-tertiary`. Subir los dos extremos un escalón, como haría § Dark Mode ·
    Derivation Rule 2 con Tertiary y Primary, conserva cada tono y destruye el par: #C2F0F7 contra
    #48CAE4 es 1.58:1 y la barra se queda invisible justo durante los segundos que existe para
    cubrir. `--color-progress-track` fija la pareja en los dos modos —#90E0EF/#0077B6 (3.27:1) en
    claro y #2A3A55/#48CAE4 (5.96:1) en oscuro—; el razonamiento y las ratios están junto al token
    en `theme.css`.

    El color, la altura y el origen de la transformación son ya utilidades (`bg-accent`,
    `h-full`, `origin-left`). En el atributo `style` queda una sola declaración, el `scaleX(0)`
    inicial, porque `progressStyle()` fusiona su objeto con ese atributo y la barra necesita un
    punto de partida antes de que Alpine evalúe nada.
--}}
<div
    data-phr-progress
    x-show="busy"
    x-cloak
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    x-bind:aria-valuenow="Math.round(progress * 100)"
    x-bind:aria-valuetext="stage"
>
    <div class="h-2 overflow-hidden rounded-full bg-progress-track">
        <div
            class="h-full w-full origin-left bg-accent"
            style="transform: scaleX(0);"
            x-bind:style="progressStyle()"
        ></div>
    </div>

    {{-- Caption: Open Sans 12px medium, tracking 0.01em, texto secundario #475569. --}}
    <p data-phr-progress-stage aria-live="polite" x-text="stage" class="mt-2 text-caption text-ink-secondary"></p>
</div>
