{{--
    Página de perfil: ajustes de la cuenta y cambio de contraseña (ADR 0002, ADR 0004, ADR 0007,
    ADR 0009).

    Estructura fija: el componente Alpine `phrProfilePage` (`resources/js/auth/profilePage.js`) lee
    los campos por `x-ref`, así que los nombres de los `x-ref`, el nombre del componente y los
    `data-*-url` son el contrato entre los dos ficheros y no se tocan por separado.

    Nada de `wire:model` (ADR 0002): ni la contraseña ni los ajustes pasan por Livewire. Los ajustes
    suben ya cifrados a `PUT /phr/settings` y la contraseña no sale nunca del navegador —lo que sale
    es un registro OPAQUE nuevo y la clave maestra reenvuelta bajo la clave que deriva de él—, así
    que aquí no hay ninguna propiedad pública ni ningún campo enlazado al servidor.

    Las URL van literales en `data-*` y no por `route()` a propósito: esas rutas las está montando
    otro trabajo y `route()` sobre un nombre que todavía no existe reventaría la página entera.
    Cuando estén registradas, se sustituyen por `route('filament.phr.settings.update')` y sus
    hermanas sin tocar el JavaScript.

    Estilo: MediCare+ (DESIGN.md). Mismas tarjetas, etiquetas, campos y botones que
    `glucose.blade.php`: relleno blanco, borde 1px #E2E8F0, radio 8px, sombra Subtle, 24px de
    relleno. Aquí no se inventa ningún color, radio ni tamaño.
--}}
{{--
    Envuelto en `<x-filament-panels::page>` por el mismo motivo que `glucose.blade.php`: esta página
    define su propia `$view` y sin ese componente se pierde el contenedor `fi-page-header-main-ctn`
    de Filament, que aporta el `py-8` y la cabecera. Sin él la primera tarjeta queda pegada a la
    barra superior.
--}}
<x-filament-panels::page>
<div
    x-data="phrProfilePage"
    wire:key="profile-page"
    class="space-y-6"
>
    {{-- ────────────────────────  Ajustes  ──────────────────────── --}}
    <form
        x-ref="settingsForm"
        @submit.prevent="submitSettings"
        data-settings-url="/phr/settings"
        class="space-y-6"
    >
        {{-- 1 · Idioma de la aplicación --}}
        <section class="rounded-card border border-border bg-surface p-card shadow-sm">
            <h2 class="font-display text-subhead text-ink">
                {{ __('Application language') }}
            </h2>

            {{--
                Este ajuste NO va en el sobre cifrado, y decirlo en la propia pantalla es parte del
                trato: el servidor tiene que poder leerlo para pintar el menú, las migas y la
                pantalla de acceso, que se dibuja antes de que exista ninguna clave (ADR 0007).
            --}}
            <p class="mt-2 text-body-sm text-ink-secondary">
                {{ __('This is the only setting on this screen that the server can read: it needs it to draw the menus and the sign-in screen, which appears before your key exists. It says nothing about your health.') }}
            </p>

            <div class="mt-4 max-w-xs">
                <label for="profile-locale" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Language') }}
                </label>
                <select
                    id="profile-locale"
                    x-ref="locale"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    @foreach ($this->locales() as $locale)
                        <option value="{{ $locale['code'] }}" @selected($locale['code'] === $this->currentLocale())>{{ $locale['label'] }}</option>
                    @endforeach
                </select>
            </div>
        </section>

        {{-- 2 · Unidad preferida de glucemia --}}
        <section class="rounded-card border border-border bg-surface p-card shadow-sm">
            <h2 class="font-display text-subhead text-ink">
                {{ __('Preferred blood glucose unit') }}
            </h2>

            <p class="mt-2 text-body-sm text-ink-secondary">
                {{ __('This is the unit preselected when you record a blood glucose reading. Changing it neither converts nor rewrites anything you have already saved: every record keeps the unit it was written in.') }}
            </p>

            <div class="mt-4 max-w-xs">
                <label for="profile-glucose-unit" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Unit') }}
                </label>
                {{-- Los códigos UCUM van en monoespaciada, como en la pantalla de glucemia. --}}
                <select
                    id="profile-glucose-unit"
                    x-ref="glucoseUnit"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
                    @foreach ($this->glucoseUnits() as $unit)
                        <option value="{{ $unit['code'] }}">{{ $unit['label'] }}</option>
                    @endforeach
                </select>
            </div>
        </section>

        {{-- 3 · Rango objetivo de glucemia --}}
        <section class="rounded-card border border-border bg-surface p-card shadow-sm">
            <h2 class="font-display text-subhead text-ink">
                {{ __('Target blood glucose range') }}
            </h2>

            {{--
                EMPIEZA VACÍO Y SIN VALOR SUGERIDO. El ADR 0007 lo prohíbe expresamente: un rango por
                defecto es una indicación clínica, no una preferencia de interfaz. Por eso aquí no
                hay `value`, ni `placeholder` numérico, ni «rango habitual» de ejemplo. El texto de
                ayuda dice de dónde sale el número (su médico), nunca cuál es.
            --}}
            <p class="mt-2 text-body-sm text-ink-secondary">
                {{ __('It is used to work out the percentage of time your readings fall within range. It starts empty on purpose: the limits are set by your doctor, not by this application. Until you fill it in, that percentage is simply not calculated.') }}
            </p>

            <p class="mt-2 text-body-sm text-ink-secondary">
                {{ __('The range keeps the unit you write it in. If a summary is shown in another unit, the percentage is not calculated rather than converted on its own.') }}
            </p>

            <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                    <label for="profile-range-low" class="mb-1.5 block text-body-sm font-semibold text-ink">
                        {{ __('Lower limit') }}
                    </label>
                    {{--
                        Numérico, no texto, con `min="0"` y `step="any"`: la convención de todo campo
                        de medida del proyecto (.ai/guidelines/ai.md). El límite de 2 decimales lo
                        impone `numericValue.js` en el cliente, no el navegador.
                    --}}
                    <input
                        id="profile-range-low"
                        x-ref="rangeLow"
                        type="number"
                        min="0"
                        step="any"
                        inputmode="decimal"
                        class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                    >
                </div>

                <div>
                    <label for="profile-range-high" class="mb-1.5 block text-body-sm font-semibold text-ink">
                        {{ __('Upper limit') }}
                    </label>
                    <input
                        id="profile-range-high"
                        x-ref="rangeHigh"
                        type="number"
                        min="0"
                        step="any"
                        inputmode="decimal"
                        class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                    >
                </div>

                <div>
                    <label for="profile-range-unit" class="mb-1.5 block text-body-sm font-semibold text-ink">
                        {{ __('Range unit') }}
                    </label>
                    <select
                        id="profile-range-unit"
                        x-ref="rangeUnit"
                        class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 font-mono text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                    >
                        @foreach ($this->glucoseUnits() as $unit)
                            <option value="{{ $unit['code'] }}">{{ $unit['label'] }}</option>
                        @endforeach
                    </select>
                </div>
            </div>

            <p class="mt-2 text-helper text-ink-secondary">
                {{ __('Leave both limits blank to stop using the range.') }}
            </p>
        </section>

        {{--
            Guardar los ajustes: una sola petición para las tres secciones de arriba.

            Botón primario · § Buttons · Primary, escrito con `bg-accent` + `text-accent-ink` y no
            con `bg-primary-600` + `text-white`: la rampa `primary` no se reasigna en oscuro y el
            blanco encima incumple § Dark Mode · Components, que fija relleno #48CAE4 con tinta
            #0B1220 porque «white text on this fill cannot reach AA» (1.94:1). Con los tokens el
            par es #FFFFFF sobre #0077B6 (4.87:1) en claro y #0B1220 sobre #48CAE4 (9.67:1) en
            oscuro. El deshabilitado va igual: `disabled:bg-surface-disabled` +
            `disabled:text-ink-disabled` (#E2E8F0/#94A3B8 en claro, #1B2740/#8093AE en oscuro).
            Vale también para el botón de cambiar la contraseña, más abajo.
        --}}
        <div class="flex flex-wrap items-center gap-4">
            <button
                type="submit"
                class="inline-flex min-h-11 items-center justify-center rounded-control bg-accent px-6 py-2.5 text-button text-accent-ink hover:bg-accent-hover focus-visible:shadow-focus-blue focus-visible:outline-none active:bg-accent-active disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-ink-disabled disabled:hover:bg-surface-disabled"
                x-bind:disabled="savingSettings"
                x-bind:aria-busy="savingSettings ? 'true' : 'false'"
            >
                <span x-show="! savingSettings">{{ __('Save settings') }}</span>
                <span x-show="savingSettings" x-cloak>{{ __('Saving…') }}</span>
            </button>

            {{-- Confirmación. Nunca repite el valor guardado: no hace falta y son datos clínicos. --}}
            <p
                x-show="settingsSaved"
                x-cloak
                role="status"
                class="text-body-sm font-semibold text-ink"
            >
                {{ __('Settings saved.') }}
            </p>
        </div>

        {{--
            Error de validación, de cifrado o de red. Mismo bloque que en `glucose.blade.php`: icono
            de aviso delante del texto (Do's #3, nunca solo color), `role="alert"` a secas —que ya
            implica `aria-live="assertive"`— y los tokens `error-surface` / `error-outline` /
            `error-ink`, que conmutan solos entre claro y oscuro.
        --}}
        <div
            x-show="settingsError"
            x-cloak
            role="alert"
            class="flex items-start gap-2 rounded-control border border-error-outline bg-error-surface px-3.5 py-2.5"
        >
            <svg class="mt-px size-5 shrink-0 text-error-ink" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clip-rule="evenodd" />
            </svg>
            <p x-text="settingsError" class="text-helper text-error-ink"></p>
        </div>
    </form>

    {{-- ────────────────────  Cambio de contraseña  ──────────────────── --}}
    <section class="rounded-card border border-border bg-surface p-card shadow-sm">
        <h2 class="font-display text-subhead text-ink">
            {{ __('Change your password') }}
        </h2>

        {{--
            El aviso no es cortesía: cambiar la contraseña vuelve a envolver la clave maestra bajo
            una clave nueva y escribe el registro OPAQUE y el sobre en una única operación. Cerrar la
            pestaña a mitad no rompe nada (o cambian las dos cosas o no cambia ninguna), pero sí
            obliga a repetir los dos estiramientos de clave, que son la parte lenta. Se dice antes de
            empezar, no después.
        --}}
        <div
            role="note"
            class="mt-4 flex items-start gap-2 rounded-control border border-info-outline bg-info-surface px-3.5 py-2.5"
        >
            <svg class="mt-px size-5 shrink-0 text-info-ink" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm11.378-3.917a1.125 1.125 0 1 0-2.25 0 1.125 1.125 0 0 0 2.25 0ZM11.25 10.5a.75.75 0 0 0 0 1.5h.25v3.75h-.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5H13V11.25a.75.75 0 0 0-.75-.75h-1Z" clip-rule="evenodd" />
            </svg>
            <p class="text-body-sm text-info-ink">
                {{ __('Your password never travels to the server. When you change it, your browser rewraps your key with the new password; your data is not re-encrypted and nothing is lost. The process takes a few seconds and has to be allowed to finish: do not close or reload this tab until you see the confirmation.') }}
            </p>
        </div>

        <form x-ref="passwordForm" @submit.prevent="submitPassword"
            data-reauth-start-url="/phr/auth/password/reauth/start"
            data-reauth-finish-url="/phr/auth/password/reauth/finish"
            data-registration-start-url="/phr/auth/password/registration/start"
            data-change-url="/phr/auth/password/change"
            class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
            <div class="sm:col-span-2 sm:max-w-sm">
                <label for="profile-current-password" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Current password') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <input
                    id="profile-current-password"
                    x-ref="currentPassword"
                    type="password"
                    autocomplete="current-password"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div>
                <label for="profile-new-password" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('New password') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <input
                    id="profile-new-password"
                    x-ref="newPassword"
                    type="password"
                    autocomplete="new-password"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div>
                <label for="profile-new-password-confirmation" class="mb-1.5 block text-body-sm font-semibold text-ink">
                    {{ __('Repeat the new password') }}
                    <span class="text-destructive-text" aria-hidden="true">*</span>
                </label>
                <input
                    id="profile-new-password-confirmation"
                    x-ref="newPasswordConfirmation"
                    type="password"
                    autocomplete="new-password"
                    aria-required="true"
                    class="block min-h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-body text-ink focus:border-accent focus:shadow-focus-blue focus:outline-none"
                >
            </div>

            <div class="sm:col-span-2">
                <button
                    type="submit"
                    class="inline-flex min-h-11 items-center justify-center rounded-control bg-accent px-6 py-2.5 text-button text-accent-ink hover:bg-accent-hover focus-visible:shadow-focus-blue focus-visible:outline-none active:bg-accent-active disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-ink-disabled disabled:hover:bg-surface-disabled"
                    x-bind:disabled="busy"
                    x-bind:aria-busy="busy ? 'true' : 'false'"
                >
                    <span x-show="! busy">{{ __('Change your password') }}</span>
                    <span x-show="busy" x-cloak>{{ __('Changing…') }}</span>
                </button>
            </div>

            {{--
                Barra de progreso obligatoria (Spec 0001 §5, paso 6): el estiramiento de clave corre
                de forma síncrona en el hilo principal y deja la pestaña bloqueada. Aquí son DOS
                tramos, el de la contraseña actual y el de la nueva, y la barra los anuncia por
                separado para que la misma pausa dos veces no invite a pulsar otra vez.
            --}}
            <div class="sm:col-span-2">
                @include('phr.partials.crypto-progress')
            </div>

            <div class="sm:col-span-2">
                <p
                    x-show="passwordChanged"
                    x-cloak
                    role="status"
                    class="text-body-sm font-semibold text-ink"
                >
                    {{ __('Password changed. Your key is still the same and your data has not been touched.') }}
                </p>
            </div>

            <div
                x-show="passwordError"
                x-cloak
                role="alert"
                class="flex items-start gap-2 rounded-control border border-error-outline bg-error-surface px-3.5 py-2.5 sm:col-span-2"
            >
                <svg class="mt-px size-5 shrink-0 text-error-ink" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clip-rule="evenodd" />
                </svg>
                <p x-text="passwordError" class="text-helper text-error-ink"></p>
            </div>
        </form>
    </section>
</div>
</x-filament-panels::page>
