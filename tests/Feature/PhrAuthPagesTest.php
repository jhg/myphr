<?php

declare(strict_types=1);

use App\Filament\Auth\Login;
use App\Models\User;
use App\Provisioning\RegistrationLinks;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * Las dos pantallas propias de autenticación (Spec 0001 §5, §6.1, §7 y §10; ADR 0001 y 0002).
 */
it('serves the login page to a visitor without a session', function (): void {
    $this->get(route('filament.phr.auth.login'))
        ->assertOk()
        ->assertSee('data-phr-form="login"', escape: false)
        ->assertSee('x-data="phrLoginForm"', escape: false);
});

it('registers our own login page as the panel login route', function (): void {
    expect(filament()->getPanel('phr')->getLoginRouteAction())->toBe(Login::class);
});

/**
 * El guardarraíl de ADR 0002: la contraseña no puede estar ligada al estado de Livewire. Con un
 * `wire:model` viajaría en cada `snapshot` y quedaría en la instantánea de DOM que el componente
 * retiene, que es justo lo que este diseño evita.
 */
it('never binds the password field to Livewire state', function (string $routeName): void {
    $html = $this->get(route($routeName))->assertOk()->getContent();

    expect($html)->not->toContain('wire:model');

    $fields = [];
    preg_match_all('/<input\b[^>]*type="password"[^>]*>/i', (string) $html, $fields);

    expect($fields[0])->not->toBeEmpty();

    foreach ($fields[0] as $field) {
        expect($field)->not->toContain('wire:model')
            ->and($field)->not->toContain('wire:model.live')
            ->and($field)->toContain('x-ref=');
    }
})->with([
    'login' => 'filament.phr.auth.login',
    'set-password' => 'filament.phr.auth.set-password',
]);

it('serves the set-password page without authentication and without a token in the path', function (): void {
    $response = $this->get(route('filament.phr.auth.set-password'))->assertOk();

    expect($response->headers->get('Cache-Control'))->toContain('no-store')
        ->and($response->headers->get('Referrer-Policy'))->toBe('no-referrer');

    /** El token viaja en el fragmento (§4.1): la ruta no puede tener parámetros. */
    expect(RegistrationLinks::SET_PASSWORD_PATH)->not->toContain('{');
});

it('sends an authenticated visitor away from the login page', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user)
        ->get(route('filament.phr.auth.login'))
        ->assertRedirect();
});
