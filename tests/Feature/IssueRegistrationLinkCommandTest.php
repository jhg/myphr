<?php

declare(strict_types=1);

use App\Models\User;
use App\Models\UserRegistrationLink;
use App\Support\Terminal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\FakeTerminal;

uses(RefreshDatabase::class);

/**
 * `php artisan phr:issue-registration-link` (Spec 0001 §10, ADR 0009).
 */
beforeEach(function (): void {
    app()->instance(Terminal::class, new FakeTerminal);
});

it('crea la cuenta con el email normalizado y emite un enlace', function (): void {
    $this->artisan('phr:issue-registration-link', ['email' => '  ÁLVARO@Example.COM ', '--name' => 'Álvaro'])
        ->assertSuccessful();

    $user = User::query()->sole();

    expect($user->email)->toBe('álvaro@example.com')
        ->and($user->name)->toBe('Álvaro')
        ->and($user->password)->toBeNull()
        ->and($user->opaque_registered_at)->toBeNull()
        ->and($user->registrationLinks()->count())->toBe(1);
});

it('reutiliza la cuenta existente en vez de duplicarla', function (): void {
    $user = User::factory()->create(['email' => 'alice@example.com']);

    $this->artisan('phr:issue-registration-link', ['email' => 'ALICE@example.com'])->assertSuccessful();

    expect(User::query()->count())->toBe(1)
        ->and($user->registrationLinks()->count())->toBe(1);
});

it('usa el email como nombre cuando no se pasa --name', function (): void {
    $this->artisan('phr:issue-registration-link', ['email' => 'alice@example.com'])->assertSuccessful();

    expect(User::query()->sole()->name)->toBe('alice@example.com');
});

/** ADR 0009: la URL solo se imprime; si la salida no es un terminal, no se emite nada. */
it('aborta si la salida no es un terminal interactivo', function (): void {
    app()->instance(Terminal::class, new FakeTerminal(interactive: false));

    $this->artisan('phr:issue-registration-link', ['email' => 'alice@example.com'])->assertFailed();

    expect(User::query()->count())->toBe(0)
        ->and(UserRegistrationLink::query()->count())->toBe(0);
});

it('rechaza un email inválido sin crear nada', function (): void {
    $this->artisan('phr:issue-registration-link', ['email' => 'no-es-un-email'])->assertFailed();

    expect(User::query()->count())->toBe(0);
});

/** Spec 0001 §3.4: la reemisión sobre una cuenta con acceso exige teclear su email. */
it('emite la reemisión solo si se teclea el email de la cuenta', function (): void {
    $user = User::factory()->registered()->create(['email' => 'alice@example.com']);

    $this->artisan('phr:issue-registration-link', ['email' => 'alice@example.com'])
        ->expectsQuestion('Teclea el email de la cuenta para confirmar la reemisión', 'bob@example.com')
        ->assertFailed();

    expect($user->registrationLinks()->count())->toBe(0);

    $this->artisan('phr:issue-registration-link', ['email' => 'alice@example.com'])
        ->expectsQuestion('Teclea el email de la cuenta para confirmar la reemisión', 'alice@example.com')
        ->assertSuccessful();

    expect($user->registrationLinks()->count())->toBe(1);
});

/** `--no-interaction` no puede saltarse la confirmación (Spec 0001 §3.4). */
it('no reemite con --no-interaction sobre una cuenta registrada', function (): void {
    $user = User::factory()->registered()->create(['email' => 'alice@example.com']);

    $this->artisan('phr:issue-registration-link', ['email' => 'alice@example.com', '--no-interaction' => true])
        ->assertFailed();

    expect($user->registrationLinks()->count())->toBe(0);
});

it('imprime la URL con el token en el fragmento', function (): void {
    $this->artisan('phr:issue-registration-link', ['email' => 'alice@example.com'])
        ->expectsOutputToContain(url('phr/set-password').'#')
        ->assertSuccessful();

    expect(UserRegistrationLink::query()->count())->toBe(1);
});
