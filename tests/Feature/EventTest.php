<?php

declare(strict_types=1);

use App\Crypto\EnvelopeValidator;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Schema;

uses(RefreshDatabase::class);

/**
 * ADR 0006 (Consequences): a mandatory test. If the server truncates the microseconds of
 * `occurred_at` when reading it back, the AEAD associated data no longer matches the one used when
 * encrypting and the envelope becomes undecryptable.
 */
it('keeps the microseconds of occurred_at byte for byte when reading back', function (): void {
    $user = User::factory()->create();
    $payload = 'v1.'.rtrim(strtr(base64_encode(random_bytes(64 + 16 + 256)), '+/', '-_'), '=');

    $original = Carbon::createFromFormat('Y-m-d H:i:s.u', '2026-07-25 10:30:00.123456');

    $event = Event::create([
        'user_id' => $user->id,
        'occurred_at' => $original,
        'payload' => $payload,
    ]);

    $reloaded = Event::query()->findOrFail($event->id);

    expect($reloaded->occurred_at)->toBeInstanceOf(Carbon::class);

    $canonical = fn (Carbon $date): string => $date->format('Y-m-d\TH:i:s.u\Z');

    expect($canonical($reloaded->occurred_at))->toBe($canonical($original));
});

/** ADR 0006: the server validates the envelope format, never its content. */
it('refuses to store a payload without a valid envelope shape', function (string $payload): void {
    $user = User::factory()->create();

    expect(fn () => Event::create([
        'user_id' => $user->id,
        'occurred_at' => now(),
        'payload' => $payload,
    ]))->toThrow(LogicException::class);
})->with([
    'texto plano' => ['basura'],
    'invalid base64url' => ['v1.no-base64!!'],
    'wrong size' => ['v1.'.rtrim(strtr(base64_encode(random_bytes(10)), '+/', '-_'), '=')],
]);

/** ADR 0006: only the owner sees, edits or deletes their own events. */
it('only authorizes the owner of the event', function (): void {
    $owner = User::factory()->registered()->create();
    $stranger = User::factory()->registered()->create();
    $event = Event::factory()->for($owner)->create();

    expect(Gate::forUser($owner)->allows('view', $event))->toBeTrue()
        ->and(Gate::forUser($owner)->allows('update', $event))->toBeTrue()
        ->and(Gate::forUser($owner)->allows('delete', $event))->toBeTrue()
        ->and(Gate::forUser($stranger)->allows('view', $event))->toBeFalse()
        ->and(Gate::forUser($stranger)->allows('update', $event))->toBeFalse()
        ->and(Gate::forUser($stranger)->allows('delete', $event))->toBeFalse();
});

/** ADR 0006: the plaintext columns are only the ones the server needs to authorize and paginate. */
it('has the schema columns and the composite index', function (): void {
    expect(Schema::hasColumns('events', [
        'id', 'user_id', 'occurred_at', 'payload', 'created_at', 'updated_at', 'deleted_at',
    ]))->toBeTrue();

    $indexes = Schema::getIndexes('events');
    $hasCompositeIndex = collect($indexes)->contains(
        fn (array $index): bool => $index['columns'] === ['user_id', 'occurred_at']
    );

    expect($hasCompositeIndex)->toBeTrue();
});

/** ADR 0006: relationship with the user and cascade delete. */
it('belongs to a user and is deleted in cascade with them', function (): void {
    $user = User::factory()->create();
    $event = Event::factory()->for($user)->create();

    expect($event->user)->toBeInstanceOf(User::class)
        ->and($event->user->id)->toBe($user->id);

    $user->delete();

    expect(Event::query()->find($event->id))->toBeNull();
});

/** ADR 0006 §EnvelopeValidator: the factory produces envelopes with a valid shape by default. */
it('the factory generates a payload with a valid envelope shape', function (): void {
    $event = Event::factory()->create();

    expect(EnvelopeValidator::isValid($event->payload))->toBeTrue();
});
