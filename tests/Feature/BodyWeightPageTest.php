<?php

declare(strict_types=1);

use App\Catalog\BodyHeightLoincCode;
use App\Filament\Pages\BodyWeight;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Transport tests for the body weight screen (ADR 0002, ADR 0004, ADR 0006) and for the contract
 * between the template, the Alpine module and this page.
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

    $result = Livewire::test(BodyWeight::class)
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

    expect(fn () => Livewire::test(BodyWeight::class)
        ->instance()
        ->storeEvent('this is not an encrypted envelope', canonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rejects a date without microseconds', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(BodyWeight::class)
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

    $result = Livewire::test(BodyWeight::class)
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

    /**
     * The calls go through `call()` and not `instance()`: invoking the method on the instance skips
     * Livewire's hydration and dehydration cycle, and then the snapshot being inspected is the one
     * from before the call.
     */
    $test = Livewire::test(BodyWeight::class)
        ->call('storeEvent', $envelope, canonicalOccurredAtNow())
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

it('the catalog carries the verified LOINC code and the two UCUM units from ADR 0005', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(BodyWeight::class)
        ->instance()
        ->catalog();

    /** 3141-9 "Body weight Measured", verified against LOINC; it does not depend on the unit. */
    expect($catalog['loinc'])->toBe('3141-9');

    expect($catalog['units'])->toBe([
        ['code' => 'kg', 'label' => 'kg'],
        ['code' => '[lb_av]', 'label' => 'lb'],
    ]);

    /**
     * The UCUM code for the pound carries brackets and the label does not: it is the ADR 0005
     * distinction between what is stored (an exchange code) and what is shown.
     */
    expect(collect($catalog['units'])->pluck('label')->all())->not->toContain('[lb_av]');
});

it('the catalog carries the height LOINC code and its two UCUM units', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(BodyWeight::class)
        ->instance()
        ->catalog();

    /**
     * 8302-2 "Body height", the generic one: the screen asks neither posture (standing / lying) nor
     * method (measured / stated), so it can assert neither. See `App\Catalog\BodyHeightLoincCode`.
     */
    expect($catalog['heightLoinc'])->toBe(BodyHeightLoincCode::Generic->value);
    expect($catalog['heightLoinc'])->toBe('8302-2');

    expect($catalog['heightUnits'])->toBe([
        ['code' => 'cm', 'label' => 'cm'],
        ['code' => '[in_i]', 'label' => 'in'],
    ]);

    /** The inch is stored as `[in_i]` (UCUM tells it from the US survey one) and shown as `in`. */
    expect(collect($catalog['heightUnits'])->pluck('label')->all())->not->toContain('[in_i]');
});

it('the official LOINC term for height is not translated (ADR 0005)', function (): void {
    expect(BodyHeightLoincCode::Generic->officialName())->toBe('Body height');
});

/*
|--------------------------------------------------------------------------
| Contract between client and server
|--------------------------------------------------------------------------
|
| The contracts of this screen are textual, not typed: method names the client writes as strings, and
| `x-ref`s the template declares and the module reads. Neither fails at compile time or at deploy
| time: they fail on click. The files are read and cross-checked. It is the same sweep
| `BloodPressurePageTest` does, after the `MethodNotFoundException` that reached production.
|
*/

/** @return string Source code of the screen's Alpine module. */
function bodyWeightModuleSource(): string
{
    return file_get_contents(resource_path('js/health/bodyWeightPage.js'));
}

/** @return string Source code of the screen's Blade template. */
function bodyWeightTemplateSource(): string
{
    return file_get_contents(resource_path('views/phr/pages/body-weight.blade.php'));
}

/**
 * The template without its Blade comments. The ADR 0002 rules are checked against the markup that
 * reaches the browser: the comments quote `wire:model` or `@island` to explain why they are or are
 * not used, and counting them would give a false positive.
 */
function bodyWeightTemplateMarkup(): string
{
    return preg_replace('/\{\{--.*?--\}\}/s', '', bodyWeightTemplateSource());
}

it('every $wire.<method> in the module exists as a public method of the page', function (): void {
    preg_match_all('/\$wire\.(\w+)\(/', bodyWeightModuleSource(), $matches);

    expect($matches[1])->not->toBeEmpty();

    $publicMethods = collect((new ReflectionClass(BodyWeight::class))->getMethods(ReflectionMethod::IS_PUBLIC))
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

    $page = Livewire::test(BodyWeight::class)->instance();

    $stored = $page->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());
    expect(array_keys($stored))->toBe(['id', 'occurredAt']);

    /** `loadHistory()` reads these three fields from every row; if one were missing, the envelope would not open. */
    $fetched = $page->fetchEvents();
    expect($fetched)->toHaveCount(1);
    expect(array_keys($fetched[0]))->toBe(['id', 'occurredAt', 'payload']);
});

it('every this.$refs in the module has its x-ref in the template', function (): void {
    preg_match_all('/this\.\$refs\.(\w+)/', bodyWeightModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', bodyWeightTemplateSource(), $declaredMatches);

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
    preg_match_all('/this\.\$refs\.(\w+)/', bodyWeightModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', bodyWeightTemplateSource(), $declaredMatches);

    /**
     * `form` and `error` are declared by every event screen and none of them reads them from
     * JavaScript: the form is handled with `@submit.prevent` and the error with `x-text`. They are
     * left in place because removing them here alone would break the symmetry between screens, but
     * they are named one by one so that a new, unused `x-ref` does make this test fail.
     */
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
    /** Without it, `fi-page-header-main-ctn` is lost and the first card sticks to the top bar. */
    expect(bodyWeightTemplateSource())->toContain('<x-filament-panels::page>');
});

it('the history goes in an island and the chart only with wire:ignore', function (): void {
    $template = bodyWeightTemplateMarkup();

    /**
     * The history carries both ADR 0002 layers: `@island` outside and `wire:ignore` inside. The
     * chart does NOT carry an island, and that is deliberate: the server emits the island empty
     * after any Livewire request, the `<canvas>` disappears and `$refs.chart` becomes undefined.
     */
    expect($template)->toContain("@island(name: 'body-weight-list')");
    expect($template)->not->toContain("@island(name: 'body-weight-chart')");

    foreach (['body-weight-list', 'body-weight-chart'] as $region) {
        expect($template)->toContain("wire:key=\"{$region}-region\"");
    }

    expect(substr_count($template, 'wire:ignore'))->toBe(2);
    expect(substr_count($template, '@island('))->toBe(1);
});

it('the canvas has an accessible name and a caption describing it in text', function (): void {
    $template = bodyWeightTemplateMarkup();

    /** Do's #3: the trend cannot be communicated by the line colour alone. */
    expect($template)->toContain('aria-describedby="body-weight-chart-caption"');
    expect($template)->toContain('id="body-weight-chart-caption"');
    expect(substr_count($template, 'role="img"'))->toBe(1);
});

it('the template does not use wire:model in any form', function (): void {
    expect(bodyWeightTemplateMarkup())->not->toContain('wire:model');
});

it('the unit options are rendered by Blade, not Alpine', function (): void {
    expect(bodyWeightTemplateSource())->toContain("@foreach (\$catalog['units'] as \$unit)");

    /** If Alpine created `<option>`s, the morph would wipe them on the first request (ADR 0002). */
    expect(bodyWeightModuleSource())->not->toContain("createElement('option')");
});

it('the history inherits the date range filter', function (): void {
    /** The shared control lives in a single template; the screen includes it, it does not copy it. */
    expect(bodyWeightTemplateSource())
        ->toContain("@include('phr.partials.date-range', ['idPrefix' => 'body-weight'])");

    $module = bodyWeightModuleSource();

    expect($module)->toContain("from './dateRange.js'");
    expect($module)->toContain('...dateRangeControl()');
    /** The range travels as an argument of `fetchEvents`, never as a Livewire property (ADR 0002). */
    expect($module)->toContain('this.$wire.fetchEvents(null, HISTORY_FETCH_LIMIT, range.from, range.to)');
});

it('the numeric field follows the convention in .ai/guidelines/ai.md', function (): void {
    $field = str(bodyWeightTemplateSource())->after('id="body-weight-value"')->before('>')->toString();

    expect($field)->toContain('type="number"');
    expect($field)->toContain('min="0"');
    expect($field)->toContain('step="any"');
    expect($field)->toContain('inputmode="decimal"');
    expect($field)->toContain('font-mono');
    expect($field)->toContain('min-h-11');

    /** The two-decimal limit and the comma-to-dot normalization come from `numericValue.js`. */
    expect(bodyWeightModuleSource())->toContain("from './numericValue.js'");
});

it('every form field has a visible label associated with it', function (): void {
    $template = bodyWeightTemplateSource();

    preg_match_all('/<label for="([\w-]+)"/', $template, $labels);
    /** Controls only: the `id` of the chart caption exists for `aria-describedby`, it is not a field. */
    preg_match_all('/<(?:input|select|textarea)\s+id="([\w-]+)"/', $template, $fields);

    /** DESIGN.md: the label is always visible, never a placeholder acting as a label. */
    expect(array_diff($fields[1], $labels[1]))->toBe([]);
});

it('the height field is optional, numeric and explained on the screen itself', function (): void {
    $template = bodyWeightTemplateSource();

    $field = str($template)->after('id="body-weight-height"')->before('>')->toString();

    /** The convention for every measurement field in the project (.ai/guidelines/ai.md). */
    expect($field)->toContain('type="number"');
    expect($field)->toContain('min="0"');
    expect($field)->toContain('step="any"');
    expect($field)->toContain('inputmode="decimal"');

    /** Genuinely optional: no `aria-required` and none of the asterisk weight and date carry. */
    expect($field)->not->toContain('aria-required');

    /**
     * And explained where it shows, not only in the code: without that text, an empty field reads as
     * an oversight and ends up being filled in from memory every week.
     */
    expect($template)->toContain('The height is optional');
});

it('the screen warns that BMI is not a diagnosis and does not categorize it', function (): void {
    $template = bodyWeightTemplateMarkup();

    expect($template)->toContain('not a diagnosis');
    expect($template)->toContain('percentiles for age and sex');

    /** No categories and no judgement colours anywhere in the screen or in the module. */
    foreach (['Overweight', 'Obese', 'Underweight', 'Normal weight'] as $verdict) {
        expect($template)->not->toContain($verdict);
        expect(bodyWeightModuleSource())->not->toContain($verdict);
    }
});

it('the title and the navigation label name both quantities', function (): void {
    expect((new BodyWeight)->getTitle())->toBe(__('Weight and height'));
    expect(BodyWeight::getNavigationLabel())->toBe(__('Weight and height'));

    /**
     * The internal name is NOT renamed along with the label: the Alpine component lives in
     * `resources/js/app.js`, which is off limits while there is concurrent work. This test pins that
     * decision down so nobody undoes it halfway and leaves the screen mute.
     */
    expect(bodyWeightTemplateSource())->toContain('x-data="phrBodyWeightPage"');
});
