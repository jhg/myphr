<?php

declare(strict_types=1);

use App\Catalog\FoodQuantityUnit;
use App\Catalog\MealType;
use App\Filament\Pages\HealthEventPage;
use App\Filament\Pages\Meals;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/** The screen's Alpine module, the source of the contract with the server and with the DOM. */
function mealsModuleSource(): string
{
    return file_get_contents(base_path('resources/js/health/mealsPage.js'));
}

function mealsViewSource(): string
{
    return file_get_contents(base_path('resources/views/phr/pages/meals.blade.php'));
}

/**
 * Transport tests for the meals screen (ADR 0002, ADR 0004, ADR 0006).
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

    $result = Livewire::test(Meals::class)
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

    expect(fn () => Livewire::test(Meals::class)
        ->instance()
        ->storeEvent('this is not an encrypted envelope', canonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rejects a date that is not in the canonical ADR 0004 form', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Meals::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), now()->utc()->format('Y-m-d\TH:i:s\Z')))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('fetchEvents only returns the events of the authenticated user', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $ownEvent = Event::factory()->for($user)->create();
    Event::factory()->for($otherUser)->create();

    $this->actingAs($user);

    $result = Livewire::test(Meals::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
});

/**
 * A new user has no events: `fetchEvents` returns an empty list without failing, and it is the
 * client that paints the "no meals recorded yet" state instead of an empty card.
 */
it('fetchEvents returns an empty list for a freshly registered user', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(Livewire::test(Meals::class)->instance()->fetchEvents())->toBe([]);
});

/**
 * The test ADR 0002 requires: the ciphertext comes down as a return value and goes up as a
 * parameter, never through a public property, so the component snapshot cannot contain it.
 */
it('the component snapshot contains no encrypted envelope', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();

    Event::factory()->for($user)->create(['payload' => envelopeCipherText()]);

    $this->actingAs($user);

    /**
     * The calls go through `call()` and not `instance()`: invoking the method on the instance skips
     * Livewire's hydration and dehydration cycle, and then the snapshot being inspected is the one
     * from before the call.
     */
    $test = Livewire::test(Meals::class)
        ->call('storeEvent', $envelope, canonicalOccurredAtNow())
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

/**
 * Contract with the server. A `MethodNotFoundException` showed up in production because the module
 * was still calling `storeBloodPressureEvent` after the transport was unified into
 * `HealthEventPage::storeEvent()`. Nothing checked that the name really existed: this does.
 */
it('every $wire.<method> in the module exists as a public method of the page', function (): void {
    preg_match_all('/\$wire\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/', mealsModuleSource(), $matches);

    $calledMethods = array_unique($matches[1]);

    expect($calledMethods)->not->toBeEmpty();

    foreach ($calledMethods as $method) {
        expect(method_exists(Meals::class, $method))
            ->toBeTrue("El módulo llama a \$wire.{$method}(), que no existe en ".Meals::class);

        expect((new ReflectionMethod(Meals::class, $method))->isPublic())
            ->toBeTrue("\$wire.{$method}() existe pero no es público: Livewire no lo puede invocar.");
    }
});

/**
 * The number of arguments is part of the contract too: `storeEvent($payload, $occurredAt)` with a
 * single argument blows up just as late as a wrong name.
 */
it('the storeEvent and fetchEvents calls pass the arguments the page expects', function (): void {
    $source = mealsModuleSource();

    expect($source)->toContain('$wire.storeEvent(payload, occurredAt)');

    /**
     * The history is requested with whatever date range the person chose (see
     * `resources/js/health/dateRange.js`). The four arguments go by position, so the cursor and the
     * limit are passed explicitly even when they hold their usual values.
     */
    expect($source)->toContain('$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to)');

    $storeEvent = new ReflectionMethod(HealthEventPage::class, 'storeEvent');
    expect($storeEvent->getNumberOfParameters())->toBe(2);
    expect($storeEvent->getParameters()[0]->getName())->toBe('payload');
    expect($storeEvent->getParameters()[1]->getName())->toBe('occurredAt');

    /**
     * `fetchEvents` is called with four arguments and none is required: the home dashboard still
     * calls it with two and the base class tests with none.
     */
    $fetchEvents = new ReflectionMethod(HealthEventPage::class, 'fetchEvents');
    expect($fetchEvents->getNumberOfRequiredParameters())->toBe(0);
    expect($fetchEvents->getNumberOfParameters())->toBe(4);
});

/** The fields the client reads from every returned event have to exist in the response. */
it('fetchEvents returns exactly the keys the module reads', function (): void {
    $user = User::factory()->registered()->create();
    Event::factory()->for($user)->create();

    $this->actingAs($user);

    $event = Livewire::test(Meals::class)->instance()->fetchEvents()[0];

    expect(array_keys($event))->toEqualCanonicalizing(['id', 'occurredAt', 'payload']);
});

/**
 * DOM contract. A `this.$refs.X` without its `x-ref="X"` is `undefined` and blows up on click, with
 * no warning; a declared and unused `x-ref` is dead weight and confuses whoever comes next.
 */
it('the module $refs and the template x-refs are exactly the same', function (): void {
    preg_match_all('/\$refs\.([A-Za-z_][A-Za-z0-9_]*)/', mealsModuleSource(), $usedMatches);
    preg_match_all('/x-ref="([^"]+)"/', mealsViewSource(), $declaredMatches);

    $used = array_unique($usedMatches[1]);
    $declared = array_unique($declaredMatches[1]);

    sort($used);
    sort($declared);

    expect($used)->toBe($declared);
});

/** The `data-*` attributes of the food row are the other half of the DOM contract. */
it('the data-* attributes of the food row exist in the template', function (): void {
    $view = mealsViewSource();

    foreach (['data-food-row', 'data-food-name', 'data-food-quantity', 'data-food-unit', 'data-food-remove'] as $hook) {
        expect($view)->toContain($hook);
    }
});

/**
 * ADR 0002 rules the template cannot lose: no `wire:model`, the decrypted region inside the island
 * with `wire:ignore` and a stable `wire:key`, and the page wrapped in the Filament page component
 * (without it the first card sticks to the top bar).
 */
it('the template honours ADR 0002 and is wrapped in the Filament page component', function (): void {
    $view = mealsViewSource();

    /** `wire:model=` and not a bare `wire:model`: the header comment names the rule. */
    expect($view)->not->toContain('wire:model=');
    expect($view)->toContain('<x-filament-panels::page>');
    expect($view)->toContain('</x-filament-panels::page>');
    expect($view)->toContain("@island(name: 'meals-list')");
    expect($view)->toContain('wire:ignore x-ref="list" wire:key="meals-list-region"');

    /** The action that fires the request goes OUTSIDE the island: the island only wraps the list. */
    $islandStart = strpos($view, "@island(name: 'meals-list')");
    expect(strpos($view, '@submit.prevent="submit"'))->toBeLessThan($islandStart);
});

/**
 * Clinical numeric field convention (`.ai/guidelines/ai.md`): the amount of each food is a measured
 * value, so never `type="text"`.
 */
it('the food amount is a numeric field with min 0 and step any', function (): void {
    $view = mealsViewSource();

    expect($view)->toMatch('/type="number"\s+min="0"\s+step="any"\s+inputmode="decimal"\s+data-food-quantity/');
    expect(mealsModuleSource())->toContain('parseNumericValue');
});

/** ADR 0002: the `<option>`s are emitted by the server, never by Alpine (the morph would wipe them). */
it('the catalog options are rendered by Blade and not Alpine', function (): void {
    $user = User::factory()->registered()->create();
    $this->actingAs($user);

    $html = Livewire::test(Meals::class)->html();

    foreach (MealType::cases() as $mealType) {
        expect($html)->toContain('<option value="'.$mealType->value.'">');
    }

    foreach (FoodQuantityUnit::cases() as $unit) {
        expect($html)->toContain('<option value="'.e($unit->value).'">');
    }

    /** The module builds no `<option>` and never touches the `options` collection of a `<select>`. */
    expect(mealsModuleSource())->not->toContain("createElement('option')");
    expect(mealsModuleSource())->not->toContain('innerHTML');
});

/** The catalog is public plaintext data: the same keys the module expects (ADR 0005). */
it('the catalog publishes the three blocks the module needs', function (): void {
    $catalog = (new Meals)->catalog();

    expect(array_keys($catalog))->toEqualCanonicalizing(['mealTypes', 'units', 'recordedByRoles']);
    expect($catalog['mealTypes'][0])->toHaveKeys(['token', 'label']);
    expect($catalog['units'][0])->toHaveKeys(['code', 'label']);
    expect($catalog['recordedByRoles'][0])->toHaveKeys(['token', 'label']);

    /** The data origin is not published: there is nothing to choose, it is always `manual`. */
    expect($catalog)->not->toHaveKey('dataOrigins');
});
