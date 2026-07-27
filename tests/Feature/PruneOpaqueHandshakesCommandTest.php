<?php

declare(strict_types=1);

use App\Models\OpaqueLoginHandshake;
use App\Models\OpaqueRegistration;
use App\Models\User;
use App\Models\UserRegistrationLink;
use App\Security\Opaque\OpaqueProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;

uses(RefreshDatabase::class);

/**
 * `php artisan opaque:prune-handshakes` (Spec 0001 §3.2, §9, §11).
 */
it('prunes expired login handshakes and keeps the current ones', function (): void {
    $expired = OpaqueLoginHandshake::create([
        'user_id' => null,
        'state_ciphertext' => 'cifrado',
        'expires_at' => Carbon::now()->subMinute(),
    ])->fresh();

    $valid = OpaqueLoginHandshake::create([
        'user_id' => null,
        'state_ciphertext' => 'cifrado',
        'expires_at' => Carbon::now()->addMinute(),
    ])->fresh();

    $this->artisan('opaque:prune-handshakes')->assertSuccessful();

    expect(OpaqueLoginHandshake::query()->find($expired->id))->toBeNull()
        ->and(OpaqueLoginHandshake::query()->find($valid->id))->not->toBeNull();
});

it('prunes expired pending OPAQUE registrations and keeps the current ones', function (): void {
    $user = User::factory()->create();
    $link = UserRegistrationLink::create([
        'user_id' => $user->id,
        'token_hash' => random_bytes(32),
        'expires_at' => Carbon::now()->addHours(24),
    ]);

    $expired = OpaqueRegistration::create([
        'user_id' => $user->id,
        'invitation_ref' => $link->id,
        'credential_identifier' => random_bytes(32),
        'profile' => OpaqueProfile::NAME,
        'expires_at' => Carbon::now()->subMinute(),
    ])->fresh();

    $valid = OpaqueRegistration::create([
        'user_id' => $user->id,
        'invitation_ref' => $link->id,
        'credential_identifier' => random_bytes(32),
        'profile' => OpaqueProfile::NAME,
        'expires_at' => Carbon::now()->addMinute(),
    ])->fresh();

    $this->artisan('opaque:prune-handshakes')->assertSuccessful();

    expect(OpaqueRegistration::query()->find($expired->id))->toBeNull()
        ->and(OpaqueRegistration::query()->find($valid->id))->not->toBeNull();
});

it('prunes consumed or expired registration links that are old enough, and keeps the rest', function (): void {
    $user = User::factory()->create();
    $now = Carbon::now();

    // Consumed more than 30 days ago: pruned.
    $oldConsumed = UserRegistrationLink::create([
        'user_id' => $user->id,
        'token_hash' => random_bytes(32),
        'expires_at' => $now->clone()->subDays(40),
        'consumed_at' => $now->clone()->subDays(31),
    ])->fresh();

    // Expired more than 30 days ago, never consumed: pruned.
    $oldExpiredUnconsumed = UserRegistrationLink::create([
        'user_id' => $user->id,
        'token_hash' => random_bytes(32),
        'expires_at' => $now->clone()->subDays(31),
    ])->fresh();

    // Consumed recently (less than 30 days ago): kept.
    $recentConsumed = UserRegistrationLink::create([
        'user_id' => $user->id,
        'token_hash' => random_bytes(32),
        'expires_at' => $now->clone()->subDays(5),
        'consumed_at' => $now->clone()->subDays(5),
    ])->fresh();

    // Expired recently, never consumed: kept.
    $recentExpiredUnconsumed = UserRegistrationLink::create([
        'user_id' => $user->id,
        'token_hash' => random_bytes(32),
        'expires_at' => $now->clone()->subDay(),
    ])->fresh();

    // Current, never consumed: kept.
    $active = UserRegistrationLink::create([
        'user_id' => $user->id,
        'token_hash' => random_bytes(32),
        'expires_at' => $now->clone()->addHours(24),
    ])->fresh();

    $this->artisan('opaque:prune-handshakes')->assertSuccessful();

    expect(UserRegistrationLink::query()->find($oldConsumed->id))->toBeNull()
        ->and(UserRegistrationLink::query()->find($oldExpiredUnconsumed->id))->toBeNull()
        ->and(UserRegistrationLink::query()->find($recentConsumed->id))->not->toBeNull()
        ->and(UserRegistrationLink::query()->find($recentExpiredUnconsumed->id))->not->toBeNull()
        ->and(UserRegistrationLink::query()->find($active->id))->not->toBeNull();
});

it('reports how many rows it pruned from each table', function (): void {
    OpaqueLoginHandshake::create([
        'user_id' => null,
        'state_ciphertext' => 'cifrado',
        'expires_at' => Carbon::now()->subMinute(),
    ]);

    $user = User::factory()->create();
    $link = UserRegistrationLink::create([
        'user_id' => $user->id,
        'token_hash' => random_bytes(32),
        'expires_at' => Carbon::now()->subDays(40),
        'consumed_at' => Carbon::now()->subDays(31),
    ]);

    OpaqueRegistration::create([
        'user_id' => $user->id,
        'invitation_ref' => $link->id,
        'credential_identifier' => random_bytes(32),
        'profile' => OpaqueProfile::NAME,
        'expires_at' => Carbon::now()->subMinute(),
    ]);

    $this->artisan('opaque:prune-handshakes')
        ->expectsOutputToContain('Handshakes de login purgados: 1.')
        ->expectsOutputToContain('Registros OPAQUE pendientes purgados: 1.')
        ->expectsOutputToContain('Enlaces de registro purgados: 1.')
        ->assertSuccessful();
});
