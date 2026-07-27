<?php

declare(strict_types=1);

use App\Filament\Resources\Users\Pages\ManageUsers;
use App\Filament\Resources\Users\UserResource;
use App\Models\User;
use Filament\Facades\Filament;
use Filament\Schemas\Schema;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * User management from the panel (Spec 0001 §10; ADR 0009).
 *
 * The resource is **disabled**: it does not appear in the navigation and does not answer by URL.
 * This file went from checking that the screen worked to checking that you cannot reach it, which is
 * what has to be held up now.
 *
 * The business rules that used to be exercised through this interface have not been lost. The
 * confirmation guard when reissuing a link lives in `RegistrationLinks` and not in the interface,
 * precisely so there are not two copies (Spec 0001 §3.4), and `RegistrationLinksTest` covers it;
 * command-line signup is covered by `IssueRegistrationLinkCommandTest`.
 */
beforeEach(function (): void {
    Filament::setCurrentPanel('phr');
});

it('does not let even a registered account reach the resource', function (): void {
    expect(UserResource::canAccess())->toBeFalse();

    $this->actingAs(User::factory()->registered()->create())
        ->get(UserResource::getUrl('index'))
        ->assertForbidden();
});

it('keeps an account without an OPAQUE registration out of the panel', function (): void {
    $this->actingAs(User::factory()->create())
        ->get(UserResource::getUrl('index'))
        ->assertForbidden();
});

it('does not hang it off the navigation', function (): void {
    $this->actingAs(User::factory()->registered()->create());

    expect(UserResource::shouldRegisterNavigation())->toBeFalse();
});

/**
 * The policy is the real gate and `canAccess()` is the second turn of the key: if somebody reopened
 * only one of the two, this check would still fail until reopening both is decided.
 */
it('denies every user management permission', function (): void {
    $registered = User::factory()->registered()->create();
    $other = User::factory()->registered()->create();

    expect(Gate::forUser($registered)->allows('viewAny', User::class))->toBeFalse()
        ->and(Gate::forUser($registered)->allows('view', $other))->toBeFalse()
        ->and(Gate::forUser($registered)->allows('create', User::class))->toBeFalse()
        ->and(Gate::forUser($registered)->allows('issueRegistrationLink', $other))->toBeFalse();
});

/** ADR 0009: the login is fixed and there is no editing or deleting of accounts. */
it('does not allow editing or deleting accounts', function (): void {
    $admin = User::factory()->registered()->create();
    $other = User::factory()->registered()->create();

    expect(Gate::forUser($admin)->allows('update', $other))->toBeFalse()
        ->and(Gate::forUser($admin)->allows('delete', $other))->toBeFalse();
});

/**
 * ADR 0009: signup asks for a name and a login, never a password.
 *
 * It is checked against the resource schema, without reaching the screen, which is no longer
 * accessible. It is still worth it: if the resource is ever reopened, a password field had better
 * not have slipped in while it was switched off.
 */
it('offers no password field at signup', function (): void {
    $admin = User::factory()->registered()->create();
    $this->actingAs($admin);

    $livewire = Livewire::test(ManageUsers::class)->instance();

    $names = array_map(
        fn ($component): ?string => $component->getName(),
        UserResource::form(Schema::make($livewire))->getComponents(),
    );

    expect($names)->toBe(['name', 'email'])
        ->and(implode(' ', $names))->not->toContain('password');
});
