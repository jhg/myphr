<?php

declare(strict_types=1);

namespace App\Filament\Auth;

use App\Filament\Pages\PhrPage;
use Filament\Facades\Filament;
use Filament\Pages\SimplePage;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Pantalla de login del panel `phr` (Spec 0001 §6.1 y §10; ADR 0001 y 0002).
 *
 * Sustituye a `Filament\Auth\Pages\Login` a través de `->login(self::class)`. Hereda de
 * `SimplePage` **solo por el envoltorio visual**: el formulario no es un schema de Filament y no
 * lleva `wire:model` en ningún sitio.
 *
 * La contraseña vive en un `<input type="password">` de HTML plano gobernado por Alpine. Alpine
 * intercepta el `submit`, lee el valor del nodo del DOM, lo vacía y lo pasa al cliente OPAQUE, que
 * habla por `fetch` con `/phr/auth/opaque/login/{start,finish}`. Así la contraseña nunca entra en
 * el estado de un componente Livewire, no viaja en un `snapshot` ni queda en la instantánea de DOM
 * que Livewire retiene (ADR 0002, ADR 0003).
 *
 * Consecuencia de ese diseño: esta clase **no tiene `authenticate()`**. La sesión la crea
 * `LoginFinishController` y la navegación al panel la hace el propio JavaScript con el `redirect`
 * que devuelve ese endpoint, así que no hay que tocar el `LoginResponse` de Filament.
 *
 * Las seis propiedades `#[Url]` se redeclaran por el motivo de {@see PhrPage},
 * que esta clase no puede heredar por venir de `SimplePage`.
 */
final class Login extends SimplePage
{
    protected string $view = 'phr.auth.login';

    /** @var mixed */
    public $defaultAction = null;

    /** @var mixed */
    public $defaultActionArguments = null;

    /** @var mixed */
    public $defaultActionContext = null;

    /** @var mixed */
    public $defaultTableAction = null;

    /** @var mixed */
    public $defaultTableActionRecord = null;

    /** @var mixed */
    public $defaultTableActionArguments = null;

    /**
     * Quien ya tiene sesión no vuelve a ver el formulario.
     *
     * `intended()` conserva el destino que `redirect()->guest()` dejó guardado, igual que hace
     * `login/finish` con `url.intended` (§4.4).
     */
    public function mount(): void
    {
        if (Filament::auth()->check()) {
            redirect()->intended(Filament::getUrl());
        }
    }

    public function getTitle(): string|Htmlable
    {
        return __('Entrar');
    }

    public function getHeading(): string|Htmlable
    {
        return __('Entrar');
    }
}
