<?php

declare(strict_types=1);

use App\Http\Controllers\Auth\Opaque\LockController;
use App\Http\Controllers\Settings\UpdateSettingsController;
use App\Models\Event;
use App\Models\User;
use App\Support\AuditEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Spatie\Activitylog\Models\Activity;

uses(RefreshDatabase::class);

/**
 * The real routes live in `PhrPanelProvider` behind the whole panel stack (session secret, idle
 * timeout). Equivalents are mounted here with the same controller and only `auth`, as
 * `UpdateSettingsTest` already does: what is under test is the trail, not the middleware.
 */
beforeEach(function (): void {
    Route::middleware('auth')->put('/test/phr/settings', UpdateSettingsController::class);
    /** Locking needs a real session: it destroys the secret and invalidates it. */
    Route::middleware(['web', 'auth'])->post('/test/phr/lock', LockController::class);
});

/**
 * Activity trail: what happened and when, never what it contained.
 *
 * In a zero-knowledge application this is the only thing the server can tell, so the check that
 * matters most in this file is not that the rows get written, but the last one: that none of them
 * contains ciphertext. A log that copied the envelope would multiply the places you would have to
 * delete it from and would add nothing, because the server cannot open it.
 */
function lastActivity(): Activity
{
    /** @var Activity $activity */
    $activity = Activity::query()->latest('id')->firstOrFail();

    return $activity;
}

/**
 * @return array<int, string>
 */
function activityEvents(string $logName): array
{
    return Activity::query()
        ->where('log_name', $logName)
        ->orderBy('id')
        ->pluck('event')
        ->all();
}

it('records the creation of a clinical event without copying the envelope', function (): void {
    $event = Event::factory()->create();

    $activity = lastActivity();

    expect($activity->log_name)->toBe(Event::LOG_NAME)
        ->and($activity->event)->toBe('created')
        ->and($activity->subject_id)->toBe($event->getKey())
        ->and($activity->subject_type)->toBe(Event::class)
        ->and($activity->properties->toArray())->toBe([]);
});

it('records the update of a clinical event', function (): void {
    $event = Event::factory()->create();

    $event->forceFill(['payload' => envelopeCipherText(1024)])->save();

    expect(lastActivity()->event)->toBe('updated');
});

/**
 * Marking for deletion and really deleting are two different facts and are recorded separately: the
 * first is reversible and the second is not.
 */
it('tells a soft delete apart from a permanent one', function (): void {
    $event = Event::factory()->create();

    $event->delete();
    expect(lastActivity()->event)->toBe('deleted');

    $event->restore();
    expect(lastActivity()->event)->toBe('restored');

    $event->forceDelete();
    expect(lastActivity()->event)->toBe('forceDeleted');

    expect(activityEvents(Event::LOG_NAME))
        ->toBe(['created', 'deleted', 'restored', 'forceDeleted']);
});

/**
 * `forceDelete()` fires `deleted` and then `forceDeleted`, so without the model guard a single
 * action would leave two rows and the history would count two deletions where there was one.
 */
it('does not duplicate the row when permanently deleting an event that was never marked', function (): void {
    $event = Event::factory()->create();

    $event->forceDelete();

    expect(activityEvents(Event::LOG_NAME))->toBe(['created', 'forceDeleted']);
});

it('records the settings change without saying which ones', function (): void {
    $user = User::factory()->create(['encrypted_settings' => null]);

    $this->actingAs($user)
        ->withHeader('If-Match', '*')
        ->putJson('/test/phr/settings', [
            'encryptedSettings' => envelopeCipherText(),
            'locale' => 'es',
        ])
        ->assertOk();

    $activity = lastActivity();

    expect($activity->log_name)->toBe(AuditEvent::LOG_NAME)
        ->and($activity->event)->toBe(AuditEvent::SettingsUpdated->value)
        ->and($activity->causer_id)->toBe($user->getKey())
        ->and($activity->properties->toArray())->toBe([]);
});

it('records the logout before losing who to attribute it to', function (): void {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->postJson('/test/phr/lock')
        ->assertOk();

    $activity = lastActivity();

    expect($activity->event)->toBe(AuditEvent::LoggedOut->value)
        ->and($activity->causer_id)->toBe($user->getKey());
});

it('records nothing when the settings write is rejected', function (): void {
    $user = User::factory()->create(['encrypted_settings' => envelopeCipherText()]);

    $this->actingAs($user)
        ->withHeader('If-Match', '"otra-cosa"')
        ->putJson('/test/phr/settings', [
            'encryptedSettings' => envelopeCipherText(),
        ])
        ->assertStatus(412);

    expect(Activity::query()->count())->toBe(0);
});

/**
 * The check that holds everything else up: no column of the log may contain ciphertext. If somebody
 * ever adds `->logAll()` or puts the envelope in `properties`, this fails.
 */
it('never stores ciphertext in the activity log', function (): void {
    $user = User::factory()->create(['encrypted_settings' => null]);
    $settings = envelopeCipherText();

    $event = Event::factory()->create(['user_id' => $user->id]);
    $event->forceFill(['payload' => envelopeCipherText(1024)])->save();
    $event->delete();

    $this->actingAs($user)
        ->withHeader('If-Match', '*')
        ->putJson('/test/phr/settings', ['encryptedSettings' => $settings])
        ->assertOk();

    $filas = DB::table('activity_log')->get();

    expect($filas)->not->toBeEmpty();

    foreach ($filas as $fila) {
        $serialized = json_encode($fila, JSON_THROW_ON_ERROR);

        expect($serialized)->not->toContain('v1.')
            ->and($serialized)->not->toContain($settings)
            ->and($serialized)->not->toContain((string) $event->payload);
    }
});
