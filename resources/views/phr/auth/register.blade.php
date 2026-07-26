{{--
    Pantalla de alta pública, sin invitación (`RegistrationPublicStartController`).

    Calca `set-password.blade.php`: mismo controlador invocable plano detrás, mismo componente
    Alpine sin `wire:model` y sin Livewire de por medio, mismos tokens de MediCare+
    (`resources/css/filament/phr/theme.css`, DESIGN.md).

    A diferencia de `set-password.blade.php`, aquí no hay token de invitación que leer del
    fragmento de la URL: el nombre y el correo los escribe la propia persona y viajan en el cuerpo
    de `registration/public/start` junto con la petición OPAQUE.
--}}
<x-filament-panels::layout.simple>
    <section class="fi-simple-page flex flex-col gap-8" data-phr-page="register">
        <header class="fi-simple-header">
            {{-- Headline: Figtree 26px bold (DESIGN.md § Typography) --}}
            <h1 class="fi-simple-header-heading font-display text-headline text-ink">
                {{ __('Create your account') }}
            </h1>

            {{-- Body 16px #475569 --}}
            <p class="fi-simple-header-subheading mt-2 text-body text-ink-secondary">
                {{ __('Your password never leaves this browser. Nobody can recover it for you.') }}
            </p>
        </header>

        <form
            class="space-y-6"
            x-data="phrRegisterForm"
            data-phr-form="register"
            {{--
                Sin `method` ni `action`, y sin `name` en ningún campo: un envío nativo del
                formulario (Enter antes de que Alpine hidrate, un `app.js` que no cargó, un bundle
                obsoleto tras un despliegue) mandaría la contraseña y su confirmación en claro al
                endpoint OPAQUE, donde quedarían en memoria del proceso PHP aunque el CSRF rechazase
                la petición después. Sin `action` ni `name`, un envío nativo recarga esta misma
                página y no lleva nada. Las URLs viajan en `data-*` y las lee `registerPage.js`.
                Mismo criterio que `set-password.blade.php` y `login.blade.php`.
            --}}
            data-registration-start-url="{{ route('filament.phr.auth.opaque.registration.public-start') }}"
            data-registration-finish-url="{{ route('filament.phr.auth.opaque.registration.finish') }}"
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
                <label class="{{ $labelClass }}" for="phr-name">
                    {{ __('Full name') }}
                    {{-- Campo obligatorio (Do's #5): asterisco visible en #DC2626. --}}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <input id="phr-name" type="text" autocomplete="name" required class="{{ $inputClass }}"
                       x-ref="name" />
            </div>

            <div class="fi-fo-field-wrp">
                <label class="{{ $labelClass }}" for="phr-login">
                    {{ __('Email address') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <input id="phr-login" type="email" autocomplete="username" autocapitalize="none"
                       spellcheck="false" required class="{{ $inputClass }}" x-ref="login" />
            </div>

            <div class="fi-fo-field-wrp">
                <label class="{{ $labelClass }}" for="phr-password">
                    {{ __('Password') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <input id="phr-password" type="password" autocomplete="new-password" required
                       class="{{ $inputClass }}" x-ref="password" />
            </div>

            <div class="fi-fo-field-wrp">
                <label class="{{ $labelClass }}" for="phr-password-confirmation">
                    {{ __('Repeat the password') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <input id="phr-password-confirmation" type="password"
                       autocomplete="new-password" required class="{{ $inputClass }}" x-ref="passwordConfirmation" />
            </div>

            {{--
                Aviso zero-knowledge (ADR 0003): es el momento en que nace la clave y el único en el
                que la advertencia puede cambiar una decisión. Nunca «el servidor nunca ve nada»
                —el ADR la marca expresamente como falsa ante auditoría, porque quien controla el
                servidor que sirve este mismo JavaScript podría servir una versión distinta—, sino lo
                que sí es cierto: cifrado en el dispositivo y sin recuperación posible del olvido.

                Helper text (DESIGN.md § Helper Text): 13px, tinta secundaria, sin fondo de aviso
                porque no es un error, es información previa a una decisión.
            --}}
            <p data-phr-zero-knowledge class="text-helper text-ink-secondary">
                {{ __('Your data is encrypted on this device before it is sent. The server cannot read it. If you forget your password, your data cannot be recovered — not by us, not by anyone.') }}
            </p>

            {{--
                Error del formulario como aviso de error (DESIGN.md § Chips · Error y § Helper
                Text): fondo #FEF2F2, borde #FECACA, 13px e icono de aviso, porque el color no
                puede ser el único portador del mensaje (Do's #3). El texto va en un `<span>`
                aparte: `x-text` sobre el contenedor borraría el icono.

                Cuando el error es el 409 `login_taken`, `registerPage.js` deja `loginTaken` a
                verdadero y aquí se añade, dentro del mismo aviso, un enlace a iniciar sesión: es la
                acción concreta que corresponde, no una nota más en el texto (encargo explícito).

                Los tres colores salen de los tokens `error-surface` / `error-outline` / `error-ink`,
                que conmutan solos entre § Chips y § Dark Mode · Status Chip. La tinta clara es
                #B91C1C y no el #DC2626 de § Chips porque ese par sobre #FEF2F2 da 4.41:1 y no llega
                al 4.5:1 de Do's #1; el porqué está en `theme.css`, junto a los tokens.
            --}}
            <div
                data-phr-error
                role="alert"
                x-show="error"
                x-cloak
                class="flex flex-col gap-2 rounded-control border border-error-outline bg-error-surface px-3.5 py-2.5 text-helper text-error-ink"
            >
                <div class="flex items-start gap-2">
                    <svg class="mt-px size-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.19-1.458-1.516-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
                    </svg>
                    <span x-text="error"></span>
                </div>

                <a
                    x-show="loginTaken"
                    x-cloak
                    href="{{ route('filament.phr.auth.login') }}"
                    class="ml-6 self-start font-semibold text-error-ink underline underline-offset-2"
                >
                    {{ __('Sign in') }}
                </a>
            </div>

            @include('phr.partials.crypto-progress')

            {{--
                DESIGN.md § Buttons · Primary: relleno #0077B6, tinta #FFFFFF, radio 8px, Open
                Sans 15px semibold, padding 10px/24px, 44px de alto mínimo (Do's #2), hover
                #006399 y active #005280.

                Va en `bg-accent` + `text-accent-ink`, no en `bg-primary-600` + `text-white`: la
                rampa `primary` NO se reasigna en oscuro, así que el relleno seguía siendo #0077B6
                y, sobre todo, el blanco encima incumple § Dark Mode · Components, que fija
                relleno #48CAE4 con tinta #0B1220 y dice con todas las letras que «white text on
                this fill cannot reach AA» (1.94:1). Con los dos tokens el par es #FFFFFF sobre
                #0077B6 (4.87:1) en claro y #0B1220 sobre #48CAE4 (9.67:1) en oscuro, sin ninguna
                variante `dark:` que se pueda olvidar.

                Deshabilitado mientras `busy`: `disabled:bg-surface-disabled` +
                `disabled:text-ink-disabled` son #E2E8F0/#94A3B8 en claro (§ Buttons · Disabled) y
                #1B2740/#8093AE en oscuro (§ Dark Mode · Button Disabled, 4.75:1).
            --}}
            <button
                type="submit"
                class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-accent px-6 py-2.5 text-button text-accent-ink transition hover:bg-accent-hover active:bg-accent-active focus-visible:outline-none focus-visible:shadow-focus-blue disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-ink-disabled disabled:hover:bg-surface-disabled"
                x-bind:disabled="busy"
            >
                <span x-show="! busy">{{ __('Create account and sign in') }}</span>
                <span x-show="busy" x-cloak>{{ __('Creating your key…') }}</span>
            </button>
        </form>

        {{--
            Pie de la pantalla de alta: enlace de vuelta a acceder, para quien llegó aquí por error
            o ya tiene cuenta. Mismo tamaño y tinta que el pie de `login.blade.php`.
        --}}
        <p class="text-center text-caption text-ink-secondary">
            {{ __('Already have an account?') }}
            <a href="{{ route('filament.phr.auth.login') }}" class="font-semibold text-accent underline underline-offset-2">
                {{ __('Sign in') }}
            </a>
        </p>
    </section>
</x-filament-panels::layout.simple>
