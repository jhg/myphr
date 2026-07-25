<?php

declare(strict_types=1);

use App\Models\User;
use App\Security\Opaque\OpaqueProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

/** Spec 0001 §3.1 */
it('tiene las columnas nuevas de users', function (): void {
    expect(Schema::hasColumns('users', [
        'id',
        'name',
        'email',
        'password',
        'opaque_credential_identifier',
        'opaque_registration_record',
        'opaque_profile',
        'opaque_registered_at',
        'encrypted_settings',
    ]))->toBeTrue();

    expect(Schema::getColumnType('users', 'opaque_credential_identifier'))->toBe('blob');
    expect(Schema::getColumnType('users', 'opaque_registration_record'))->toBe('blob');
    expect(Schema::getColumnType('users', 'encrypted_settings'))->toBe('text');
});

/** Spec 0001 §3.1: `password` es nullable y el alta no marca el correo como verificado. */
it('crea un usuario sin contraseña y sin email verificado', function (): void {
    $user = User::factory()->create();

    expect($user->password)->toBeNull()
        ->and($user->email_verified_at)->toBeNull()
        ->and($user->opaque_registered_at)->toBeNull();
});

/** Spec 0001 §3.1: `password` fuera de la asignación masiva y sin cast `hashed`. */
it('no admite password en asignación masiva', function (): void {
    $user = User::factory()->create();

    $user->fill(['password' => 'secreto']);

    expect($user->password)->toBeNull();
});

/** Spec 0001 §3.1: la columna `password` no autentica a nadie. */
it('devuelve una contraseña de autenticación vacía', function (): void {
    $user = User::factory()->create();
    $user->forceFill(['password' => bcrypt('secreto')])->save();

    expect($user->fresh()->getAuthPassword())->toBe('');
});

/** Spec 0001 §3: la clave primaria es un UUIDv7 en forma textual canónica en minúsculas. */
it('genera un UUIDv7 como clave primaria', function (): void {
    $user = User::factory()->create();

    expect($user->getKeyType())->toBe('string')
        ->and($user->getIncrementing())->toBeFalse()
        ->and(Str::isUuid($user->id))->toBeTrue()
        ->and($user->id)->toBe(strtolower($user->id))
        ->and($user->id[14])->toBe('7');
});

/** Spec 0001 §3.1: las longitudes exactas se validan en aplicación, pero el esquema guarda bytes crudos. */
it('guarda los binarios de OPAQUE sin alterarlos', function (): void {
    $credentialIdentifier = random_bytes(32);
    $registrationRecord = random_bytes(192);

    $user = User::factory()->create();
    $user->forceFill([
        'opaque_credential_identifier' => $credentialIdentifier,
        'opaque_registration_record' => $registrationRecord,
    ])->save();

    $fresh = $user->fresh();

    expect(strlen((string) $fresh->opaque_credential_identifier))->toBe(32)
        ->and($fresh->opaque_credential_identifier)->toBe($credentialIdentifier)
        ->and(strlen((string) $fresh->opaque_registration_record))->toBe(192)
        ->and($fresh->opaque_registration_record)->toBe($registrationRecord);
});

/** ADR 0009: entrar al panel exige únicamente tener el registro OPAQUE completo. */
it('deniega el panel a una cuenta sin registro OPAQUE', function (): void {
    $panel = Filament\Facades\Filament::getPanel('phr');

    expect(User::factory()->create()->canAccessPanel($panel))->toBeFalse();
});

it('permite el panel a una cuenta con el registro OPAQUE completo', function (): void {
    $panel = Filament\Facades\Filament::getPanel('phr');
    $user = User::factory()->registered()->create();

    expect($user->canAccessPanel($panel))->toBeTrue()
        ->and($user->opaque_profile)->toBe(OpaqueProfile::NAME);
});
