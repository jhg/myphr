<?php

declare(strict_types=1);

use App\Filament\Pages\Dashboard;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;

uses(RefreshDatabase::class);

/**
 * Home dashboard tests (ADR 0002, ADR 0004, ADR 0006).
 *
 * The server cannot build a real encrypted envelope, so the tests that need one use the global
 * `envelopeCipherText()` helper from `tests/Pest.php`, shared with the other event screens.
 */
const DASHBOARD_MODULE = 'resources/js/health/dashboardPage.js';

const DASHBOARD_VIEW = 'resources/views/phr/pages/dashboard.blade.php';

/**
 * Modules that paint what is seen on this screen.
 *
 * Visualization no longer belongs to the dashboard: the timeline, the cards and the charts live in
 * modules that take decrypted events and return nodes, so the professional's reader shows exactly
 * the same thing without a session (ADR 0011). The DESIGN.md rules are checked over all of them,
 * because the markup came out of `dashboardPage.js` and the rules had to come out with it.
 *
 * @var list<string>
 */
const DASHBOARD_RENDER_MODULES = [
    'resources/js/health/dashboardPage.js',
    'resources/js/health/timelineView.js',
    'resources/js/health/statsView.js',
    'resources/js/health/chartsView.js',
    'resources/js/health/eventVisuals.js',
];

/**
 * Source without comments, so the tests that forbid a class do not fail for quoting it in a comment
 * that explains precisely why it is not used.
 */
function dashboardSourceWithoutComments(string $path): string
{
    $contents = (string) file_get_contents(base_path($path));

    $contents = (string) preg_replace('/\{\{--.*?--\}\}/s', '', $contents);
    $contents = (string) preg_replace('#/\*.*?\*/#s', '', $contents);

    return (string) preg_replace('#(^|\s)//.*$#m', '', $contents);
}

it('loads for an authenticated user', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    Livewire::test(Dashboard::class)->assertOk();
});

it('is still the panel home page, at /phr', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $this->get('/phr')->assertOk();
    $this->get('/phr')->assertSeeLivewire(Dashboard::class);
});

/**
 * The test ADR 0002 requires: the ciphertext only comes down as the return value of `fetchEvents`,
 * never through a public property, so the component snapshot cannot contain it. It follows the same
 * approach as the test of the same name in `GlucosePageTest`.
 */
it('the component snapshot contains no encrypted envelope', function (): void {
    $user = User::factory()->registered()->create();
    $envelope = envelopeCipherText();

    Event::factory()->for($user)->create(['payload' => $envelope]);

    $this->actingAs($user);

    /**
     * Same as in `GlucosePageTest`: `call()` and not `instance()`, so it goes through Livewire's
     * hydration/dehydration and the inspected snapshot is the real one.
     */
    $test = Livewire::test(Dashboard::class)->call('fetchEvents');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($envelope);
    expect($snapshotJson)->not->toContain('v1.');
});

/**
 * ─── Client/server contract ───────────────────────────────────────────────────────────────────
 *
 * The production bug "Public method [storeBloodPressureEvent] not found on component" happened
 * because nothing checked that the name the client calls exists on the server. This test checks it:
 * every `$wire.<method>` in the module has to exist as a public method of the page (its own or
 * inherited from `HealthEventPage`).
 */
it('every $wire.<method> in the module exists as a public method of the page', function (): void {
    $module = (string) file_get_contents(base_path(DASHBOARD_MODULE));

    preg_match_all('/\$wire\.(\w+)\s*\(/', $module, $matches);

    $calledMethods = array_unique($matches[1]);

    expect($calledMethods)->not->toBeEmpty();

    foreach ($calledMethods as $method) {
        expect(method_exists(Dashboard::class, $method))
            ->toBeTrue("El módulo llama a \$wire.{$method}(), que no existe en ".Dashboard::class);

        expect((new ReflectionMethod(Dashboard::class, $method))->isPublic())
            ->toBeTrue("\$wire.{$method}() existe pero no es público en ".Dashboard::class);
    }
});

/**
 * The other end of the same contract: the number and order of the arguments. The dashboard paginates
 * passing all four by position —cursor, limit and both ends of the chosen period— so the order of
 * the signature is part of the contract and not an internal detail.
 *
 * The dashboard stopped summarizing two fixed windows: it now bounds by range on the server, which
 * can filter by `occurred_at` (ADR 0006). That is the difference between decrypting 24 hours of
 * envelopes and decrypting a month on every visit to the entry screen.
 */
it('fetchEvents accepts the cursor, the limit and the range in the order the module passes them', function (): void {
    $signature = new ReflectionMethod(Dashboard::class, 'fetchEvents');

    $parameters = array_map(
        fn (ReflectionParameter $parameter): string => $parameter->getName(),
        $signature->getParameters(),
    );

    expect(array_slice($parameters, 0, 4))->toBe(['before', 'limit', 'from', 'to']);
    expect($signature->getNumberOfRequiredParameters())->toBe(0);
});

/**
 * The dashboard has to actually pass the range, not merely be able to: if it went back to calling
 * with two arguments, it would download and decrypt the whole history on every visit without any
 * test noticing.
 */
it('the module passes the chosen range to fetchEvents, not just the cursor and the limit', function (): void {
    $module = (string) file_get_contents(base_path(DASHBOARD_MODULE));

    expect($module)->toMatch('/\$wire\.fetchEvents\([^)]*range\.from[^)]*range\.to[^)]*\)/');
});

/**
 * The default period of this screen is the last day, and that is a product decision, not a detail:
 * it is what makes the entry screen open fast. The history, by contrast, still starts unbounded.
 */
it('the dashboard starts with the last day as the period', function (): void {
    $module = (string) file_get_contents(base_path(DASHBOARD_MODULE));

    expect($module)->toContain("dateRangeControl({ preset: 'day' })");
});

/**
 * The data contract: the client reads `occurredAt` and `payload` from every returned element, and
 * uses the `occurredAt` of the last one as the cursor for the next page.
 */
it('fetchEvents returns the fields the client reads, and the cursor pages backwards', function (): void {
    $user = User::factory()->registered()->create();

    foreach ([1, 2, 3] as $daysAgo) {
        Event::factory()->for($user)->create([
            'occurred_at' => now()->subDays($daysAgo),
            'payload' => envelopeCipherText(),
        ]);
    }

    $this->actingAs($user);

    $firstPage = Livewire::test(Dashboard::class)->instance()->fetchEvents(null, 2);

    expect($firstPage)->toHaveCount(2);
    expect(array_keys($firstPage[0]))->toEqualCanonicalizing(['id', 'occurredAt', 'payload']);

    $cursor = $firstPage[1]['occurredAt'];

    $secondPage = Livewire::test(Dashboard::class)->instance()->fetchEvents($cursor, 2);

    expect($secondPage)->toHaveCount(1);
    expect($secondPage[0]['occurredAt'])->toBeLessThan($cursor);
});

/**
 * ─── DOM contract ─────────────────────────────────────────────────────────────────────────────
 *
 * A `this.$refs.<something>` without its `x-ref` in the template is `undefined` and blows up when
 * used, with no warning; an `x-ref` nobody uses is dead weight that confuses whoever comes next. The
 * two sets have to match exactly.
 */
it('the module $refs and the template x-refs match exactly', function (): void {
    $module = (string) file_get_contents(base_path(DASHBOARD_MODULE));
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    preg_match_all('/this\.\$refs\.(\w+)/', $module, $moduleMatches);
    preg_match_all('/x-ref="(\w+)"/', $view, $viewMatches);

    $used = array_values(array_unique($moduleMatches[1]));
    $declared = array_values(array_unique($viewMatches[1]));

    sort($used);
    sort($declared);

    expect($used)->not->toBeEmpty();
    expect($used)->toBe($declared);
});

/**
 * ─── ADR 0002 rules in the template ───────────────────────────────────────────────────────────
 */
it('the template does not use wire:model in any form', function (): void {
    expect(dashboardSourceWithoutComments(DASHBOARD_VIEW))->not->toContain('wire:model');
});

it('every region Alpine writes to lives inside an island, with wire:ignore and wire:key', function (): void {
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    preg_match_all("/@island\(name: '[\w-]+'\)(.*?)@endisland/s", $view, $islands, PREG_SET_ORDER);

    /**
     * Loading notices, timeline and statistics: the three regions Alpine writes to. The per-type
     * cards are no longer regions of the template, because which ones exist depends on the client's
     * type filter.
     */
    expect($islands)->toHaveCount(3);

    foreach ($islands as [, $body]) {
        expect($body)->toContain('wire:ignore');
        expect($body)->toMatch('/wire:key="[\w-]+"/');
    }

    $outsideIslands = (string) preg_replace("/@island\(name: '[\w-]+'\).*?@endisland/s", '', $view);

    expect($outsideIslands)->not->toContain('x-ref=');
});

/**
 * The page is wrapped in the Filament page component: without it the container that provides the
 * vertical padding is lost and the first card sticks to the top bar.
 */
it('the template is wrapped in the Filament page component', function (): void {
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    expect($view)->toContain('<x-filament-panels::page>');
    expect($view)->toContain('</x-filament-panels::page>');
});

/**
 * ─── DESIGN.md ────────────────────────────────────────────────────────────────────────────────
 *
 * Neither the template nor the module may paint surfaces with ramp shades: `bg-white` does not
 * switch with the theme and `gray-200` is the ink in dark mode, not a border (see `theme.css`,
 * § Ramp Mapping — Dark). Surfaces go by their role: `bg-surface`, `bg-background`, `border-border`.
 */
it('the surfaces use theme papers and not shades of the gray ramp', function (string $path): void {
    $contents = dashboardSourceWithoutComments($path);

    expect($contents)->not->toContain('bg-white');
    expect($contents)->not->toContain('bg-gray-50');
    expect($contents)->not->toContain('border-gray-200');
})->with([DASHBOARD_VIEW, ...DASHBOARD_RENDER_MODULES]);

/**
 * The notices use the `error-*` / `info-*` tokens, which switch with the theme, and not the accent
 * ramps, which are not remapped in dark mode (`theme.css`, § Notices and chips).
 *
 * The notice is built by `eventVisuals.js`, the module shared by the three screens that show events:
 * a notice with the wrong colours there would come out unreadable on all three at once.
 */
it('the notices use the notice tokens and not the accent ramps', function (): void {
    $module = dashboardSourceWithoutComments('resources/js/health/eventVisuals.js');

    expect($module)->toContain('bg-error-surface');
    expect($module)->toContain('bg-info-surface');

    foreach (DASHBOARD_RENDER_MODULES as $path) {
        expect(dashboardSourceWithoutComments($path))->not->toContain('bg-danger-50');
        expect(dashboardSourceWithoutComments($path))->not->toContain('bg-primary-50');
    }
});

/**
 * ─── Chart region ─────────────────────────────────────────────────────────────────────────────
 *
 * The canvases can **not** live inside an `@island`: after any Livewire request the server re-emits
 * it and takes what Alpine drew with it, which is the bug that already cost dearly on the blood
 * glucose, blood pressure and insulin screens. What protects the region is `wire:ignore` with a
 * stable `wire:key` (ADR 0002).
 */
it('the chart canvases live outside the islands, with wire:ignore and wire:key', function (): void {
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    $outsideIslands = (string) preg_replace("/@island\(name: '[\w-]+'\).*?@endisland/s", '', $view);

    expect($outsideIslands)->toContain('wire:key="dashboard-charts-region"');
    expect($outsideIslands)->toContain('<canvas');

    $insideIslands = (string) preg_replace('/^.*?(?=@island)/s', '', $view);

    preg_match_all("/@island\(name: '[\w-]+'\)(.*?)@endisland/s", $insideIslands, $islands, PREG_SET_ORDER);

    foreach ($islands as [, $body]) {
        expect($body)->not->toContain('<canvas');
    }
});

/**
 * The module looks for its canvases by `id` and not by `x-ref`, precisely because they are outside
 * the islands. Both ends of that contract have to match: an `id` the template does not emit leaves
 * the chart undrawn and raises no error.
 */
it('every charted type carries in the template the four identifiers the module looks for', function (): void {
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    /** Meals are not here: they have no quantity to average, so they have no chart. */
    foreach (['glucose', 'bloodPressure', 'insulin', 'bodyWeight', 'temperature'] as $type) {
        foreach (['', '-canvas', '-caption', '-legend'] as $suffix) {
            expect($view)->toContain('id="dashboard-chart-{{ $token }}'.$suffix.'"');
        }

        expect($view)->toContain("'{$type}' => __(");
    }
});

/**
 * The two charts that do not belong to a single event type —the blood glucose curve with meal and
 * insulin markers, and the overlay of the days of the period onto 24 hours— come from a different
 * `@foreach` than the types, so the test above does not cover them: their tokens are the ones
 * `chartsView.js` exports in `CHART_BLOCKS` and their identifiers the ones `chartElementIds()`
 * writes. It is checked against the rendered HTML, which is what the browser really receives: a
 * mistyped token in the template leaves the chart undrawn and raises no error.
 */
it('the dashboard emits the four identifiers of the two cross-type charts', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $page = Livewire::test(Dashboard::class);

    foreach (['glucoseContext', 'dayOverlay'] as $token) {
        foreach (['', '-canvas', '-caption', '-legend'] as $suffix) {
            $page->assertSeeHtml('id="dashboard-chart-'.$token.$suffix.'"');
        }
    }
});

/**
 * A canvas is a graphical object with no text: without an accessible name and without a caption
 * saying in text which series it includes, the trend would only come through the colour of the lines
 * (DESIGN.md Do's #3).
 */
it('every canvas carries an accessible name and points to its caption and its legend', function (): void {
    $view = (string) file_get_contents(base_path(DASHBOARD_VIEW));

    expect($view)->toContain('role="img"');
    expect($view)->toContain('aria-label="{{ __(\'Daily median and daily range for :type\'');
    expect($view)->toContain('aria-describedby="dashboard-chart-{{ $token }}-caption dashboard-chart-{{ $token }}-legend"');
});
