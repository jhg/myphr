<?php

declare(strict_types=1);

use App\Filament\Auth\Login;
use App\Models\User;
use App\Provisioning\RegistrationLinks;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * The two authentication screens of our own (Spec 0001 §5, §6.1, §7 and §10; ADR 0001 and 0002).
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
 * The ADR 0002 guardrail: the password cannot be bound to Livewire state. With a `wire:model` it
 * would travel in every `snapshot` and stay in the DOM snapshot the component keeps, which is
 * exactly what this design avoids.
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

    /** The token travels in the fragment (§4.1): the route cannot have parameters. */
    expect(RegistrationLinks::SET_PASSWORD_PATH)->not->toContain('{');
});

it('sends an authenticated visitor away from the login page', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user)
        ->get(route('filament.phr.auth.login'))
        ->assertRedirect();
});
