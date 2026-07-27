<?php

declare(strict_types=1);

namespace App\Filament\Auth;

use App\Filament\Pages\PhrPage;
use Filament\Facades\Filament;
use Filament\Pages\SimplePage;
use Illuminate\Contracts\Support\Htmlable;

/**
 * Login screen of the `phr` panel (Spec 0001 §6.1 and §10; ADR 0001 and 0002).
 *
 * It replaces `Filament\Auth\Pages\Login` through `->login(self::class)`. It extends `SimplePage`
 * **only for the visual wrapper**: the form is not a Filament schema and carries no `wire:model`
 * anywhere.
 *
 * The password lives in a plain HTML `<input type="password">` driven by Alpine. Alpine intercepts
 * the `submit`, reads the value from the DOM node, clears it and hands it to the OPAQUE client,
 * which talks to `/phr/auth/opaque/login/{start,finish}` over `fetch`. That way the password never
 * enters the state of a Livewire component, does not travel in a `snapshot` and does not stay in the
 * DOM snapshot Livewire keeps (ADR 0002, ADR 0003).
 *
 * A consequence of that design: this class **has no `authenticate()`**. The session is created by
 * `LoginFinishController` and the navigation to the panel is done by the JavaScript itself with the
 * `redirect` that endpoint returns, so there is no need to touch Filament's `LoginResponse`.
 *
 * The six `#[Url]` properties are redeclared for the reason given in {@see PhrPage}, which this
 * class cannot inherit because it comes from `SimplePage`.
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
     * Anyone who already has a session does not see the form again.
     *
     * `intended()` keeps the destination `redirect()->guest()` stored, the same as `login/finish`
     * does with `url.intended` (§4.4).
     */
    public function mount(): void
    {
        if (Filament::auth()->check()) {
            redirect()->intended(Filament::getUrl());
        }
    }

    public function getTitle(): string|Htmlable
    {
        return __('Sign in');
    }

    public function getHeading(): string|Htmlable
    {
        return __('Sign in');
    }
}
