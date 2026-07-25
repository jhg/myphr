{{--
    Formulario de login (Spec 0001 §6.1; ADR 0001 y 0002).

    HTML plano dentro de una página Livewire. Nada de `wire:model`, nada de `wire:submit`, nada de
    schema de Filament: la contraseña se lee del nodo del DOM, se vacía el `<input>` y se entrega al
    cliente OPAQUE, que habla por `fetch`. Si algún día apareciera un `wire:model` en el campo de
    contraseña, la contraseña viajaría en el `snapshot` de Livewire y quedaría en la instantánea de
    DOM que el componente retiene; `tests/Feature/PhrAuthPagesTest.php` falla si eso ocurre.

    `wire:ignore` protege el subárbol de cualquier re-render de Livewire: un `morph` sobre el
    `<input>` podría reponer un valor que Alpine ya había vaciado.

    Replica a mano la estructura de `fi-simple-page` (§10): no hay schema detrás que la construya.
--}}
{{--
    Estilos: los tokens de MediCare+ viven en `resources/css/filament/phr/theme.css` y en
    `PhrPanelProvider` (DESIGN.md). Aquí solo se componen utilidades; ningún color, radio o
    tamaño se escribe a mano fuera de la escala. Las utilidades ganan a las clases `fi-*` del
    vendor porque Filament importa sus componentes en `layer(components)`, anterior a
    `layer(utilities)`.
--}}
<section
    class="fi-simple-page flex flex-col gap-8"
    data-phr-page="login"
>
    <header class="fi-simple-header">
        {{-- Headline: Figtree 26px bold (DESIGN.md § Typography) --}}
        <h1 class="fi-simple-header-heading font-display text-headline text-ink">
            {{ __('Sign in') }}
        </h1>

        {{-- Body 16px #475569 --}}
        <p class="fi-simple-header-subheading mt-2 text-body text-ink-secondary">
            {{ __('Your password stays in this browser. The server never receives it.') }}
        </p>
    </header>

    <form
        class="space-y-6"
        wire:ignore
        x-data="phrLoginForm"
        data-phr-form="login"
        {{--
            Sin `method` ni `action`: un envío nativo del formulario (Enter antes de que Alpine
            hidrate, un `app.js` que no cargó, un bundle obsoleto tras un despliegue) mandaría la
            contraseña en claro en el cuerpo de un POST al endpoint OPAQUE. El CSRF lo rechazaría
            después, pero el dato ya habría viajado y ya estaría en memoria del proceso PHP, a la
            vista de cualquier captura de cuerpo de petición (APM, Sentry, proxy con log de POST).
            Sin `action`, un envío nativo recarga esta misma página con un GET y los campos, que no
            tienen `name`, no aportan nada. Las URLs de los endpoints viajan en `data-*` y las lee
            `loginPage.js`. El mismo criterio en `set-password.blade.php` y en `profile.blade.php`.
        --}}
        data-login-start-url="{{ route('filament.phr.auth.opaque.login.start') }}"
        data-login-finish-url="{{ route('filament.phr.auth.opaque.login.finish') }}"
        novalidate
        x-on:submit.prevent="submit"
    >
        {{-- DESIGN.md § Inputs · Label: Open Sans 14px 600, #0F172A, 6px de margen inferior. --}}
        @php($labelClass = 'mb-1.5 block text-body-sm font-semibold text-ink')

        {{--
            DESIGN.md § Inputs · Text Input: relleno #FFFFFF, borde 1.5px #CBD5E1, radio 8px,
            texto #0F172A a 16px, 44px de alto, padding 10px/14px y foco con el anillo azul de
            alta visibilidad (§ Elevation · Blue Focus, Do's #9).
        --}}
        @php($inputClass = 'block w-full min-h-11 rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted transition focus:border-accent focus:outline-none focus:shadow-focus-blue')

        <div class="fi-fo-field-wrp">
            <label class="{{ $labelClass }}" for="phr-login">
                {{ __('Email address') }}
                {{-- Campo obligatorio (Do's #5): asterisco visible en #DC2626. --}}
                <span class="text-destructive-text" aria-hidden="true">*</span>
            </label>
            <input
                id="phr-login"
                type="email"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                required
                class="{{ $inputClass }}"
                x-ref="login"
            />
        </div>

        <div class="fi-fo-field-wrp">
            <label class="{{ $labelClass }}" for="phr-password">
                {{ __('Password') }}
                <span class="text-destructive-text" aria-hidden="true">*</span>
            </label>
            <input
                id="phr-password"
                type="password"
                autocomplete="current-password"
                required
                class="{{ $inputClass }}"
                x-ref="password"
            />
        </div>

        {{--
            Error del formulario como aviso de error (DESIGN.md § Chips · Error y § Helper Text):
            fondo #FEF2F2, borde #FECACA, 13px e icono de aviso, porque el color por sí solo no
            puede ser el único portador del mensaje (Do's #3). El texto va en un `<span>` aparte:
            `x-text` sobre el contenedor borraría el icono.

            Los tres colores salen de los tokens `error-surface` / `error-outline` / `error-ink`,
            que conmutan solos entre § Chips y § Dark Mode · Status Chip. La tinta clara es #B91C1C
            y no el #DC2626 de § Chips porque ese par sobre #FEF2F2 da 4.41:1 y no llega al 4.5:1
            de Do's #1; el porqué completo está en `theme.css`, junto a los tokens.
        --}}
        <div
            data-phr-error
            role="alert"
            x-show="error"
            x-cloak
            class="flex items-start gap-2 rounded-control border border-error-outline bg-error-surface px-3.5 py-2.5 text-helper text-error-ink"
        >
            <svg class="mt-px size-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.19-1.458-1.516-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
            </svg>
            <span x-text="error"></span>
        </div>

        @include('phr.partials.crypto-progress')

        {{--
            DESIGN.md § Buttons · Primary: relleno #0077B6, tinta #FFFFFF, radio 8px, Open Sans
            15px semibold, padding 10px/24px, 44px de alto mínimo (Do's #2), hover #006399 y
            active #005280.

            Va en `bg-accent` + `text-accent-ink`, no en `bg-primary-600` + `text-white`: la rampa
            `primary` NO se reasigna en oscuro, así que el relleno seguía siendo #0077B6 y, sobre
            todo, el blanco encima incumple § Dark Mode · Components, que fija relleno #48CAE4 con
            tinta #0B1220 y dice con todas las letras que «white text on this fill cannot reach
            AA» (1.94:1). Con los dos tokens el par es #FFFFFF sobre #0077B6 (4.87:1) en claro y
            #0B1220 sobre #48CAE4 (9.67:1) en oscuro, sin ninguna variante `dark:` que se pueda
            olvidar.

            Deshabilitado mientras `busy`: `disabled:bg-surface-disabled` +
            `disabled:text-ink-disabled` son #E2E8F0/#94A3B8 en claro (§ Buttons · Disabled) y
            #1B2740/#8093AE en oscuro (§ Dark Mode · Button Disabled, 4.75:1).
        --}}
        <button
            type="submit"
            class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-accent px-6 py-2.5 text-button text-accent-ink transition hover:bg-accent-hover active:bg-accent-active focus-visible:outline-none focus-visible:shadow-focus-blue disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-ink-disabled disabled:hover:bg-surface-disabled"
            x-bind:disabled="busy"
        >
            <span x-show="! busy">{{ __('Sign in') }}</span>
            <span x-show="busy" x-cloak>{{ __('Checking…') }}</span>
        </button>
    </form>

    {{--
        Pie de la pantalla de acceso. Va en tamaño Caption y tinta secundaria (DESIGN.md
        § Typography y § Colors), que conmutan solas con el modo oscuro: es un crédito, no
        información que la persona necesite para entrar, así que no compite con el formulario.

        «CubePath» es un nombre propio y no se traduce; lo que sí pasa por `__()` es la frase que lo
        rodea, para que en chino o en castellano el orden de las palabras pueda ser otro.
    --}}
    <p class="mt-8 text-center text-caption text-ink-secondary">
        {{ __('Hosted on :provider', ['provider' => 'CubePath']) }}
    </p>
</section>
