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
 * Gestión de usuarios desde el panel (Spec 0001 §10; ADR 0009).
 *
 * El recurso está **desactivado**: no aparece en la navegación y no responde por URL. Este fichero
 * pasó de comprobar que la pantalla funcionaba a comprobar que no se puede llegar a ella, que es lo
 * que hay que sostener ahora.
 *
 * Las reglas de negocio que antes se ejercitaban a través de esta interfaz no se han perdido. La
 * guardia de confirmación al reemitir un enlace vive en `RegistrationLinks` y no en la interfaz,
 * precisamente para que no existan dos copias (Spec 0001 §3.4), y la cubre `RegistrationLinksTest`;
 * el alta por línea de comandos la cubre `IssueRegistrationLinkCommandTest`.
 */
beforeEach(function (): void {
    Filament::setCurrentPanel('phr');
});

it('no deja acceder al recurso ni siquiera a una cuenta registrada', function (): void {
    expect(UserResource::canAccess())->toBeFalse();

    $this->actingAs(User::factory()->registered()->create())
        ->get(UserResource::getUrl('index'))
        ->assertForbidden();
});

it('deja fuera del panel a una cuenta sin registro OPAQUE', function (): void {
    $this->actingAs(User::factory()->create())
        ->get(UserResource::getUrl('index'))
        ->assertForbidden();
});

it('no lo cuelga de la navegación', function (): void {
    $this->actingAs(User::factory()->registered()->create());

    expect(UserResource::shouldRegisterNavigation())->toBeFalse();
});

/**
 * La política es la puerta de verdad y `canAccess()` la segunda vuelta de llave: si alguien reabriera
 * solo una de las dos, esta comprobación seguiría fallando hasta que se decida reabrir ambas.
 */
it('deniega todos los permisos de gestión de usuarios', function (): void {
    $registered = User::factory()->registered()->create();
    $other = User::factory()->registered()->create();

    expect(Gate::forUser($registered)->allows('viewAny', User::class))->toBeFalse()
        ->and(Gate::forUser($registered)->allows('view', $other))->toBeFalse()
        ->and(Gate::forUser($registered)->allows('create', User::class))->toBeFalse()
        ->and(Gate::forUser($registered)->allows('issueRegistrationLink', $other))->toBeFalse();
});

/** ADR 0009: el login queda fijo y no hay edición ni borrado de cuentas. */
it('no permite editar ni borrar cuentas', function (): void {
    $admin = User::factory()->registered()->create();
    $other = User::factory()->registered()->create();

    expect(Gate::forUser($admin)->allows('update', $other))->toBeFalse()
        ->and(Gate::forUser($admin)->allows('delete', $other))->toBeFalse();
});

/**
 * ADR 0009: el alta pide nombre y login, nunca una contraseña.
 *
 * Se comprueba sobre el esquema del recurso, sin llegar a la pantalla, que ya no es accesible. Sigue
 * mereciendo la pena: si el recurso se reabre algún día, conviene que un campo de contraseña no se
 * haya colado mientras estaba apagado.
 */
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
