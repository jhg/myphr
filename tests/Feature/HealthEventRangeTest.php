<?php

declare(strict_types=1);

use App\Filament\Pages\Glucose;
use App\Models\Event;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Date range filter of `HealthEventPage::fetchEvents()` (ADR 0004, ADR 0006).
 *
 * The range is tested on `Glucose` because the method lives in the base class and the five screens
 * inherit it as is: repeating the file four times would test the same code four times.
 *
 * `envelopeCipherText()` and `canonicalOccurredAtNow()` are globals from `tests/Pest.php`.
 */

/** Canonical ADR 0004 date from an instant, the only form the method accepts. */
function canonicalAt(CarbonInterface $moment): string
{
    return $moment->utc()->format('Y-m-d\TH:i:s.u\Z');
}

/**
 * One event per day, oldest to newest, with a fixed time so the test does not depend on when it
 * runs.
 *
 * @param  list<int>  $daysAgo
 * @return array<int, Event>
 */
function eventsDaysAgo(User $user, array $daysAgo): array
{
    $events = [];

    foreach ($daysAgo as $days) {
        $events[$days] = Event::factory()->for($user)->create([
            'occurred_at' => now()->utc()->startOfDay()->subDays($days)->addHours(12),
            'payload' => envelopeCipherText(),
        ]);
    }

    return $events;
}

it('without a range it returns every event, as before the filter existed', function (): void {
    $user = User::factory()->registered()->create();
    eventsDaysAgo($user, [1, 5, 40]);

    $this->actingAs($user);

    expect(Livewire::test(Glucose::class)->instance()->fetchEvents())->toHaveCount(3);
});

it('bounds by the start of the range, which is included in the result', function (): void {
    $user = User::factory()->registered()->create();
    $events = eventsDaysAgo($user, [1, 5, 40]);

    $this->actingAs($user);

    $from = canonicalAt($events[5]->occurred_at);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(null, 100, $from);

    /** The event exactly at `$from` is included: the start is inclusive (`>=`). */
    expect(array_column($result, 'id'))->toEqualCanonicalizing([$events[1]->id, $events[5]->id]);
});

it('bounds by the end of the range, which is left out of the result', function (): void {
    $user = User::factory()->registered()->create();
    $events = eventsDaysAgo($user, [1, 5, 40]);

    $this->actingAs($user);

    $to = canonicalAt($events[5]->occurred_at);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(null, 100, null, $to);

    /**
     * The event exactly at `$to` is NOT included: the range is half-open `[from, to)`, which is what
     * lets the client pass the next day's midnight without making up a `23:59:59.999999`.
     */
    expect(array_column($result, 'id'))->toBe([$events[40]->id]);
});

it('with both ends it returns only what falls inside', function (): void {
    $user = User::factory()->registered()->create();
    $events = eventsDaysAgo($user, [1, 5, 10, 40]);

    $this->actingAs($user);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(
            null,
            100,
            canonicalAt(now()->utc()->subDays(11)),
            canonicalAt(now()->utc()->subDays(3)),
        );

    expect(array_column($result, 'id'))->toEqualCanonicalizing([$events[5]->id, $events[10]->id]);
});

/**
 * The delicate point of ADR 0006 applied to the filter: the range cannot filter by type, but it does
 * have to keep isolating by user. A range is not a crack to peek at somebody else's events.
 */
it('the range still returns only the events of the authenticated user', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    eventsDaysAgo($user, [2]);
    eventsDaysAgo($otherUser, [2]);

    $this->actingAs($user);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(null, 100, canonicalAt(now()->utc()->subDays(3)));

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe(Event::query()->where('user_id', $user->id)->sole()->id);
});

/**
 * Range and cursor coexist: the cursor trims from above inside the range, but never widens it.
 */
it('the cursor pages inside the range without leaving it', function (): void {
    $user = User::factory()->registered()->create();
    $events = eventsDaysAgo($user, [1, 3, 5, 40]);

    $this->actingAs($user);

    $from = canonicalAt(now()->utc()->subDays(6));

    $firstPage = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(null, 2, $from);

    expect(array_column($firstPage, 'id'))->toBe([$events[1]->id, $events[3]->id]);

    $secondPage = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents($firstPage[1]['occurredAt'], 2, $from);

    /** The event from 40 days ago is left out by `$from`, even though the cursor would reach it. */
    expect(array_column($secondPage, 'id'))->toBe([$events[5]->id]);
});

it('a cursor before the start of the range returns nothing, instead of widening it', function (): void {
    $user = User::factory()->registered()->create();
    eventsDaysAgo($user, [1, 40]);

    $this->actingAs($user);

    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(
            canonicalAt(now()->utc()->subDays(30)),
            100,
            canonicalAt(now()->utc()->subDays(7)),
        );

    expect($result)->toBe([]);
});

it('the stricter bound wins when the cursor and the end of the range compete', function (): void {
    $user = User::factory()->registered()->create();
    $events = eventsDaysAgo($user, [1, 5]);

    $this->actingAs($user);

    /** `$to` is today (it trims nothing) and the cursor does: the cursor wins. */
    $result = Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(
            canonicalAt(now()->utc()->subDays(3)),
            100,
            null,
            canonicalAt(now()->utc()),
        );

    expect(array_column($result, 'id'))->toBe([$events[5]->id]);
});

/**
 * The same canonical criterion as `storeEvent`, with no second looser format: it is the only way the
 * filter dates do not drift from the ones that go into the AEAD associated data.
 */
it('rejects a range bound that is not in canonical form', function (string $badDate, bool $isStart): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(null, 100, $isStart ? $badDate : null, $isStart ? null : $badDate))
        ->toThrow(ValidationException::class);
})->with([
    'inicio sin microsegundos' => ['2026-03-01T00:00:00Z', true],
    'inicio con desfase en vez de Z' => ['2026-03-01T00:00:00.000000+02:00', true],
    'start with the day only' => ['2026-03-01', true],
    'fin con mes imposible' => ['2026-13-01T00:00:00.000000Z', false],
    'fin sin microsegundos' => ['2026-03-01T00:00:00Z', false],
]);

/**
 * A backwards range is rejected instead of returning the empty list it would produce on its own:
 * without an error, the screen would say "no records in this period", which in front of a medical
 * history reads as "you have no records".
 */
it('rejects a range whose start comes after its end', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Glucose::class)
        ->instance()
        ->fetchEvents(
            null,
            100,
            canonicalAt(now()->utc()),
            canonicalAt(now()->utc()->subDay()),
        ))
        ->toThrow(ValidationException::class);
});

it('accepts a zero-width range and returns the empty list', function (): void {
    $user = User::factory()->registered()->create();
    eventsDaysAgo($user, [1]);

    $this->actingAs($user);

    $instant = canonicalAt(now()->utc());

    expect(Livewire::test(Glucose::class)->instance()->fetchEvents(null, 100, $instant, $instant))
        ->toBe([]);
});

/**
 * The contract with the client: the four parameters, in the order
 * `$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to)` passes them, and all
 * optional, because the home dashboard still calls with two.
 */
it('fetchEvents accepts the cursor, the limit and both range bounds in that order', function (): void {
    $signature = new ReflectionMethod(Glucose::class, 'fetchEvents');

    $parameters = array_map(
        fn (ReflectionParameter $parameter): string => $parameter->getName(),
        $signature->getParameters(),
    );

    expect($parameters)->toBe(['before', 'limit', 'from', 'to']);
    expect($signature->getNumberOfRequiredParameters())->toBe(0);
});

/**
 * The range must not end up in the address bar (Spec 0001 §9, ADR 0002): saying "3 to 10 March" on
 * the insulin screen is already information about the health of whoever is looking, and a URL ends
 * up in the browser history, in the provider's log and in the `Referer`. That is why it travels as a
 * method argument and not as a Livewire property.
 */
it('the range does not travel in the component snapshot', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $from = canonicalAt(now()->utc()->subDays(7));

    $test = Livewire::test(Glucose::class)->call('fetchEvents', null, 100, $from, null);

    expect(json_encode($test->snapshot))->not->toContain($from);
});

/** The four history screens ask the server for the range, they do not filter after decrypting. */
it('the four history modules pass the range to fetchEvents', function (string $module): void {
    $source = file_get_contents(base_path("resources/js/health/{$module}.js"));

    expect($source)->toContain('$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to)');
    expect($source)->toContain('dateRangeControl()');
})->with(['glucosePage', 'bloodPressurePage', 'insulinPage', 'mealsPage']);

/**
 * The four history screens start bounded to the last 24 hours: unbounded, opening them downloads and
 * decrypts everything in the viewer's browser, and the cost only grows with the years. The shortcut
 * is the same as the home dashboard's, so two screens that open on their own do not disagree about
 * what "recent" means.
 */
it('the history starts bounded to the last day and not decrypting everything', function (): void {
    $source = file_get_contents(base_path('resources/js/health/dateRange.js'));

    expect($source)->toContain("export const DEFAULT_RANGE_PRESET = 'day';");
});

/**
 * The price of bounding by default, and what makes it acceptable. In a medical history "it does not
 * show" reads as "it has been lost", so a trim nobody asked for has to be impossible to miss: the
 * period in force is spelled out in words next to the history, the sentence makes clear that what is
 * missing is hidden and not deleted, and going out to the full history is a button in plain sight
 * and not an option buried in the dropdown.
 */
it('keeps the period in force in plain sight and the way out to the full history one click away', function (): void {
    $source = file_get_contents(resource_path('views/phr/partials/date-range.blade.php'));

    expect($source)->toContain("__('Showing:')");
    expect($source)->toContain("__('Older records are hidden by this period, not deleted.')");

    expect($source)->toContain("__('Show all records')");
    expect($source)->toContain('@click="showAllRecords()"');

    /** The notice shows whenever the range is valid, not only when the trim is applied. */
    expect($source)->toContain('x-show="! rangeError"');
    expect($source)->toContain('role="status"');
});

/** The notice button has to exist in the control, not only in the template. */
it('the control offers the way out to the full history', function (): void {
    expect(file_get_contents(base_path('resources/js/health/dateRange.js')))
        ->toContain('showAllRecords()');
});
