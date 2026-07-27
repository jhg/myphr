<?php

declare(strict_types=1);

use App\Crypto\EnvelopeValidator;
use App\Filament\Pages\HealthEventPage;
use App\Filament\Pages\Insulin;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Transport tests for the insulin screen (ADR 0002, ADR 0004, ADR 0006).
 *
 * The server cannot build a real encrypted envelope because it has no client key. The tests that
 * need a valid payload generate one with the same shape `resources/js/crypto/envelope.js` produces:
 * the `v1.` prefix plus base64url of an allowed padding size. It mirrors
 * `tests/Feature/GlucosePageTest.php`: {@see Insulin} adds no transport logic of its own, it only
 * inherits {@see HealthEventPage::storeEvent()} and {@see HealthEventPage::fetchEvents()}, so the
 * same guarantees apply.
 */
function insulinEnvelopeCipherText(int $paddedSize = 256): string
{
    $totalBytes = EnvelopeValidator::HEADER_BYTES + EnvelopeValidator::TAG_BYTES + $paddedSize;

    return EnvelopeValidator::PREFIX.rtrim(strtr(base64_encode(random_bytes($totalBytes)), '+/', '-_'), '=');
}

function insulinCanonicalOccurredAtNow(): string
{
    return now()->utc()->format('Y-m-d\TH:i:s.u\Z');
}

it('stores an event with a well formed envelope and a canonical date', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = insulinEnvelopeCipherText();
    $occurredAt = insulinCanonicalOccurredAtNow();

    $this->actingAs($user);

    $result = Livewire::test(Insulin::class)
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

    expect(fn () => Livewire::test(Insulin::class)
        ->instance()
        ->storeEvent('this is not an encrypted envelope', insulinCanonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rejects a date without microseconds', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Insulin::class)
        ->instance()
        ->storeEvent(insulinEnvelopeCipherText(), now()->utc()->format('Y-m-d\TH:i:s\Z')))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rejects a date with a UTC offset instead of Z', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Insulin::class)
        ->instance()
        ->storeEvent(insulinEnvelopeCipherText(), now()->format('Y-m-d\TH:i:s.u').'+02:00'))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('fetchEvents only returns the events of the authenticated user', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $ownEvent = Event::factory()->for($user)->create();
    Event::factory()->for($otherUser)->create();

    $this->actingAs($user);

    $result = Livewire::test(Insulin::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
});

it('storeEvent and fetchEvents isolate events per user, never showing another user events', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $this->actingAs($user);
    $ownResult = Livewire::test(Insulin::class)
        ->instance()
        ->storeEvent(insulinEnvelopeCipherText(), insulinCanonicalOccurredAtNow());

    $this->actingAs($otherUser);
    Livewire::test(Insulin::class)
        ->instance()
        ->storeEvent(insulinEnvelopeCipherText(), insulinCanonicalOccurredAtNow());

    $this->actingAs($user);
    $result = Livewire::test(Insulin::class)
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
 * parameter, never through a public property, so the component snapshot cannot contain it.
 */
it('the component snapshot contains no encrypted envelope', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = insulinEnvelopeCipherText();
    $occurredAt = insulinCanonicalOccurredAtNow();

    Event::factory()->for($user)->create(['payload' => insulinEnvelopeCipherText()]);

    $this->actingAs($user);

    /**
     * The calls go through `call()` and not `instance()`: invoking the method on the instance skips
     * Livewire's hydration and dehydration cycle, and then the snapshot being inspected is the one
     * from before the call. The test would pass even if the envelope ended up in a public property,
     * which is exactly what it has to catch.
     */
    $test = Livewire::test(Insulin::class)
        ->call('storeEvent', $envelope, $occurredAt)
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

/**
 * The catalog carries no LOINC (ADR 0006, insulin is a medication administration, not an
 * observation) and does not publish `dataOrigins` (a scope fix: the form does not ask for the data
 * origin).
 */
it('the catalog carries the insulin types, the international unit and the injection sites, with no LOINC and no origins', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(Insulin::class)->instance()->catalog();

    expect($catalog)->toHaveKeys(['units', 'insulinTypes', 'injectionSites', 'recordedByRoles']);
    expect($catalog)->not->toHaveKey('loinc');
    expect($catalog)->not->toHaveKey('dataOrigins');

    expect($catalog['units'])->toHaveCount(1);
    expect($catalog['units'][0]['code'])->toBe('[iU]');

    $insulinTypeTokens = array_column($catalog['insulinTypes'], 'token');
    expect($insulinTypeTokens)->toEqualCanonicalizing(['rapid', 'long', 'mixed']);

    $injectionSiteTokens = array_column($catalog['injectionSites'], 'token');
    expect($injectionSiteTokens)->toEqualCanonicalizing(['abdomen', 'thigh', 'glute', 'arm']);
});

/**
 * The bug that reached production: the shared transport was renamed to `storeEvent` in
 * {@see HealthEventPage} and two JavaScript modules kept calling the old name, so the screen blew up
 * on save with "Public method [...] not found on component". Nothing checked it.
 *
 * This test reads the screen module, extracts every `$wire.<method>` it calls and requires that it
 * really exists as a public method of {@see Insulin} —its own or inherited—. Renaming the method on
 * the server without touching the client stops working here, not in production.
 */
it('every $wire.<method> in the insulin module exists as a public method of the page', function (): void {
    $module = file_get_contents(resource_path('js/health/insulinPage.js'));

    preg_match_all('/\$wire\.([a-zA-Z]+)/', $module, $matches);

    $calledMethods = array_values(array_unique($matches[1]));

    expect($calledMethods)->not->toBeEmpty('the module has to call some method of the component');

    foreach ($calledMethods as $method) {
        expect(method_exists(Insulin::class, $method))
            ->toBeTrue("insulinPage.js llama a \$wire.{$method}(), que no existe en ".Insulin::class);

        expect((new ReflectionMethod(Insulin::class, $method))->isPublic())
            ->toBeTrue("\$wire.{$method}() exists but is not public, so Livewire does not expose it");
    }
});

/**
 * The number and order of the arguments is part of the contract too: `storeEvent` takes the envelope
 * first and the canonical date second, and `fetchEvents` is called with no arguments, so both of its
 * parameters have to be optional.
 */
it('storeEvent and fetchEvents accept the arguments the client calls them with', function (): void {
    $storeEvent = new ReflectionMethod(Insulin::class, 'storeEvent');

    expect($storeEvent->getNumberOfParameters())->toBe(2);
    expect($storeEvent->getParameters()[0]->getName())->toBe('payload');
    expect($storeEvent->getParameters()[1]->getName())->toBe('occurredAt');
    expect($storeEvent->getNumberOfRequiredParameters())->toBe(2);

    expect((new ReflectionMethod(Insulin::class, 'fetchEvents'))->getNumberOfRequiredParameters())->toBe(0);
});

/**
 * The fields the client reads from the response have to exist in what the server returns:
 * `insulinPage.js` reads `id`, `occurredAt` and `payload` from every `fetchEvents` row.
 */
it('fetchEvents returns exactly the keys the client reads', function (): void {
    $user = User::factory()->registered()->create();
    Event::factory()->for($user)->create();

    $this->actingAs($user);

    $rows = Livewire::test(Insulin::class)->instance()->fetchEvents();

    expect($rows[0])->toHaveKeys(['id', 'occurredAt', 'payload']);
});

/**
 * The screen renders in full, with the Filament page wrapper (without it the content sticks to the
 * top bar because the container with the vertical padding is lost) and with the `<option>`s painted
 * by the server: if Alpine painted them, the Livewire morph would wipe them on the first request
 * (ADR 0002).
 */
it('the screen renders with the page wrapper and the options painted by the server', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $html = Livewire::test(Insulin::class)->assertOk()->html();

    expect($html)->toContain('fi-page');
    expect($html)->toContain('x-data="phrInsulinPage"');
    expect($html)->toContain('data-phr-insulin-catalog');

    /** The three insulin type options, emitted by Blade from `catalog()`. */
    expect($html)->toContain('value="rapid"');
    expect($html)->toContain('value="long"');
    expect($html)->toContain('value="mixed"');

    /** The two decrypted regions, each with its island and its stable `wire:key` (ADR 0002). */
    expect($html)->toContain('wire:key="insulin-list-region"');
    expect($html)->toContain('wire:key="insulin-chart-region"');
    expect($html)->toContain('id="insulin-chart-caption"');

    /** No variant of `wire:model` on a screen with encrypted data (ADR 0002). */
    expect($html)->not->toContain('wire:model');
});
