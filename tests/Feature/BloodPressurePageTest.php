<?php

declare(strict_types=1);

use App\Filament\Pages\BloodPressure;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Transport tests for the blood pressure screen (ADR 0002, ADR 0004, ADR 0006) and for the contract
 * between the template, the Alpine module and this page.
 *
 * The server cannot build a real encrypted envelope because it has no client key. The tests that
 * need a valid payload use `envelopeCipherText()` and `canonicalOccurredAtNow()`, the GLOBAL helpers
 * from `tests/Pest.php`: this file used to have its own copy under a different name, which is how
 * two versions drift apart in silence.
 */
it('stores an event with a well formed envelope and a canonical date', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();
    $occurredAt = canonicalOccurredAtNow();

    $this->actingAs($user);

    $result = Livewire::test(BloodPressure::class)
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

    expect(fn () => Livewire::test(BloodPressure::class)
        ->instance()
        ->storeEvent('this is not an encrypted envelope', canonicalOccurredAtNow()))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rejects a date without microseconds', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(BloodPressure::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), now()->utc()->format('Y-m-d\TH:i:s\Z')))
        ->toThrow(ValidationException::class);

    expect(Event::query()->count())->toBe(0);
});

it('rejects a date with a UTC offset instead of Z', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    expect(fn () => Livewire::test(BloodPressure::class)
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

    $result = Livewire::test(BloodPressure::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
});

it('storeEvent and fetchEvents isolate events per user, never showing another user events', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $this->actingAs($user);
    $ownResult = Livewire::test(BloodPressure::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());

    $this->actingAs($otherUser);
    Livewire::test(BloodPressure::class)
        ->instance()
        ->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());

    $this->actingAs($user);
    $result = Livewire::test(BloodPressure::class)
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
 * follows the same approach as `tests/Feature/EncryptedPayloadGuardTest.php` and
 * `GlucosePageTest.php`.
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
    $test = Livewire::test(BloodPressure::class)
        ->call('storeEvent', $envelope, $occurredAt)
        ->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

it('the catalog carries the three verified LOINC codes and the UCUM units from ADR 0005', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $catalog = Livewire::test(BloodPressure::class)
        ->instance()
        ->catalog();

    expect($catalog['loinc'])->toBe([
        'systolic' => '8480-6',
        'diastolic' => '8462-4',
        'pulse' => '8867-4',
    ]);

    expect($catalog['units'])->toBe([
        'pressure' => 'mm[Hg]',
        'pulse' => '/min',
    ]);

    expect(collect($catalog['arms'])->pluck('token')->all())->toBe(['left', 'right']);
    expect(collect($catalog['postures'])->pluck('token')->all())->toBe(['sitting', 'lying', 'standing']);
});

/*
|--------------------------------------------------------------------------
| Contract between client and server
|--------------------------------------------------------------------------
|
| `MethodNotFoundException: Public method [storeBloodPressureEvent] not found on component` showed
| up in production: the shared transport was extracted into `HealthEventPage` and the method was
| renamed to `storeEvent`, but the Alpine module kept calling the old name. Nothing checked it.
| These tests check it.
|
| The three contracts of this screen are textual, not typed: method names the client writes as
| strings, and `x-ref`s the template declares and the module reads. Neither fails at compile time or
| at deploy time: they fail on click. The files are read and cross-checked.
|
*/

/** @return string Source code of the screen's Alpine module. */
function bloodPressureModuleSource(): string
{
    return file_get_contents(resource_path('js/health/bloodPressurePage.js'));
}

/** @return string Source code of the screen's Blade template. */
function bloodPressureTemplateSource(): string
{
    return file_get_contents(resource_path('views/phr/pages/blood-pressure.blade.php'));
}

/**
 * The template without its Blade comments. The ADR 0002 rules are checked against the markup that
 * reaches the browser: the comments quote `wire:model` or `@island` to explain why they are or are
 * not used, and counting them would give a false positive.
 */
function bloodPressureTemplateMarkup(): string
{
    return preg_replace('/\{\{--.*?--\}\}/s', '', bloodPressureTemplateSource());
}

/**
 * Extracts the argument text of every `$wire.<method>(...)` call, honouring nested parentheses, so
 * we can count how many arguments are really passed.
 *
 * @return list<array{method: string, arguments: string}>
 */
function bloodPressureWireCalls(string $source): array
{
    preg_match_all('/\$wire\.(\w+)\(/', $source, $matches, PREG_OFFSET_CAPTURE);

    $calls = [];

    foreach ($matches[1] as $index => [$method, $_]) {
        $cursor = $matches[0][$index][1] + strlen($matches[0][$index][0]);
        $depth = 1;
        $start = $cursor;

        while ($depth > 0 && $cursor < strlen($source)) {
            $depth += match ($source[$cursor]) {
                '(' => 1,
                ')' => -1,
                default => 0,
            };
            $cursor++;
        }

        $calls[] = ['method' => $method, 'arguments' => substr($source, $start, $cursor - $start - 1)];
    }

    return $calls;
}

/** @return int Number of top-level arguments in the text of a call. */
function bloodPressureArgumentCount(string $arguments): int
{
    if (trim($arguments) === '') {
        return 0;
    }

    $count = 1;
    $depth = 0;

    foreach (str_split($arguments) as $character) {
        $depth += match ($character) {
            '(', '[', '{' => 1,
            ')', ']', '}' => -1,
            default => 0,
        };

        if ($character === ',' && $depth === 0) {
            $count++;
        }
    }

    return $count;
}

it('every $wire.<method> in the module exists as a public method of the page', function (): void {
    $calls = bloodPressureWireCalls(bloodPressureModuleSource());

    expect($calls)->not->toBeEmpty();

    $publicMethods = collect((new ReflectionClass(BloodPressure::class))->getMethods(ReflectionMethod::IS_PUBLIC))
        ->keyBy->getName();

    foreach ($calls as $call) {
        expect($publicMethods->has($call['method']))->toBeTrue(
            sprintf('The module calls $wire.%s() and that page has no such public method.', $call['method'])
        );
    }
});

it('every $wire.<method> passes a number of arguments the server method accepts', function (): void {
    foreach (bloodPressureWireCalls(bloodPressureModuleSource()) as $call) {
        $method = new ReflectionMethod(BloodPressure::class, $call['method']);
        $passed = bloodPressureArgumentCount($call['arguments']);

        expect($passed)->toBeGreaterThanOrEqual($method->getNumberOfRequiredParameters());
        expect($passed)->toBeLessThanOrEqual($method->getNumberOfParameters());
    }
});

it('the client only reads fields storeEvent and fetchEvents really return', function (): void {
    $user = User::factory()->registered()->create();
    $this->actingAs($user);

    $page = Livewire::test(BloodPressure::class)->instance();

    $stored = $page->storeEvent(envelopeCipherText(), canonicalOccurredAtNow());
    expect(array_keys($stored))->toBe(['id', 'occurredAt']);

    /** `loadHistory()` reads these three fields from every row; if one were missing, the envelope would not open. */
    $fetched = $page->fetchEvents();
    expect($fetched)->toHaveCount(1);
    expect(array_keys($fetched[0]))->toBe(['id', 'occurredAt', 'payload']);
});

it('every this.$refs in the module has its x-ref in the template', function (): void {
    preg_match_all('/this\.\$refs\.(\w+)/', bloodPressureModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', bloodPressureTemplateSource(), $declaredMatches);

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
    preg_match_all('/this\.\$refs\.(\w+)/', bloodPressureModuleSource(), $usedMatches);
    preg_match_all('/x-ref="(\w+)"/', bloodPressureTemplateSource(), $declaredMatches);

    /**
     * `form` and `error` are declared by all four event screens and none of them reads them from
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
    expect(bloodPressureTemplateSource())->toContain('<x-filament-panels::page>');
});

it('the history goes in an island and the charts only with wire:ignore', function (): void {
    $template = bloodPressureTemplateMarkup();

    /**
     * The history carries both ADR 0002 layers: `@island` outside and `wire:ignore` inside.
     *
     * The charts do NOT carry an island, and that is deliberate. Verified by running the component:
     * after any Livewire request the server emits the island empty, so the `<canvas>` and its
     * caption disappear from the HTML and `$refs.chart` becomes undefined; storing a record blew up
     * with "Cannot set properties of undefined". The island adds nothing in that region because the
     * server never renders it, Alpine builds it entirely, and `wire:ignore` already stops the morph
     * from touching it.
     */
    expect($template)->toContain("@island(name: 'blood-pressure-list')");
    expect($template)->not->toContain("@island(name: 'blood-pressure-chart')");
    expect($template)->not->toContain("@island(name: 'blood-pressure-pulse-chart')");

    foreach (['blood-pressure-list', 'blood-pressure-chart', 'blood-pressure-pulse-chart'] as $region) {
        expect($template)->toContain("wire:key=\"{$region}-region\"");
    }

    expect(substr_count($template, 'wire:ignore'))->toBe(3);
    expect(substr_count($template, '@island('))->toBe(1);
});

it('every canvas has an accessible name and a caption describing it in text', function (): void {
    $template = bloodPressureTemplateMarkup();

    /**
     * Do's #3: the trend cannot be communicated by the line colour alone. The caption is painted by
     * Blade and not by JavaScript, so it has a stable `id` for the canvas to point at.
     */
    foreach (['blood-pressure-chart-caption', 'blood-pressure-pulse-chart-caption'] as $captionId) {
        expect($template)->toContain('aria-describedby="'.$captionId.'"');
        expect($template)->toContain('id="'.$captionId.'"');
    }

    expect(substr_count($template, 'role="img"'))->toBe(2);
    expect(bloodPressureModuleSource())->not->toContain('insertAdjacentElement');
});

it('the template does not use wire:model in any form', function (): void {
    expect(bloodPressureTemplateMarkup())->not->toContain('wire:model');
});

it('the arm and posture options are rendered by Blade, not Alpine', function (): void {
    $template = bloodPressureTemplateSource();
    $module = bloodPressureModuleSource();

    expect($template)->toContain("@foreach (\$catalog['arms'] as \$arm)");
    expect($template)->toContain("@foreach (\$catalog['postures'] as \$posture)");

    /** If Alpine created `<option>`s, the morph would wipe them on the first request (ADR 0002). */
    expect($module)->not->toContain("createElement('option')");
});

it('the numeric fields follow the convention in .ai/guidelines/ai.md', function (): void {
    $template = bloodPressureTemplateSource();

    foreach (['bp-systolic', 'bp-diastolic', 'bp-pulse'] as $id) {
        $field = str($template)->after('id="'.$id.'"')->before('>')->toString();

        expect($field)->toContain('type="number"');
        expect($field)->toContain('min="0"');
        expect($field)->toContain('step="any"');
        expect($field)->toContain('inputmode="decimal"');
        expect($field)->toContain('font-mono');
        expect($field)->toContain('min-h-11');
    }

    /** The two-decimal limit and the comma-to-dot normalization come from `numericValue.js`. */
    expect(bloodPressureModuleSource())->toContain("from './numericValue.js'");
});

it('every form field has a visible label associated with it', function (): void {
    $template = bloodPressureTemplateSource();

    preg_match_all('/<label for="([\w-]+)"/', $template, $labels);
    preg_match_all('/\sid="(bp-[\w-]+)"/', $template, $fields);

    /** DESIGN.md: the label is always visible, never a placeholder acting as a label. */
    expect(array_diff($fields[1], $labels[1]))->toBe([]);
});
