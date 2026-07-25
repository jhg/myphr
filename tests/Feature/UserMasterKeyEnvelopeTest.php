<?php

declare(strict_types=1);

use App\Models\User;
use App\Models\UserMasterKeyEnvelope;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;

uses(RefreshDatabase::class);

/** Spec 0001 §3.4 */
it('tiene las columnas del sobre y ninguna de actualización', function (): void {
    expect(Schema::hasColumns('user_master_key_envelopes', [
        'id', 'user_id', 'envelope', 'created_at', 'retired_at',
    ]))->toBeTrue()
        ->and(Schema::hasColumn('user_master_key_envelopes', 'updated_at'))->toBeFalse();
});

/** Spec 0001 §3.4 / ADR 0009: reemitir un enlace nunca sobrescribe el sobre anterior. */
it('conserva el sobre anterior al emitir uno nuevo', function (): void {
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

/** Spec 0001 §3.4: la tabla es de solo añadir. */
it('rechaza actualizar el contenido de un sobre', function (): void {
    $user = User::factory()->create();
    $envelope = UserMasterKeyEnvelope::create([
        'user_id' => $user->id,
        'envelope' => 'v1.sobre',
    ]);

    $envelope->envelope = 'v1.otro';

    expect(fn () => $envelope->save())->toThrow(LogicException::class);
    expect($envelope->fresh()->envelope)->toBe('v1.sobre');
});

it('rechaza retirar dos veces el mismo sobre', function (): void {
    $user = User::factory()->create();
    $envelope = UserMasterKeyEnvelope::create([
        'user_id' => $user->id,
        'envelope' => 'v1.sobre',
    ]);

    $envelope->retire();

    expect(fn () => $envelope->retire())->toThrow(LogicException::class);
});

it('rechaza borrar un sobre', function (): void {
    $user = User::factory()->create();
    $envelope = UserMasterKeyEnvelope::create([
        'user_id' => $user->id,
        'envelope' => 'v1.sobre',
    ]);

    expect(fn () => $envelope->delete())->toThrow(LogicException::class);
    expect(UserMasterKeyEnvelope::count())->toBe(1);
});
