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

    Los estilos van en línea porque el panel de Filament no carga `resources/css/app.css`: trae su
    propia hoja compilada, y estas tres reglas no justifican un tema propio.
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
    <div style="overflow: hidden; height: 0.375rem; border-radius: 9999px; background-color: rgb(0 0 0 / 0.1);">
        <div
            style="height: 100%; width: 100%; transform-origin: left center; transform: scaleX(0); background-color: currentColor;"
            x-bind:style="progressStyle()"
        ></div>
    </div>

    <p data-phr-progress-stage aria-live="polite" x-text="stage"></p>
</div>
