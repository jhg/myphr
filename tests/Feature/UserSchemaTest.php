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

/** Con OPAQUE la contraseña nunca llega al servidor: no hay columna donde guardarla. */
it('no tiene columna password', function (): void {
    expect(Schema::hasColumn('users', 'password'))->toBeFalse();
});

/** Spec 0001 §3.1: el alta no marca el correo como verificado. */
it('crea un usuario sin email verificado', function (): void {
    $user = User::factory()->create();

    expect($user->email_verified_at)->toBeNull()
        ->and($user->opaque_registered_at)->toBeNull();
});

/** Sin columna `password`, el contrato de `Authenticatable` se cumple con una cadena vacía. */
it('devuelve una contraseña de autenticación vacía', function (): void {
    $user = User::factory()->create();

    expect($user->getAuthPassword())->toBe('');
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
