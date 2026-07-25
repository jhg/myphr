<?php

declare(strict_types=1);

use App\Filament\Resources\Users\Pages\ManageUsers;
use App\Filament\Resources\Users\UserResource;
use App\Models\User;
use App\Models\UserRegistrationLink;
use Filament\Actions\Testing\TestAction;
use Filament\Facades\Filament;
use Filament\Schemas\Schema;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Gestión de usuarios desde el panel (Spec 0001 §10; ADR 0009).
 */
beforeEach(function (): void {
    Filament::setCurrentPanel('phr');
});

/** ADR 0009: el alta pide nombre y login, nunca una contraseña. */
it('no ofrece ningún campo de contraseña en el alta', function (): void {
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

/** ADR 0009: el alta crea la cuenta y emite el enlace, que se muestra una sola vez. */
it('crea la cuenta, emite el enlace y lo muestra en un segundo paso', function (): void {
    $admin = User::factory()->registered()->create();
    $this->actingAs($admin);

    $component = Livewire::test(ManageUsers::class)
        ->callAction('create', [
            'name' => 'Ada Lovelace',
            'email' => 'Ada@Example.COM',
        ])
        ->assertHasNoActionErrors();

    $created = User::query()->where('email', 'ada@example.com')->sole();

    expect($created->name)->toBe('Ada Lovelace')
        ->and($created->opaque_registered_at)->toBeNull()
        ->and($created->password)->toBeNull();

    $link = UserRegistrationLink::query()->where('user_id', $created->id)->sole();

    expect($link->created_by)->toBe($admin->id)
        ->and($link->consumed_at)->toBeNull();

    $mounted = $component->get('mountedActions');

    expect($mounted[0]['name'])->toBe('showRegistrationLink');

    $url = $mounted[0]['arguments']['url'];

    expect($url)->toContain('#');

    /** Spec 0001 §3.3: en base de datos solo vive el hash del token. */
    expect($link->token_hash)->toBe(hash('sha256', Str::after($url, '#'), true));
});

/** ADR 0009: el segundo paso enseña la URL, y es la única vez que se puede ver. */
it('muestra la url en el modal del segundo paso', function (): void {
    $this->actingAs(User::factory()->registered()->create());

    $component = Livewire::test(ManageUsers::class)
        ->mountAction('showRegistrationLink', [
            'url' => 'https://phr.test/phr/set-password#un-token',
            'login' => 'ada@example.com',
        ])
        ->assertActionMounted('showRegistrationLink');

    $schema = $component->instance()->getSchema('mountedActionSchema0');

    expect($schema)->not->toBeNull()
        ->and($schema->getComponents()[0]->getState())
        ->toBe('https://phr.test/phr/set-password#un-token');
});

/** El login normalizado identifica la cuenta: no puede haber dos iguales. */
it('rechaza un login que ya existe, aunque cambie la caja', function (): void {
    $admin = User::factory()->registered()->create();
    User::factory()->create(['email' => 'ada@example.com']);
    $this->actingAs($admin);

    Livewire::test(ManageUsers::class)
        ->callAction('create', [
            'name' => 'Ada Lovelace',
            'email' => 'ADA@EXAMPLE.COM',
        ])
        ->assertHasActionErrors(['email']);

    expect(UserRegistrationLink::query()->count())->toBe(0);
});

/** Spec 0001 §3.4: reemitir sobre una cuenta con acceso exige teclear su login. */
it('rechaza la reemisión sin la confirmación explícita', function (): void {
    $admin = User::factory()->registered()->create();
    $target = User::factory()->registered()->create();
    $this->actingAs($admin);

    Livewire::test(ManageUsers::class)
        ->callAction(TestAction::make('issueRegistrationLink')->table($target), [
            'confirmation' => 'otra@cosa.test',
        ])
        ->assertNotified();

    expect(UserRegistrationLink::query()->where('user_id', $target->id)->count())->toBe(0);
});

it('reemite el enlace cuando se teclea el login de la cuenta', function (): void {
    $admin = User::factory()->registered()->create();
    $target = User::factory()->registered()->create();
    $this->actingAs($admin);

    $component = Livewire::test(ManageUsers::class)
        ->callAction(TestAction::make('issueRegistrationLink')->table($target), [
            'confirmation' => Str::upper((string) $target->email),
        ]);

    expect(UserRegistrationLink::query()->where('user_id', $target->id)->count())->toBe(1);

    $mounted = $component->get('mountedActions');

    expect($mounted[0]['name'])->toBe('showRegistrationLink')
        ->and($mounted[0]['arguments']['url'])->toContain('#');
});

/** Una cuenta sin acceso no necesita confirmación: la guardia vive en el servicio. */
it('reemite sin confirmación cuando la cuenta todavía no tiene acceso', function (): void {
    $admin = User::factory()->registered()->create();
    $target = User::factory()->create();
    $this->actingAs($admin);

    Livewire::test(ManageUsers::class)
        ->callAction(TestAction::make('issueRegistrationLink')->table($target), [
            'confirmation' => null,
        ]);

    expect(UserRegistrationLink::query()->where('user_id', $target->id)->count())->toBe(1);
});

/** ADR 0009: gestionar usuarios exige tener el registro OPAQUE completo. */
it('deniega la gestión de usuarios a una cuenta sin registro OPAQUE', function (): void {
    $unregistered = User::factory()->create();

    expect(Gate::forUser($unregistered)->allows('viewAny', User::class))->toBeFalse()
        ->and(Gate::forUser($unregistered)->allows('create', User::class))->toBeFalse()
        ->and(Gate::forUser($unregistered)->allows('issueRegistrationLink', $unregistered))->toBeFalse();

    $registered = User::factory()->registered()->create();

    expect(Gate::forUser($registered)->allows('viewAny', User::class))->toBeTrue()
        ->and(Gate::forUser($registered)->allows('create', User::class))->toBeTrue();
});

/** ADR 0009: el login queda fijo y no hay edición ni borrado de cuentas. */
it('no permite editar ni borrar cuentas', function (): void {
    $admin = User::factory()->registered()->create();
    $other = User::factory()->registered()->create();

    expect(Gate::forUser($admin)->allows('update', $other))->toBeFalse()
        ->and(Gate::forUser($admin)->allows('delete', $other))->toBeFalse();
});

/** ADR 0009: sin registro OPAQUE completo no se entra al panel. */
it('deja fuera del panel a una cuenta sin registro OPAQUE', function (): void {
    $this->actingAs(User::factory()->create())
        ->get(UserResource::getUrl('index'))
        ->assertForbidden();
});

it('deja entrar al listado de usuarios a una cuenta registrada', function (): void {
    $this->actingAs(User::factory()->registered()->create())
        ->get(UserResource::getUrl('index'))
        ->assertSuccessful();
});
