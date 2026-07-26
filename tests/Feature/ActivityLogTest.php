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
 * Las rutas reales viven en `PhrPanelProvider` detrás de toda la pila del panel (secreto de sesión,
 * caducidad por inactividad). Aquí se montan equivalentes con el mismo controlador y solo `auth`,
 * como ya hace `UpdateSettingsTest`: lo que se prueba es el rastro, no el middleware.
 */
beforeEach(function (): void {
    Route::middleware('auth')->put('/test/phr/settings', UpdateSettingsController::class);
    /** El bloqueo necesita sesión de verdad: destruye el secreto y la invalida. */
    Route::middleware(['web', 'auth'])->post('/test/phr/lock', LockController::class);
});

/**
 * Rastro de actividad: qué ocurrió y cuándo, nunca qué contenía.
 *
 * En una aplicación de conocimiento cero esto es lo único que el servidor puede contar, así que la
 * prueba que más importa de este fichero no es que se escriban las filas, sino la última: que
 * ninguna de ellas contenga texto cifrado. Un registro que copiase el sobre multiplicaría los
 * sitios de los que habría que borrarlo y no aportaría nada, porque el servidor no puede abrirlo.
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

it('anota la creación de un evento clínico sin copiar el sobre', function (): void {
    $event = Event::factory()->create();

    $activity = lastActivity();

    expect($activity->log_name)->toBe(Event::LOG_NAME)
        ->and($activity->event)->toBe('created')
        ->and($activity->subject_id)->toBe($event->getKey())
        ->and($activity->subject_type)->toBe(Event::class)
        ->and($activity->properties->toArray())->toBe([]);
});

it('anota la actualización de un evento clínico', function (): void {
    $event = Event::factory()->create();

    $event->forceFill(['payload' => envelopeCipherText(1024)])->save();

    expect(lastActivity()->event)->toBe('updated');
});

/**
 * Marcar para borrar y borrar de verdad son dos hechos distintos y se anotan por separado: el
 * primero es reversible y el segundo no.
 */
it('distingue el borrado reversible del definitivo', function (): void {
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
 * `forceDelete()` dispara `deleted` y después `forceDeleted`, así que sin la guardia del modelo una
 * sola acción dejaría dos filas y el historial contaría dos borrados donde hubo uno.
 */
it('no duplica la fila al borrar definitivamente un evento nunca marcado', function (): void {
    $event = Event::factory()->create();

    $event->forceDelete();

    expect(activityEvents(Event::LOG_NAME))->toBe(['created', 'forceDeleted']);
});

it('anota el cambio de ajustes sin decir cuáles', function (): void {
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

it('anota el cierre de sesión antes de perder a quién atribuirlo', function (): void {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->postJson('/test/phr/lock')
        ->assertOk();

    $activity = lastActivity();

    expect($activity->event)->toBe(AuditEvent::LoggedOut->value)
        ->and($activity->causer_id)->toBe($user->getKey());
});

it('no anota nada cuando la escritura de ajustes se rechaza', function (): void {
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
 * La comprobación que sostiene todo lo demás: ninguna columna del registro puede contener texto
 * cifrado. Si alguna vez alguien añade `->logAll()` o mete el sobre en `properties`, esto falla.
 */
it('nunca guarda texto cifrado en el registro de actividad', function (): void {
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
