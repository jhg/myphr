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

it('creates the account with the normalized email and issues a link', function (): void {
    $this->artisan('phr:issue-registration-link', ['email' => '  ÁLVARO@Example.COM ', '--name' => 'Álvaro'])
        ->assertSuccessful();

    $user = User::query()->sole();

    expect($user->email)->toBe('álvaro@example.com')
        ->and($user->name)->toBe('Álvaro')
        ->and($user->opaque_registered_at)->toBeNull()
        ->and($user->registrationLinks()->count())->toBe(1);
});

it('reuses the existing account instead of duplicating it', function (): void {
    $user = User::factory()->create(['email' => 'alice@example.com']);

    $this->artisan('phr:issue-registration-link', ['email' => 'ALICE@example.com'])->assertSuccessful();

    expect(User::query()->count())->toBe(1)
        ->and($user->registrationLinks()->count())->toBe(1);
});

it('uses the email as the name when --name is not passed', function (): void {
    $this->artisan('phr:issue-registration-link', ['email' => 'alice@example.com'])->assertSuccessful();

    expect(User::query()->sole()->name)->toBe('alice@example.com');
});

/** ADR 0009: the URL is only printed; if the output is not a terminal, nothing is issued. */
it('aborts if the output is not an interactive terminal', function (): void {
    app()->instance(Terminal::class, new FakeTerminal(interactive: false));

    $this->artisan('phr:issue-registration-link', ['email' => 'alice@example.com'])->assertFailed();

    expect(User::query()->count())->toBe(0)
        ->and(UserRegistrationLink::query()->count())->toBe(0);
});

it('rejects an invalid email without creating anything', function (): void {
    $this->artisan('phr:issue-registration-link', ['email' => 'no-es-un-email'])->assertFailed();

    expect(User::query()->count())->toBe(0);
});

/** Spec 0001 §3.4: reissuing on an account with access requires typing its email. */
it('only reissues if the account email is typed', function (): void {
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

/** `--no-interaction` cannot skip the confirmation (Spec 0001 §3.4). */
it('does not reissue with --no-interaction on a registered account', function (): void {
    $user = User::factory()->registered()->create(['email' => 'alice@example.com']);

    $this->artisan('phr:issue-registration-link', ['email' => 'alice@example.com', '--no-interaction' => true])
        ->assertFailed();

    expect($user->registrationLinks()->count())->toBe(0);
});

it('prints the URL with the token in the fragment', function (): void {
    $this->artisan('phr:issue-registration-link', ['email' => 'alice@example.com'])
        ->expectsOutputToContain(url('phr/set-password').'#')
        ->assertSuccessful();

    expect(UserRegistrationLink::query()->count())->toBe(1);
});
