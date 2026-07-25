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
<section
    class="fi-simple-page"
    data-phr-page="login"
>
    <header class="fi-simple-header">
        <h1 class="fi-simple-header-heading">
            {{ __('Entrar') }}
        </h1>

        <p class="fi-simple-header-subheading">
            {{ __('Tu contraseña se queda en este navegador. El servidor nunca la recibe.') }}
        </p>
    </header>

    <form
        wire:ignore
        x-data="phrLoginForm"
        data-phr-form="login"
        method="post"
        action="{{ route('filament.phr.auth.opaque.login.start') }}"
        data-login-start-url="{{ route('filament.phr.auth.opaque.login.start') }}"
        data-login-finish-url="{{ route('filament.phr.auth.opaque.login.finish') }}"
        novalidate
        x-on:submit.prevent="submit"
    >
        <div class="fi-fo-field-wrp">
            <label class="fi-fo-field-wrp-label" for="phr-login">{{ __('Correo electrónico') }}</label>
            <input
                id="phr-login"
                name="login"
                type="email"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                required
                class="fi-input"
                x-ref="login"
            />
        </div>

        <div class="fi-fo-field-wrp">
            <label class="fi-fo-field-wrp-label" for="phr-password">{{ __('Contraseña') }}</label>
            <input
                id="phr-password"
                name="password"
                type="password"
                autocomplete="current-password"
                required
                class="fi-input"
                x-ref="password"
            />
        </div>

        <p data-phr-error role="alert" x-show="error" x-text="error" x-cloak></p>

        @include('phr.partials.crypto-progress')

        <button type="submit" class="fi-btn fi-btn-size-md" x-bind:disabled="busy">
            <span x-show="! busy">{{ __('Entrar') }}</span>
            <span x-show="busy" x-cloak>{{ __('Comprobando…') }}</span>
        </button>
    </form>
</section>
