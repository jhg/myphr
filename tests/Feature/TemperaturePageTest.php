<?php

declare(strict_types=1);

use App\Catalog\TemperatureLoincCode;
use App\Catalog\TemperatureMeasurementSite;
use App\Filament\Pages\Temperature;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Transport tests for the body temperature screen (ADR 0002, ADR 0004, ADR 0006) and for the
 * contract between the template, the Alpine module and this page.
 *
 * The server cannot build a real encrypted envelope because it has no client key. The tests that
 * need a valid payload use `envelopeCipherText()` and `canonicalOccurredAtNow()`, the GLOBAL helpers
 * from `tests/Pest.php`.
 */
it('stores an event with a well formed envelope and a canonical date', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();
    $occurredAt = canonicalOccurredAtNow();

    $this->actingAs($user);

    $result = Livewire::test(Temperature::class)
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

    expect(fn () => Livewire::test(Temperature::class)
        ->instance()
        ->storeEvent('this is not an encrypted envelope', canonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rejects a date with a UTC offset instead of Z', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(Temperature::class)
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

    $result = Livewire::test(Temperature::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
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

    $test = Livewire::test(Temperature::class)
        ->call('storeEvent', $envelope, canonicalOccurredAtNow())
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

it('the catalog resolves a verified LOINC code for every measurement site', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(Temperature::class)
        ->instance()
        ->catalog();

    /**
     * Unlike blood pressure, here the LOINC code depends on the site: LOINC publishes one per
     * measurement site. All five are verified against LOINC and cannot change (they go into the
     * encrypted envelope).
     */
    expect($catalog['loinc'])->toBe([
        ['site' => 'axillary', 'code' => '8328-7'],
        ['site' => 'oral', 'code' => '8331-1'],
        ['site' => 'tympanic', 'code' => '8333-7'],
        ['site' => 'temporal', 'code' => '75539-7'],
        ['site' => 'rectal', 'code' => '8332-9'],
    ]);

    expect($catalog['units'])->toBe([
        ['code' => 'Cel', 'label' => '°C'],
        ['code' => '[degF]', 'label' => '°F'],
    ]);

    expect(collect($catalog['sites'])->pluck('token')->all())
        ->toBe(['axillary', 'oral', 'tympanic', 'temporal', 'rectal']);
});

it('the catalog LOINC table covers every published site', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(Temperature::class)->instance()->catalog();

    /**
     * A site in the dropdown without a row in the table would leave the screen with no code to store
     * exactly when "Save" is pressed: the client invents no codes and does not fall back to the
     * generic 8310-5.
     */
    expect(collect($catalog['loinc'])->pluck('site')->all())
        ->toBe(collect($catalog['sites'])->pluck('token')->all());
});

it('does not use the generic body temperature code', function (): void {
    /**
     * 8310-5 "Body temperature" does not say where it was measured. The screen requires a site, so
     * storing that would mean throwing away a fact we do have (ADR 0005).
     */
    foreach (TemperatureMeasurementSite::cases() as $site) {
        expect(TemperatureLoincCode::resolve($site)->value)->not->toBe('8310-5');
    }
});

/*
|--------------------------------------------------------------------------
| Contract between client and server
|--------------------------------------------------------------------------
|
| The contracts of this screen are textual, not typed: method names the client writes as strings, and
| `x-ref`s the template declares and the module reads. Neither fails at compile time or at deploy
| time: they fail on click. The files are read and cross-checked.
|
*/

/** @return string Source code of the screen's Alpine module. */
function temperatureModuleSource(): string
{
    return file_get_contents(resource_path('js/health/temperaturePage.js'));
}

/** @return string Source code of the screen's Blade template. */
function temperatureTemplateSource(): string
{
    return file_get_contents(resource_path('views/phr/pages/temperature.blade.php'));
}

/**
 * The template without its Blade comments. The ADR 0002 rules are checked against the markup that
 * reaches the browser: the comments quote `wire:model` or `@island` to explain why they are or are
 * not used, and counting them would give a false positive.
 */
function temperatureTemplateMarkup(): string
{
    return preg_replace('/\{\{--.*?--\}\}/s', '', temperatureTemplateSource());
}

it('every $wire.<method> in the module exists as a public method of the page', function (): void {
    preg_match_all('/\$wire\.(\w+)\(/', temperatureModuleSource(), $matches);

    expect($matches[1])->not->toBeEmpty();

    $publicMethods = collect((new ReflectionClass(Temperature::class))->getMethods(ReflectionMethod::IS_PUBLIC))
        ->keyBy->getName();

    foreach (array_unique($matches[1]) as $method) {
        expect($publicMethods->has($method))->toBeTrue(
            sprintf('The module calls $wire.%s() and that page has no such public method.', $method)
        );
    }
});

it('the client only reads fields storeEvent and fetchEvents really return', function (): void {
    $user = User::factory()->registered()->create();
    $this->actingAs($user);

    $page = Livewire::test(Temperature::class)->instance();

    $stored = $page->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());
    expect(array_keys($stored))->toBe(['id', 'occurredAt']);

    /** `loadHistory()` reads these three fields from every row; if one were missing, the envelope would not open. */
    $fetched = $page->fetchEvents();
    expect($fetched)->toHaveCount(1);
    expect(array_keys($fetched[0]))->toBe(['id', 'occurredAt', 'payload']);
});

it('every this.$refs in the module has its x-ref in the template', function (): void {
    preg_match_all('/this\.\$refs\.(\w+)/', temperatureModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', temperatureTemplateSource(), $declaredMatches);

    $used = array_unique($usedMatches[1]);
    $declared = array_unique($declaredMatches[1]);

    expect($used)->not->toBeEmpty();

    foreach ($used as $ref) {
        expect(in_array($ref, $declared, true))->toBeTrue(
            sprintf('The module reads this.$refs.%s and the template does not declare that x-ref.', $ref)
        );
    }
});

it('the template declares no orphan x-ref', function (): void {
    preg_match_all('/this\.\$refs\.(\w+)/', temperatureModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', temperatureTemplateSource(), $declaredMatches);

    /** `form` and `error` are declared by every event screen and nobody reads them (see the same
     * comment in `BloodPressurePageTest`). */
    $knownUnused = ['form', 'error'];

    $orphans = array_diff(array_unique($declaredMatches[1]), $usedMatches[1], $knownUnused);

    expect($orphans)->toBe([], 'x-refs declared in the template that nobody reads: '.implode(', ', $orphans));
});

/*
|--------------------------------------------------------------------------
| ADR 0002 rules and the page wrapper
|--------------------------------------------------------------------------
*/

it('the template is wrapped in the Filament page component', function (): void {
    expect(temperatureTemplateSource())->toContain('<x-filament-panels::page>');
});

it('the history goes in an island and the chart only with wire:ignore', function (): void {
    $template = temperatureTemplateMarkup();

    expect($template)->toContain("@island(name: 'temperature-list')");
    expect($template)->not->toContain("@island(name: 'temperature-chart')");

    foreach (['temperature-list', 'temperature-chart'] as $region) {
        expect($template)->toContain("wire:key=\"{$region}-region\"");
    }

    expect(substr_count($template, 'wire:ignore'))->toBe(2);
    expect(substr_count($template, '@island('))->toBe(1);
});

it('the canvas has an accessible name and a caption describing it in text', function (): void {
    $template = temperatureTemplateMarkup();

    /** Do's #3: the trend cannot be communicated by the line colour alone. */
    expect($template)->toContain('aria-describedby="temperature-chart-caption"');
    expect($template)->toContain('id="temperature-chart-caption"');
    expect(substr_count($template, 'role="img"'))->toBe(1);
});

it('the template does not use wire:model in any form', function (): void {
    expect(temperatureTemplateMarkup())->not->toContain('wire:model');
});

it('the unit and site options are rendered by Blade, not Alpine', function (): void {
    $template = temperatureTemplateSource();

    expect($template)->toContain("@foreach (\$catalog['units'] as \$unit)");
    expect($template)->toContain("@foreach (\$catalog['sites'] as \$site)");

    /** If Alpine created `<option>`s, the morph would wipe them on the first request (ADR 0002). */
    expect(temperatureModuleSource())->not->toContain("createElement('option')");
});

it('the history inherits the date range filter', function (): void {
    expect(temperatureTemplateSource())
        ->toContain("@include('phr.partials.date-range', ['idPrefix' => 'temperature'])");

    $module = temperatureModuleSource();

    expect($module)->toContain("from './dateRange.js'");
    expect($module)->toContain('...dateRangeControl()');
    /** The range travels as an argument of `fetchEvents`, never as a Livewire property (ADR 0002). */
    expect($module)->toContain('this.$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to)');
});

it('the numeric field follows the convention in .ai/guidelines/ai.md', function (): void {
    $field = str(temperatureTemplateSource())->after('id="temperature-value"')->before('>')->toString();

    expect($field)->toContain('type="number"');
    expect($field)->toContain('min="0"');
    expect($field)->toContain('step="any"');
    expect($field)->toContain('inputmode="decimal"');
    expect($field)->toContain('font-mono');
    expect($field)->toContain('min-h-11');

    /** The two-decimal limit and the comma-to-dot normalization come from `numericValue.js`. */
    expect(temperatureModuleSource())->toContain("from './numericValue.js'");
});

it('every form field has a visible label associated with it', function (): void {
    $template = temperatureTemplateSource();

    preg_match_all('/<label for="([\w-]+)"/', $template, $labels);
    /** Controls only: the `id` of the chart caption exists for `aria-describedby`, it is not a field. */
    preg_match_all('/<(?:input|select|textarea)\s+id="([\w-]+)"/', $template, $fields);

    /** DESIGN.md: the label is always visible, never a placeholder acting as a label. */
    expect(array_diff($fields[1], $labels[1]))->toBe([]);
});
