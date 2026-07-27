{{--
    Pantalla de compartición (ADR 0011): elegir rango y tipos, generar el recorte, y ver lo que
    sigue vivo.

    El componente Alpine es `phrSharePage` (`resources/js/health/sharePage.js`), registrado en
    `resources/js/app.js`. Si faltara ahí, esta pantalla se pintaría entera y ningún botón
    respondería, sin error visible en ninguna parte.

    Nada de `wire:model` (ADR 0002). Lo que sube al servidor es el paquete ya cifrado, y sube por
    `POST /phr/shares` —un endpoint HTTP propio— y no por Livewire: lleva prefijo `s1.` y los dos
    guardarraíles del ADR 0002 abortan cualquier cadena larga que no empiece por `v1.`. Lo único que
    va por Livewire es `fetchEvents`, que baja sobres `v1.` como en las seis pantallas de historial.

    **Los avisos de esta pantalla no son letra pequeña y no se pliegan.** Quien tenga el enlace y el
    PIN entra; revocar no recupera lo ya descargado; y el servidor sabe cuándo y cuántas veces se
    comparte aunque no sepa qué. Son las tres cosas que el ADR 0011 pone por escrito en su apartado
    de consecuencias, y esconderlas detrás de un «más información» sería contarlas para poder decir
    que se contaron.

    Estilo: MediCare+ (DESIGN.md), siempre por el PAPEL del token y nunca por un tono de la rampa
    (`text-ink`, `bg-surface`, `border-border-strong`, `bg-accent` + `text-accent-ink`,
    `bg-warning-surface` + `text-warning-ink`). Aquí no se inventa ningún color. La única medida
    escrita a mano es el lado del QR, y no es una decisión de diseño sino física: por debajo de
    400 px no se lee desde el otro lado de una mesa (ADR 0011).
--}}
<x-filament-panels::page>
<div
    x-data="phrSharePage"
    wire:key="sharing-page"
    class="space-y-6"
>
    {{-- Catálogo público en claro: tipos, caducidades, endpoints y topes. Nada de esto es dato clínico. --}}
    <script type="application/json" data-phr-share-catalog>@json($this->catalog())</script>

    {{--
        Aviso permanente, arriba y antes del formulario, no al final: quien va a compartir tiene que
        leer esto ANTES de pulsar, no después de tener el enlace en la mano.

        Va en los tokens de aviso (`warning-*`), con icono además del color (Do's #3), y no se puede
        cerrar (Don'ts #6: la información médica importante no se auto-descarta).
    --}}
    <section
        class="rounded-card border border-warning-outline bg-warning-surface p-card"
        role="note"
        aria-labelledby="sharing-warning-title"
    >
        <div class="flex items-start gap-3">
            <svg class="mt-0.5 size-5 shrink-0 text-warning-ink" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clip-rule="evenodd" />
            </svg>

            <div>
                <h2 id="sharing-warning-title" class="font-display text-subhead text-warning-ink">
                    {{ __('Before you share') }}
                </h2>

                <ul class="mt-2 list-disc space-y-1 pl-5 text-body-sm text-warning-ink">
                    <li>{{ __('Anyone holding both the link and the PIN can read the clipping. There is no other check: no account, no identity, no list of who may open it.') }}</li>
                    <li>{{ __('Send the PIN through a different channel from the link. Both together in the same message make the PIN pointless.') }}</li>
                    <li>{{ __('Revoking blocks future readings only. It cannot take back what the other person already downloaded: a snapshot handed over is theirs for good.') }}</li>
                    <li>{{ __('The server never learns what you share, but it does learn that you shared, when, and how often. That pattern says something on its own.') }}</li>
                    <li>{{ __('The clipping is a snapshot, not a live view: records you add later will not appear in it.') }}</li>
                </ul>
            </div>
        </div>
    </section>

    {{-- Card · DESIGN.md § Cards: relleno blanco, borde 1px, radio 8px, sombra Subtle, 24px --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Build a clipping') }}
        </h2>

        {{--
            Rango de fechas: el MISMO control de las pantallas de historial
            (`phr.partials.date-range` + `dateRangeControl()`), no otro parecido. Dos controles de
            rango con criterios distintos acabarían discrepando en el borde del día, y el borde del
            día es justo donde un registro entra o se queda fuera de lo que ve el médico.

            Aquí arranca en «último mes», pedido explícitamente y no heredado del defecto común:
            ver el porqué en `sharePage.js`, junto al `dateRangeControl({ preset: 'month' })`.
        --}}
        @include('phr.partials.date-range', ['idPrefix' => 'sharing'])

        <fieldset class="mt-6">
            <legend class="text-body-sm font-semibold text-ink">
                {{ __('Record types to include') }}
            </legend>

            {{--
                Los tipos excluidos viajan escritos dentro del paquete, así que el profesional ve
                qué se dejó fuera. Se dice aquí para que no sea una sorpresa: no es lo mismo «no
                tiene comidas apuntadas» que «no me las enseñó».
            --}}
            <p class="mt-1 text-helper text-ink-secondary">
                {{ __('Whoever opens the clipping will also see which types you left out, so an absence is never read as a zero.') }}
            </p>

            {{--
                Casillas de DESIGN.md § Checkboxes: 20px, borde 1.5px, radio 4px, objetivo táctil de
                44px en la fila entera (Do's #2), etiqueta a 10px.

                Van con `x-model` sobre `types`: es estado de interfaz del cliente, no dato clínico,
                y tiene que ser reactivo. `x-model` es de Alpine y no sube nada al servidor; el que
                el ADR 0002 prohíbe es `wire:model`.
            --}}
            <div class="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
                @foreach ($this->catalog()['types'] as $type)
                    <label
                        for="sharing-type-{{ $type['token'] }}"
                        class="flex min-h-11 items-center rounded-control px-1 text-body text-ink hover:bg-surface-hover"
                    >
                        <input
                            id="sharing-type-{{ $type['token'] }}"
                            type="checkbox"
                            value="{{ $type['token'] }}"
                            x-model="types['{{ $type['token'] }}']"
                            class="size-5 rounded-chip border-[1.5px] border-border-strong bg-surface text-accent focus:shadow-focus-blue focus:outline-none"
                        >
                        <span class="ml-2.5">{{ $type['label'] }}</span>
                    </label>
                @endforeach
            </div>
        </fieldset>

        <div class="mt-6 max-w-md">
            <label for="sharing-ttl" class="mb-1.5 block text-body-sm font-semibold text-ink">
                {{ __('The link expires in') }}
            </label>
            {{--
                Lista cerrada (`App\Sharing\ShareTtl`), pintada por el servidor: el cliente calcula
                el instante exacto, pero el servidor comprueba que corresponde a una de estas tres
                opciones. Los `<option>` los emite Blade y no JavaScript porque este bloque no está
                dentro de un `wire:ignore` y el morph de Livewire restauraría el HTML del servidor,
                borrando cualquier opción escrita por Alpine (ADR 0002).
            --}}
            <select
                id="sharing-ttl"
                x-model="ttl"
                class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
            >
                @foreach ($this->catalog()['ttls'] as $ttl)
                    <option value="{{ $ttl['token'] }}">{{ $ttl['label'] }}</option>
                @endforeach
            </select>

            <p class="mt-1.5 text-helper text-ink-secondary">
                {{ __('When it expires, the clipping is deleted from the server. Choose the shortest window that fits the appointment.') }}
            </p>
        </div>

        <div class="mt-6 flex flex-wrap items-center gap-4">
            {{-- Botón primario · § Buttons · Primary, 44px de alto (Do's #2). --}}
            <button
                type="button"
                @click="generate()"
                x-bind:disabled="busy"
                x-bind:aria-busy="busy ? 'true' : 'false'"
                class="inline-flex min-h-11 items-center justify-center rounded-control bg-accent px-6 py-2.5 text-button text-accent-ink hover:bg-accent-hover focus-visible:shadow-focus-blue focus-visible:outline-none active:bg-accent-active disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-ink-disabled disabled:hover:bg-surface-disabled"
            >
                <span x-show="! busy">{{ __('Generate link and PIN') }}</span>
                <span x-show="busy" x-cloak>{{ __('Preparing…') }}</span>
            </button>

            {{--
                Vista previa · Botón secundario · § Buttons: sin relleno, borde de 1.5px.

                Va **antes** de generar, no después, y por eso es un botón aparte: lo que sale de
                aquí no se puede deshacer —revocar un enlace no borra lo que la otra persona ya
                descargó—, así que ver antes de enviar es la única comprobación que sirve. No sube
                nada, no crea ningún enlace y no consume ninguno de los del tope: son eventos que ya
                están descifrados en este navegador, pintados con la misma pantalla del profesional.
            --}}
            <button
                type="button"
                @click="togglePreview()"
                x-bind:disabled="previewBusy"
                x-bind:aria-expanded="previewVisible ? 'true' : 'false'"
                aria-controls="sharing-preview"
                class="inline-flex min-h-11 items-center justify-center rounded-control border-[1.5px] border-accent px-6 py-2.5 text-button text-accent hover:bg-surface-hover focus-visible:shadow-focus-blue focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
                <span x-show="previewBusy" x-cloak>{{ __('Preparing…') }}</span>
                <span x-show="! previewBusy && ! previewVisible">{{ __('Preview what the professional will see') }}</span>
                <span x-show="! previewBusy && previewVisible" x-cloak>{{ __('Hide the preview') }}</span>
            </button>
        </div>

        {{-- Error de la vista previa, aparte del de generación: son dos acciones distintas. --}}
        <div
            x-show="previewError"
            x-cloak
            role="alert"
            class="mt-4 flex items-start gap-2 rounded-control border border-error-outline bg-error-surface px-3.5 py-2.5"
        >
            <svg class="mt-px size-5 shrink-0 text-error-ink" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clip-rule="evenodd" />
            </svg>
            <p x-text="previewError" class="text-helper text-error-ink"></p>
        </div>

        {{--
            Barra de progreso, la misma de las pantallas de acceso y por el mismo motivo: cifrar
            cientos de eventos y estirar el PIN con Argon2id son varios segundos con alguien
            esperando. Sin nada en pantalla, la reacción natural es volver a pulsar, y aquí ese
            segundo intento crea un segundo recorte y consume uno de los enlaces del tope.
        --}}
        <div class="mt-4">
            @include('phr.partials.crypto-progress')
        </div>

        {{-- Error de generación: mismo patrón que el resto del panel, con icono además del color. --}}
        <div
            x-show="error"
            x-cloak
            role="alert"
            class="mt-4 flex items-start gap-2 rounded-control border border-error-outline bg-error-surface px-3.5 py-2.5"
        >
            <svg class="mt-px size-5 shrink-0 text-error-ink" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clip-rule="evenodd" />
            </svg>
            <p x-text="error" class="text-helper text-error-ink"></p>
        </div>
    </section>

    {{--
        Vista previa del recorte: exactamente la pantalla que verá el profesional.

        La construye entera `reader/clippingExplorer.js`, el mismo módulo que monta la página del
        lector, sobre el mismo cuerpo de paquete que se cifraría al generar. Por eso aquí no hay ni
        una etiqueta del contenido: el servidor no renderiza nunca nada de esto, y no podría, porque
        son valores en claro que solo existen en este navegador.

        `wire:ignore` con `wire:key` estable, sin `@island`, por el mismo motivo que la gráfica de
        glucemia (ADR 0002): el servidor reemite un island tras cualquier petición de Livewire y se
        llevaría por delante el `<canvas>` con todo lo dibujado.
    --}}
    <section x-show="previewVisible" x-cloak class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Preview') }}
        </h2>

        <p class="mt-1.5 text-helper text-ink-secondary">
            {{ __('This is the extract exactly as the professional will see it, drawn from records already decrypted in this browser. Nothing has been uploaded and no link exists yet.') }}
        </p>

        <div
            id="sharing-preview"
            wire:ignore
            wire:key="sharing-preview-region"
            x-ref="preview"
            class="mt-4 flex flex-col gap-6"
        ></div>
    </section>

    {{--
        Resultado. Aparece solo tras generar y vive únicamente en memoria de esta pestaña: al
        recargar desaparece, y el PIN con él. El servidor no guarda el PIN, solo un comprobante del
        que no se puede volver atrás sin romper Argon2id, así que no hay ningún sitio donde
        volver a consultarlo. Eso se dice, no se deja adivinar.
    --}}
    <section
        x-show="result"
        x-cloak
        class="rounded-card border border-border bg-surface p-card shadow-sm"
    >
        <h2 class="font-display text-subhead text-ink">
            {{ __('Your clipping is ready') }}
        </h2>

        <p class="mt-2 text-body-sm text-ink-secondary">
            <span x-text="result ? result.eventCount : ''" class="font-mono"></span>
            {{ __('records included. Expires:') }}
            {{-- La fecha la formatea `formatDateTime()` en el módulo, con el idioma en vigor: aquí
                 no se llama a `toLocaleString()`, que usaría el del sistema operativo. --}}
            <span x-text="result ? result.expiresAtLabel : ''" class="font-mono"></span>
        </p>

        <div class="mt-4">
            <span class="block text-body-sm font-semibold text-ink">{{ __('Link') }}</span>

            {{--
                El enlace va en monoespaciada (Do's #7: es un identificador que no se puede leer
                mal) y con `break-all`, porque lleva la clave de envío en el fragmento y no cabe en
                una línea. Es un `<p>` seleccionable y NO un `<a>`: pulsarlo abriría aquí mismo la
                página del lector, con la sesión abierta al lado, y no hay nada que ver ahí para
                quien ya tiene los datos.
            --}}
            <p
                x-text="result ? result.url : ''"
                class="mt-1.5 rounded-control border border-border bg-background px-3.5 py-2.5 font-mono text-body-sm break-all text-ink"
            ></p>

            <div class="mt-2 flex flex-wrap items-center gap-4">
                <button
                    type="button"
                    @click="copyLink()"
                    class="inline-flex min-h-11 items-center justify-center rounded-control border-[1.5px] border-accent px-6 py-2.5 text-button text-accent hover:bg-surface-hover hover:text-accent-tinted focus-visible:shadow-focus-blue focus-visible:outline-none"
                >
                    {{ __('Copy link') }}
                </button>

                <button
                    type="button"
                    @click="toggleQr()"
                    class="inline-flex min-h-11 items-center justify-center rounded-control border-[1.5px] border-accent px-6 py-2.5 text-button text-accent hover:bg-surface-hover hover:text-accent-tinted focus-visible:shadow-focus-blue focus-visible:outline-none"
                >
                    <span x-show="! qrVisible">{{ __('Show QR code') }}</span>
                    <span x-show="qrVisible" x-cloak>{{ __('Hide QR code') }}</span>
                </button>

                <p x-show="copied" x-cloak role="status" class="text-body-sm font-semibold text-ink">
                    {{ __('Link copied.') }}
                </p>
            </div>

            <p class="mt-2 text-helper text-ink-secondary">
                {{ __('Only the link is copied, never the PIN: the clipboard ends up in the same conversation where you just pasted the link.') }}
            </p>
        </div>

        {{--
            EL PIN Y EL QR NUNCA COMPARTEN PANTALLA (ADR 0011). Mientras el QR está a la vista, el
            PIN desaparece, para que una sola foto no contenga las dos mitades: quien fotografía el
            QR desde el otro lado de la mesa se lleva el enlace, y eso solo es seguro si el PIN no
            estaba en el mismo encuadre.
        --}}
        <div x-show="! qrVisible" x-cloak class="mt-6 border-t border-border pt-6">
            <span class="block text-body-sm font-semibold text-ink">{{ __('PIN') }}</span>

            {{-- IBM Plex Mono y tamaño grande: seis dígitos que hay que dictar sin equivocarse. --}}
            <p
                x-text="result ? result.pin : ''"
                class="mt-1.5 font-mono text-display tracking-widest text-ink"
            ></p>

            <div class="mt-2 rounded-control border border-warning-outline bg-warning-surface px-3.5 py-2.5">
                <p class="text-body-sm font-semibold text-warning-ink">
                    {{ __('This PIN is shown once and is not stored anywhere.') }}
                </p>
                <p class="mt-1 text-helper text-warning-ink">
                    {{ __('Say it out loud, write it on paper, or send it through a different channel from the link. If you lose it, the clipping cannot be opened and you have to build another one. Five wrong attempts kill the link.') }}
                </p>
            </div>
        </div>

        {{--
            El QR se genera bajo pulsación explícita y solo existe en el DOM mientras está a la
            vista. Fondo blanco dentro del propio SVG incluso en tema oscuro: un QR invertido lo
            leen algunos móviles y otros no, y el que falla lo hace en la consulta.
        --}}
        <div x-show="qrVisible" x-cloak class="mt-6 border-t border-border pt-6">
            <p class="text-body-sm font-semibold text-ink">{{ __('QR code for the full link') }}</p>
            <p class="mt-1 text-helper text-ink-secondary">
                {{ __('The PIN is hidden while the QR is on screen so a single photo cannot capture both halves.') }}
            </p>

            {{--
                `wire:ignore` y `wire:key` estable: el SVG lo escribe Alpine y un re-render de
                Livewire lo borraría (ADR 0002). El relleno blanco es del propio código, no del
                tema: ver el porqué en `qrSvgFor()`.
            --}}
            <div
                wire:ignore
                wire:key="sharing-qr-region"
                x-ref="qr"
                {{--
                    `bg-white` es aquí lo correcto y la única vez que aparece en el panel: el
                    comentario de `theme.css` avisa de que no conmuta con el tema —compila a un
                    literal que ningún bloque de tema alcanza— y por eso las tarjetas se escriben
                    `bg-surface`. El marco del QR quiere exactamente eso: blanco fijo en los dos
                    temas, porque la zona tranquila de un QR tiene que ser clara para que la cámara
                    encuentre los tres patrones de posición.
                --}}
                class="mt-3 inline-block rounded-control bg-white p-4"
            ></div>
        </div>
    </section>

    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Active clippings') }}
        </h2>

        {{--
            El rango, los tipos y el número de registros de cada fila salen de DESCIFRAR el
            descriptor en el navegador: el servidor no los tiene en claro y no puede tenerlos, o
            leer «glucemias, insulina» en una columna sería saber que esta persona es diabética sin
            descifrar un byte (ADR 0006, ADR 0011).
        --}}
        <p class="mt-1 text-helper text-ink-secondary">
            {{ __('What each clipping covers is decrypted here, in your browser: the server only stores the encrypted block and two dates.') }}
        </p>

        <div
            x-show="sharesError"
            x-cloak
            role="alert"
            class="mt-4 flex items-start gap-2 rounded-control border border-error-outline bg-error-surface px-3.5 py-2.5"
        >
            <svg class="mt-px size-5 shrink-0 text-error-ink" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clip-rule="evenodd" />
            </svg>
            <p x-text="sharesError" class="text-helper text-error-ink"></p>
        </div>

        {{--
            Región descifrada: `wire:ignore` y `wire:key` estable, y la construye Alpine entera
            (ADR 0002). Sin `@island`, por el mismo motivo que la gráfica de glucemia: el servidor
            emitiría el island vacío tras cualquier petición de Livewire y `$refs.shares` quedaría
            sin contenedor.
        --}}
        <div wire:ignore wire:key="sharing-list-region" x-ref="shares" class="mt-4"></div>
    </section>
</div>
</x-filament-panels::page>
