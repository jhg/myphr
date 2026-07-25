{{--
    Página genérica de establecimiento de contraseña (Spec 0001 §4.1, §5, §7 y §10).

    Se sirve igual para cualquier token: el token viaja en el fragmento de la URL y el navegador lo
    lee de ahí, así que esta plantilla no lo recibe ni lo puede validar. El error de enlace no válido
    lo muestra el cliente cuando `registration/start` responde con su error genérico.

    No hay Livewire detrás: es un controlador invocable plano y un componente Alpine. La contraseña
    se lee de los nodos del DOM y los `<input>` se vacían antes de derivar nada (§5, paso 2).

    El campo de correo existe porque el paso 13 de §5 hace un login OPAQUE completo y
    `login/start` necesita el identificador de la cuenta, que ninguna respuesta del registro
    devuelve.

    Replica a mano la estructura de `fi-simple-page` porque no hay componente Livewire detrás que
    resuelva `$this->getHeading()`.
--}}
<x-filament-panels::layout.simple>
    <section class="fi-simple-page" data-phr-page="set-password">
        <header class="fi-simple-header">
            <h1 class="fi-simple-header-heading">
                {{ __('Establece tu contraseña') }}
            </h1>

            <p class="fi-simple-header-subheading">
                {{ __('Tu contraseña no sale de este navegador. Nadie puede recuperarla por ti.') }}
            </p>
        </header>

        <form
            x-data="phrSetPasswordForm"
            data-phr-form="set-password"
            method="post"
            action="{{ route('filament.phr.auth.opaque.registration.start') }}"
            data-registration-start-url="{{ route('filament.phr.auth.opaque.registration.start') }}"
            data-registration-finish-url="{{ route('filament.phr.auth.opaque.registration.finish') }}"
            data-login-start-url="{{ route('filament.phr.auth.opaque.login.start') }}"
            data-login-finish-url="{{ route('filament.phr.auth.opaque.login.finish') }}"
            novalidate
            x-on:submit.prevent="submit"
        >
            <div class="fi-fo-field-wrp">
                <label class="fi-fo-field-wrp-label" for="phr-login">{{ __('Correo electrónico') }}</label>
                <input id="phr-login" name="login" type="email" autocomplete="username" autocapitalize="none"
                       spellcheck="false" required class="fi-input" x-ref="login" />
            </div>

            <div class="fi-fo-field-wrp">
                <label class="fi-fo-field-wrp-label" for="phr-password">{{ __('Contraseña') }}</label>
                <input id="phr-password" name="password" type="password" autocomplete="new-password" required
                       class="fi-input" x-ref="password" />
            </div>

            <div class="fi-fo-field-wrp">
                <label class="fi-fo-field-wrp-label" for="phr-password-confirmation">
                    {{ __('Repite la contraseña') }}
                </label>
                <input id="phr-password-confirmation" name="password_confirmation" type="password"
                       autocomplete="new-password" required class="fi-input" x-ref="passwordConfirmation" />
            </div>

            <p data-phr-error role="alert" x-show="error" x-text="error" x-cloak></p>

            @include('phr.partials.crypto-progress')

            <button type="submit" class="fi-btn fi-btn-size-md" x-bind:disabled="busy">
                <span x-show="! busy">{{ __('Establecer contraseña y entrar') }}</span>
                <span x-show="busy" x-cloak>{{ __('Creando tu clave…') }}</span>
            </button>
        </form>
    </section>
</x-filament-panels::layout.simple>
