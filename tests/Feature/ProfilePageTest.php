<?php

declare(strict_types=1);

use App\Filament\Pages\Profile;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\App;
use Livewire\Livewire;

uses(RefreshDatabase::class);

it('loads the profile page for an authenticated user', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    Livewire::test(Profile::class)
        ->assertOk()
        ->assertSee('Target blood glucose range')
        ->assertSee('Change your password');
});

/**
 * English is the default language and the translation keys are in English, so the same screen
 * changes language without touching the template. It also serves as a warning if somebody deletes a
 * key from `lang/es.json`: the text would silently fall back to English and it shows up here.
 */
it('paints the profile page in the language in force', function (string $locale, string $expected): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    App::setLocale($locale);

    Livewire::test(Profile::class)
        ->assertOk()
        ->assertSee($expected);
})->with([
    'Spanish' => ['es', 'Rango objetivo de glucemia'],
    'chino simplificado' => ['zh_CN', '血糖目标范围'],
]);

/**
 * The target range starts empty and with no suggested value (ADR 0007): a default range is a
 * clinical recommendation, not an interface preference. This test watches that nobody puts a `value`
 * or a `placeholder` with numbers in the two range fields "so they do not look so empty".
 */
it('proposes no value for the target range', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $html = Livewire::test(Profile::class)->html();

    foreach (['profile-range-low', 'profile-range-high'] as $id) {
        expect(preg_match('/<input[^>]*id="'.$id.'"[^>]*>/', $html, $matches))->toBe(1);
        expect($matches[0])->not->toContain('value=');
        expect($matches[0])->not->toContain('placeholder=');
    }
});

/**
 * The same test ADR 0002 requires on every other screen: the component snapshot cannot carry
 * ciphertext. It matters twice over here, because this account's settings envelope is exactly what
 * the screen edits, and it has to reach the browser through the session bootstrap
 * (`session-secret`), never embedded in the HTML or in Livewire state.
 *
 * The call goes through `call()` and not `instance()`, as in `GlucosePageTest`: invoking on the
 * instance skips the hydration and dehydration cycle, and the inspected snapshot would be the one
 * from before the call.
 */
it('the component snapshot contains no encrypted envelope', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $test = Livewire::test(Profile::class)->call('$refresh');

    $snapshotJson = json_encode($test->snapshot);

    expect($snapshotJson)->not->toContain($user->encrypted_settings);
    expect($snapshotJson)->not->toContain('v1.');
    expect($test->html())->not->toContain($user->encrypted_settings);
});

/*
|--------------------------------------------------------------------------
| Read-only block: latest body measurements
|--------------------------------------------------------------------------
|
| Weight, height and BMI are computed by decrypting in the browser. The server only hands over
| ciphertext: here we check the read path and that the block really is read only, not a second place
| to store the same measurement.
|
*/

it('shows the latest measurements block, read only', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user);

    $html = Livewire::test(Profile::class)
        ->assertOk()
        ->assertSee('Latest body measurements')
        ->assertSee('Last weight')
        ->assertSee('Last height')
        ->assertSee('Body mass index')
        ->html();

    /**
     * No control inside the region: measurements are recorded on the weight and height screen, with
     * their date. A field here would create two truths for the same day.
     */
    $region = str($html)->after('wire:key="profile-body-measurements-region"')->before('</section>')->toString();

    expect($region)->not->toContain('<input');
    expect($region)->not->toContain('<select');
    expect($region)->not->toContain('<textarea');
});

it('the block warns that BMI is not a diagnosis and does not categorize it', function (): void {
    $template = file_get_contents(resource_path('views/phr/pages/profile.blade.php'));
    $module = file_get_contents(resource_path('js/auth/profilePage.js'));

    expect($template)->toContain('not a diagnosis');
    expect($template)->toContain('percentiles for age and sex');

    /** No categories and no thresholds in the template or in the module (see `health/bodyMassIndex.js`). */
    foreach (['Overweight', 'Obese', 'Underweight', 'Normal weight'] as $verdict) {
        expect($template)->not->toContain($verdict);
        expect($module)->not->toContain($verdict);
    }
});

/**
 * The profile reads events through `fetchEvents`, the same method and the same authorization as the
 * history screens (which is why it extends `HealthEventPage`). Without this test, a change of parent
 * class would leave the block blank with no visible error.
 */
it('reads the events of the authenticated user with the same fetchEvents as always', function (): void {
    $user = User::factory()->registered()->create();
    $otherUser = User::factory()->registered()->create();

    $ownEvent = Event::factory()->for($user)->create();
    Event::factory()->for($otherUser)->create();

    $this->actingAs($user);

    $result = Livewire::test(Profile::class)
        ->instance()
        ->fetchEvents();

    expect($result)->toHaveCount(1);
    expect($result[0]['id'])->toBe($ownEvent->id);
    expect(array_keys($result[0]))->toBe(['id', 'occurredAt', 'payload']);
});

it('every $wire.<method> in the profile module exists as a public method of the page', function (): void {
    preg_match_all('/\$wire\.(\w+)\(/', file_get_contents(resource_path('js/auth/profilePage.js')), $matches);

    expect($matches[1])->not->toBeEmpty();

    $publicMethods = collect((new ReflectionClass(Profile::class))->getMethods(ReflectionMethod::IS_PUBLIC))
        ->keyBy->getName();

    foreach (array_unique($matches[1]) as $method) {
        expect($publicMethods->has($method))->toBeTrue(
            sprintf('The module calls $wire.%s() and that page has no such public method.', $method)
        );
    }
});
