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
 * ADR 0006 (Consequences): test obligatorio. Si el servidor trunca los microsegundos de
 * `occurred_at` al releerla, el dato asociado del AEAD ya no coincide con el usado al cifrar y el
 * sobre queda indescifrable.
 */
it('conserva los microsegundos de occurred_at byte a byte al releer', function (): void {
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

/** ADR 0006: el servidor valida el formato del sobre, nunca su contenido. */
it('rechaza guardar un payload sin forma de sobre válido', function (string $payload): void {
    $user = User::factory()->create();

    expect(fn () => Event::create([
        'user_id' => $user->id,
        'occurred_at' => now(),
        'payload' => $payload,
    ]))->toThrow(LogicException::class);
})->with([
    'texto plano' => ['basura'],
    'base64url inválido' => ['v1.no-base64!!'],
    'tamaño incorrecto' => ['v1.'.rtrim(strtr(base64_encode(random_bytes(10)), '+/', '-_'), '=')],
]);

/** ADR 0006: solo el dueño ve, edita o borra sus propios eventos. */
it('solo autoriza al dueño del evento', function (): void {
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

/** ADR 0006: las columnas en claro son solo las que el servidor necesita para autorizar y paginar. */
it('tiene las columnas del esquema y el índice compuesto', function (): void {
    expect(Schema::hasColumns('events', [
        'id', 'user_id', 'occurred_at', 'payload', 'created_at', 'updated_at', 'deleted_at',
    ]))->toBeTrue();

    $indexes = Schema::getIndexes('events');
    $hasCompositeIndex = collect($indexes)->contains(
        fn (array $index): bool => $index['columns'] === ['user_id', 'occurred_at']
    );

    expect($hasCompositeIndex)->toBeTrue();
});

/** ADR 0006: relación con el usuario y borrado en cascada. */
it('pertenece a un usuario y se borra en cascada con él', function (): void {
    $user = User::factory()->create();
    $event = Event::factory()->for($user)->create();

    expect($event->user)->toBeInstanceOf(User::class)
        ->and($event->user->id)->toBe($user->id);

    $user->delete();

    expect(Event::query()->find($event->id))->toBeNull();
});

/** ADR 0006 §EnvelopeValidator: la fábrica produce sobres con forma válida por defecto. */
it('la fábrica genera un payload con forma de sobre válida', function (): void {
    $event = Event::factory()->create();

    expect(EnvelopeValidator::isValid($event->payload))->toBeTrue();
});
