<?php

namespace App\Providers;

use App\Console\Commands\ProhibitedMakeFilamentUserCommand;
use App\Livewire\Hooks\EncryptedPayloadGuardHook;
use App\Support\SystemTerminal;
use App\Support\Terminal;
use Illuminate\Support\ServiceProvider;
use Livewire\Livewire;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(Terminal::class, SystemTerminal::class);
        $this->registerEncryptedPayloadGuard();
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->prohibitFilamentUserCommand();
    }

    /**
     * Spec 0001 §9: `make:filament-user` y sus alias quedan deshabilitados.
     *
     * Se registra en `boot()`, después de que el proveedor de Filament haya registrado el suyo en
     * `register()`: la consola resuelve por nombre y la última definición gana, así que los tres
     * nombres (`make:filament-user`, `filament:make-user`, `filament:user`) acaban apuntando al
     * comando que aborta con la explicación.
     */
    private function prohibitFilamentUserCommand(): void
    {
        $this->commands([
            ProhibitedMakeFilamentUserCommand::class,
        ]);
    }

    /**
     * Spec 0001 §9 / ADR 0002: mitad de servidor del par de guardarraíles contra fugas de dato en
     * claro. Se registra aquí, no en un proveedor propio, porque es la opción más simple: no hay hoy
     * más de un par de piezas de arranque de Livewire en la aplicación que justifiquen un proveedor
     * dedicado (decisión propia, la spec no concreta dónde engancharlo más allá de sugerir
     * `AppServiceProvider::boot()` o un proveedor propio).
     *
     * Se llama desde `register()`, no desde `boot()`: `LivewireServiceProvider::boot()` congela la
     * lista de hooks de componente en cuanto arranca (`ComponentHookRegistry::boot()`), y Laravel
     * ejecuta la fase `register()` de todos los proveedores antes que la fase `boot()` de ninguno.
     * Registrar el hook en `boot()` lo dejaría fuera de esa lista si `AppServiceProvider` arranca
     * después que el proveedor de Livewire, que es el orden real en esta aplicación.
     */
    private function registerEncryptedPayloadGuard(): void
    {
        Livewire::componentHook(EncryptedPayloadGuardHook::class);
    }
}
