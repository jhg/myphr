<?php

declare(strict_types=1);

use App\Models\User;
use App\Security\Opaque\OpaqueProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

/** Spec 0001 §3.1 */
it('has the new users columns', function (): void {
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

/** With OPAQUE the password never reaches the server: there is no column to store it in. */
it('has no password column', function (): void {
    expect(Schema::hasColumn('users', 'password'))->toBeFalse();
});

/** Spec 0001 §3.1: signup does not mark the email as verified. */
it('creates a user with no verified email', function (): void {
    $user = User::factory()->create();

    expect($user->email_verified_at)->toBeNull()
        ->and($user->opaque_registered_at)->toBeNull();
});

/** With no `password` column, the `Authenticatable` contract is met with an empty string. */
it('returns an empty authentication password', function (): void {
    $user = User::factory()->create();

    expect($user->getAuthPassword())->toBe('');
});

/** Spec 0001 §3: the primary key is a UUIDv7 in canonical lowercase text form. */
it('generates a UUIDv7 as the primary key', function (): void {
    $user = User::factory()->create();

    expect($user->getKeyType())->toBe('string')
        ->and($user->getIncrementing())->toBeFalse()
        ->and(Str::isUuid($user->id))->toBeTrue()
        ->and($user->id)->toBe(strtolower($user->id))
        ->and($user->id[14])->toBe('7');
});

/** Spec 0001 §3.1: the exact lengths are validated in the application, but the schema stores raw bytes. */
it('stores the OPAQUE binaries without altering them', function (): void {
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

/** ADR 0009: entering the panel requires only a completed OPAQUE registration. */
it('denies the panel to an account without an OPAQUE registration', function (): void {
    $panel = Filament\Facades\Filament::getPanel('phr');

    expect(User::factory()->create()->canAccessPanel($panel))->toBeFalse();
});

it('allows the panel to an account with a complete OPAQUE registration', function (): void {
    $panel = Filament\Facades\Filament::getPanel('phr');
    $user = User::factory()->registered()->create();

    expect($user->canAccessPanel($panel))->toBeTrue()
        ->and($user->opaque_profile)->toBe(OpaqueProfile::NAME);
});
