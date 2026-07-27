<?php

declare(strict_types=1);

use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;

uses(RefreshDatabase::class);

/** Spec 0001 §3.4 */
it('has the envelope columns and none for updates', function (): void {
    expect(Schema::hasColumns('user_master_key_envelopes', [
        'id', 'user_id', 'envelope', 'created_at', 'retired_at',
    ]))->toBeTrue()
        ->and(Schema::hasColumn('user_master_key_envelopes', 'updated_at'))->toBeFalse();
});

/** Spec 0001 §3.4 / ADR 0009: reissuing a link never overwrites the previous envelope. */
it('keeps the previous envelope when a new one is issued', function (): void {
    $user = User::factory()->create();

    $first = UserMasterKeyEnvelope::create([
        'user_id' => $user->id,
        'envelope' => 'v1.primer-sobre',
    ]);

    $first->retire();

    $second = UserMasterKeyEnvelope::create([
        'user_id' => $user->id,
        'envelope' => 'v1.segundo-sobre',
    ]);

    $first->refresh();

    expect($first->envelope)->toBe('v1.primer-sobre')
        ->and($first->retired_at)->not->toBeNull()
        ->and($second->retired_at)->toBeNull()
        ->and($user->masterKeyEnvelopes()->count())->toBe(2)
        ->and($user->currentMasterKeyEnvelope()->first()->id)->toBe($second->id);
});

/** Spec 0001 §3.4: the table is append-only. */
it('refuses to update the content of an envelope', function (): void {
    $user = User::factory()->create();
    $envelope = UserMasterKeyEnvelope::create([
        'user_id' => $user->id,
        'envelope' => 'v1.sobre',
    ]);

    $envelope->envelope = 'v1.otro';

    expect(fn () => $envelope->save())->toThrow(LogicException::class);
    expect($envelope->fresh()->envelope)->toBe('v1.sobre');
});

it('refuses to retire the same envelope twice', function (): void {
    $user = User::factory()->create();
    $envelope = UserMasterKeyEnvelope::create([
        'user_id' => $user->id,
        'envelope' => 'v1.sobre',
    ]);

    $envelope->retire();

    expect(fn () => $envelope->retire())->toThrow(LogicException::class);
});

it('refuses to delete an envelope', function (): void {
    $user = User::factory()->create();
    $envelope = UserMasterKeyEnvelope::create([
        'user_id' => $user->id,
        'envelope' => 'v1.sobre',
    ]);

    expect(fn () => $envelope->delete())->toThrow(LogicException::class);
    expect(UserMasterKeyEnvelope::count())->toBe(1);
});
