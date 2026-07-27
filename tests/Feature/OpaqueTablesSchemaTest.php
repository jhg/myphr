<?php

declare(strict_types=1);

use App\Models\OpaqueLoginHandshake;
use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Models\UserRegistrationLink;
use App\Security\Opaque\OpaqueProfile;
use Carbon\CarbonInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

/** Spec 0001 §3.2 y §3.3 */
it('has the columns of every table', function (string $table, array $columns): void {
    expect(Schema::hasColumns($table, $columns))->toBeTrue()
        ->and(Schema::hasColumn($table, 'updated_at'))->toBeFalse();
})->with([
    ['user_registration_links', ['id', 'user_id', 'token_hash', 'expires_at', 'consumed_at', 'created_by', 'created_at']],
    ['opaque_registrations', ['id', 'user_id', 'invitation_ref', 'credential_identifier', 'profile', 'expires_at', 'created_at']],
    ['opaque_login_handshakes', ['id', 'user_id', 'state_ciphertext', 'expires_at', 'created_at']],
]);

/** Spec 0001 §3.3: only the 32-byte hash of the token is persisted. */
it('stores the registration link with the token hash', function (): void {
    $issuer = User::factory()->registered()->create();
    $user = User::factory()->create();
    $token = Str::random(43);
    $tokenHash = hash('sha256', $token, binary: true);

    $link = UserRegistrationLink::create([
        'user_id' => $user->id,
        'token_hash' => $tokenHash,
        'expires_at' => now()->addHours(24),
        'created_by' => $issuer->id,
    ]);

    $fresh = $link->fresh();

    expect(Str::isUuid($link->id))->toBeTrue()
        ->and($link->id[14])->toBe('7')
        ->and(strlen((string) $fresh->token_hash))->toBe(32)
        ->and($fresh->token_hash)->toBe($tokenHash)
        ->and($fresh->consumed_at)->toBeNull()
        ->and($fresh->expires_at)->toBeInstanceOf(CarbonInterface::class)
        ->and($fresh->user->is($user))->toBeTrue()
        ->and($fresh->creator->is($issuer))->toBeTrue()
        ->and($link->toArray())->not->toHaveKey('token_hash');
});

/** Spec 0001 §3.2 / OPAQUE.md §14.2 */
it('stores a pending OPAQUE registration tied to its link', function (): void {
    $user = User::factory()->create();
    $link = UserRegistrationLink::create([
        'user_id' => $user->id,
        'token_hash' => random_bytes(32),
        'expires_at' => now()->addHours(24),
    ]);

    $credentialIdentifier = random_bytes(32);

    $pending = OpaqueRegistration::create([
        'user_id' => $user->id,
        'invitation_ref' => $link->id,
        'credential_identifier' => $credentialIdentifier,
        'profile' => OpaqueProfile::NAME,
        'expires_at' => now()->addHours(24),
    ]);

    $fresh = $pending->fresh();

    expect(Str::isUuid($pending->id))->toBeTrue()
        ->and($pending->id[14])->toBe('7')
        ->and(strlen((string) $fresh->credential_identifier))->toBe(32)
        ->and($fresh->credential_identifier)->toBe($credentialIdentifier)
        ->and($fresh->profile)->toBe(OpaqueProfile::NAME)
        ->and($fresh->registrationLink->is($link))->toBeTrue();
});

/** Spec 0001 §3.2 / OPAQUE.md §14.3: `user_id` is null on the fake branch. */
it('stores a handshake with no user for the fake branch', function (): void {
    $handshake = OpaqueLoginHandshake::create([
        'user_id' => null,
        'state_ciphertext' => 'cifrado',
        'expires_at' => now()->addSeconds(180),
    ]);

    expect(Str::isUuid($handshake->id))->toBeTrue()
        ->and($handshake->id[14])->toBe('7')
        ->and($handshake->fresh()->user_id)->toBeNull()
        ->and($handshake->toArray())->not->toHaveKey('state_ciphertext');
});
