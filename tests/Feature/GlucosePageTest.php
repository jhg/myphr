<?php

declare(strict_types=1);

use App\Filament\Pages\Glucose;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/** The screen's Alpine module, the source of the contract with the server and with the DOM. */
function glucoseModuleSource(): string
{
    return file_get_contents(base_path('resources/js/health/glucosePage.js'));
}

function glucoseViewSource(): string
{
    return file_get_contents(base_path('resources/views/phr/pages/glucose.blade.php'));
}

/**
 * The template without its `{{-- --}}` comments: the contracts are checked against the markup that
 * reaches the browser, not against the prose explaining it —which deliberately names `wire:model`
 * and the `x-ref`s to say why they are or are not there—.
 */
function glucoseViewMarkup(): string
{
    return preg_replace('/\{\{--.*?--\}\}/s', '', glucoseViewSource());
}

/**
 * Transport tests for the blood glucose screen (ADR 0002, ADR 0004, ADR 0006).
 *
 * `envelopeCipherText()` and `canonicalOccurredAtNow()` are global and live in `tests/Pest.php`: the
 * four event screens need them, and declaring them in two `Feature` files breaks the whole suite
 * with "cannot redeclare function".
 */
it('stores an event with a well formed envelope and a canonical date', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();
    $occurredAt = canonicalOccurredAtNow();

    $this->actingAs($user);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent($envelope, $occurredAt);

    expect($result['id'])->toBeString();
    expect($result['occurredAt'])->toBe($occurredAt);

    $this->assertDatabaseHas('events', [
        'id' => $result['id'],
        'user_id' => $user->id,
        'payload' => $envelope,
    ]);
});

it('rejects a malformed payload and creates no row', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent('this is not an encrypted envelope', canonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rejects a date without microseconds', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), now()->utc()->format('Y-m-d\TH:i:s\Z')))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rejects a date with a UTC offset instead of Z', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), now()->format('Y-m-d\TH:i:s.u').'+02:00'))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('fetchEvents only returns the events of the authenticated user', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $ownEvent = Event::factory()->for($user)->create();
    Event::factory()->for($otherUser)->create();

    $this->actingAs($user);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
});

it('storeEvent and fetchEvents isolate events per user, never showing another user events', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $this->actingAs($user);
    $ownResult = Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());

    $this->actingAs($otherUser);
    Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());

    $this->actingAs($user);
    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownResult['id']);

    $this->assertDatabaseHas('events', [
        'id' => $ownResult['id'],
        'user_id' => $user->id,
    ]);
});

/**
 * The test ADR 0002 requires: the ciphertext comes down as a return value and goes up as a
 * parameter, never through a public property, so the component snapshot cannot contain it. It
 * follows the same approach as `tests/Feature/EncryptedPayloadGuardTest.php`.
 */
it('the component snapshot contains no encrypted envelope', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();
    $occurredAt = canonicalOccurredAtNow();

    Event::factory()->for($user)->create(['payload' => envelopeCipherText()]);

    $this->actingAs($user);

    /**
     * The calls go through `call()` and not `instance()`: invoking the method on the instance skips
     * Livewire's hydration and dehydration cycle, and then the snapshot being inspected is the one
     * from before the call. The test would pass even if the envelope ended up in a public property,
     * which is exactly what it has to catch.
     */
    $test = Livewire::test(Glucose::class)
        ->call('storeEvent', $envelope, $occurredAt)
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

/**
 * Client-server contract (the bug that reached production: `storeBloodPressureEvent` was still
 * being called from JavaScript after the method was renamed to `storeEvent` in `HealthEventPage`).
 * Nothing checked that the name existed; this checks it.
 */
it('every $wire.<method> in the module exists as a public method of the page', function (): void {
    preg_match_all('/\$wire\.([A-Za-z0-9_]+)\s*\(/', glucoseModuleSource(), $matches);

    expect($matches[1])->not->toBeEmpty();

    foreach (array_unique($matches[1]) as $method) {
        $reflection = new ReflectionClass(Glucose::class);

        expect($reflection->hasMethod($method))
            ->toBeTrue("El módulo llama a \$wire.{$method}(), que no existe en Glucose ni en HealthEventPage.");
        expect($reflection->getMethod($method)->isPublic())
            ->toBeTrue("\$wire.{$method}() existe pero no es público: Livewire no lo puede invocar.");
    }
});

it('every $wire.<method> is called with a number of arguments the method accepts', function (): void {
    preg_match_all('/\$wire\.([A-Za-z0-9_]+)\s*\(([^)]*)\)/', glucoseModuleSource(), $matches, PREG_SET_ORDER);

    expect($matches)->not->toBeEmpty();

    foreach ($matches as [, $method, $arguments]) {
        $given = trim($arguments) === '' ? 0 : count(explode(',', $arguments));
        $reflected = (new ReflectionClass(Glucose::class))->getMethod($method);

        expect($given)->toBeGreaterThanOrEqual(
            $reflected->getNumberOfRequiredParameters(),
            "\$wire.{$method}() se llama con {$given} argumento(s) y el método exige más.",
        );
        expect($given)->toBeLessThanOrEqual(
            $reflected->getNumberOfParameters(),
            "\$wire.{$method}() se llama con {$given} argumento(s) y el método admite menos.",
        );
    }
});

it('the fields the client reads from fetchEvents and storeEvent exist in the server response', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $stored = Livewire::test(Glucose::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());

    expect(array_keys($stored))->toEqualCanonicalizing(['id', 'occurredAt']);

    $fetched = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents();

    /** `rawEvent.id`, `rawEvent.occurredAt` and `rawEvent.payload` are the three `loadHistory()` reads. */
    expect(array_keys($fetched[0]))->toEqualCanonicalizing(['id', 'occurredAt', 'payload']);
});

/**
 * DOM contract: a `$refs` without its `x-ref` is `undefined` and blows up on click, with no warning;
 * an `x-ref` nobody reads pretends there is a contract that does not exist.
 */
it('the module $refs and the template x-refs match exactly', function (): void {
    preg_match_all('/\$refs\.([A-Za-z0-9_]+)/', glucoseModuleSource(), $usedMatches);
    preg_match_all('/x-ref="([A-Za-z0-9_]+)"/', glucoseViewMarkup(), $declaredMatches);

    $used = array_unique($usedMatches[1]);
    $declared = array_unique($declaredMatches[1]);

    expect($used)->not->toBeEmpty();
    expect(array_values(array_diff($used, $declared)))->toBe([], 'There are $refs with no x-ref in the template.');
    expect(array_values(array_diff($declared, $used)))->toBe([], 'There are declared x-refs nobody uses.');
});

it('the view honours ADR 0002 and is wrapped in the Filament page component', function (): void {
    $view = glucoseViewMarkup();

    expect($view)->toContain('<x-filament-panels::page>');
    expect($view)->toContain('</x-filament-panels::page>');
    expect($view)->not->toContain('wire:model');

    /**
     * The history goes inside an `@island`; the chart does NOT, and that is deliberate. Verified by
     * running the component: after any Livewire request the server emits the island empty, so the
     * `<canvas>` and its caption disappear from the HTML and `$refs.chart` becomes undefined.
     * Storing a record blew up with "Cannot set properties of undefined". The island adds nothing in
     * that region because the server never renders it: Alpine builds it entirely, and `wire:ignore`
     * already stops the morph from touching it (ADR 0002).
     */
    expect($view)->toContain("@island(name: 'glucose-list')");
    expect($view)->not->toContain("@island(name: 'glucose-chart')");
    expect($view)->toContain('wire:ignore x-ref="list" wire:key="glucose-list-region"');
    expect($view)->toContain('wire:ignore wire:key="glucose-chart-region"');
});

it('the options are rendered by Blade from catalog(), not Alpine', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(Glucose::class)->instance()->catalog();

    $html = Livewire::test(Glucose::class)->html();

    foreach ($catalog['units'] as $unit) {
        expect($html)->toContain('value="'.$unit['code'].'"');
    }

    foreach ($catalog['methods'] as $method) {
        expect($html)->toContain('value="'.$method['token'].'"');
    }

    foreach ($catalog['mealContexts'] as $mealContext) {
        expect($html)->toContain('value="'.$mealContext['token'].'"');
    }

    foreach ($catalog['recordedByRoles'] as $role) {
        expect($html)->toContain('value="'.$role['token'].'"');
    }
});

/** Numeric convention from `.ai/guidelines/ai.md` and ADR 0004. */
it('the value field is numeric, with min 0 and step any', function (): void {
    $view = glucoseViewMarkup();

    expect($view)->toContain('x-ref="value"');
    expect($view)->toMatch('/x-ref="value"\s+type="number"\s+min="0"\s+step="any"\s+inputmode="decimal"/');
    expect(glucoseModuleSource())->toContain('parseNumericValue(');
});
