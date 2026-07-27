<?php

declare(strict_types=1);

use App\Crypto\CanonicalDate;
use App\Http\Controllers\Sharing\IssueShareLinkController;
use App\Http\Controllers\Sharing\ListSharesController;
use App\Http\Controllers\Sharing\RevokeShareController;
use App\Http\Controllers\Sharing\StoreShareController;
use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use App\Sharing\Shares;
use App\Support\AuditEvent;
use Database\Factories\ShareFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Spatie\Activitylog\Models\Activity;

uses(RefreshDatabase::class);

/**
 * Las rutas reales viven en `PhrPanelProvider::sessionRoutes()`, que arrastra todo el panel de
 * Filament. Aquí se montan equivalentes —mismos controladores, mismo middleware de autenticación—
 * para probar la lógica sin depender de ese registro, igual que hace `UpdateSettingsTest`.
 */
beforeEach(function (): void {
    Route::middleware('auth')->group(function (): void {
        Route::get('/test/phr/shares', ListSharesController::class);
        Route::post('/test/phr/shares', StoreShareController::class);
        Route::post('/test/phr/shares/{share}/links', IssueShareLinkController::class);
        Route::delete('/test/phr/shares/{share}', RevokeShareController::class);
    });
});

/**
 * Cuerpo bien formado de creación. Todo lo que el servidor puede comprobar es forma, así que los
 * valores son bytes con la longitud correcta y ningún significado criptográfico.
 *
 * @return array<string, mixed>
 */
function shareCreationBody(array $overrides = []): array
{
    return array_replace_recursive([
        'id' => (string) Str::uuid(),
        'payload' => ShareFactory::fakePackage(),
        'descriptor' => ShareFactory::fakeEnvelope(),
        'expiresAt' => CanonicalDate::format(now()->addDay()),
        'link' => shareLinkBody(),
    ], $overrides);
}

/**
 * @return array<string, string>
 */
function shareLinkBody(array $overrides = []): array
{
    return array_replace([
        'id' => (string) Str::uuid(),
        'pinSalt' => Base64Url::encode(random_bytes(ShareLink::PIN_SALT_BYTES)),
        'pinTag' => Base64Url::encode(random_bytes(ShareLink::PIN_TAG_BYTES)),
        'wrapper' => ShareFactory::fakeEnvelope(),
    ], $overrides);
}

it('crea el recorte y su primer enlace en una sola llamada', function (): void {
    $user = User::factory()->registered()->create();
    $body = shareCreationBody();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', $body)
        ->assertCreated()
        ->assertJson(['id' => $body['id']]);

    $share = Share::query()->sole();

    expect($share->user_id)->toBe($user->id)
        ->and($share->payload)->toBe($body['payload'])
        ->and($share->descriptor)->toBe($body['descriptor'])
        ->and($share->opened_at)->toBeNull()
        ->and($share->links()->count())->toBe(1)
        ->and($share->links()->sole()->attempts_remaining)->toBe(ShareLink::MAX_ATTEMPTS)
        /** El enlace hereda la caducidad del recorte: no puede vivir más que el paquete que sirve. */
        ->and($share->links()->sole()->expires_at->equalTo($share->expires_at))->toBeTrue();
});

/**
 * ADR 0011: **ninguna columna en claro describe el contenido del recorte**. Este test es el que
 * cierra la promesa del esquema, y por eso enumera las columnas en lugar de comprobar ausencias
 * sueltas: añadir un `types` o un `range_from` en el futuro lo rompe.
 */
it('no tiene ninguna columna en claro que describa el recorte', function (): void {
    expect(Schema::getColumnListing('shares'))
        ->toEqualCanonicalizing(['id', 'user_id', 'expires_at', 'payload', 'descriptor', 'opened_at', 'created_at'])
        ->and(Schema::getColumnListing('share_links'))
        ->toEqualCanonicalizing([
            'id', 'share_id', 'pin_salt', 'pin_tag', 'attempts_remaining', 'wrapper', 'expires_at', 'created_at',
        ]);
});

/**
 * Sin `updated_at` en ninguna de las dos, y sin `deleted_at`: revocar borra de verdad (excepción
 * consciente al patrón del ADR 0006).
 */
it('no lleva updated_at ni lápida de borrado', function (string $table): void {
    expect(Schema::hasColumn($table, 'updated_at'))->toBeFalse()
        ->and(Schema::hasColumn($table, 'deleted_at'))->toBeFalse();
})->with(['shares', 'share_links']);

it('rechaza un paquete que no tiene forma de sobre s1.', function (mixed $payload): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody(['payload' => $payload]))
        ->assertStatus(422)
        ->assertJson(['error' => 'invalid_package']);

    expect(Share::query()->count())->toBe(0);
})->with([
    'sobre de evento' => fn (): string => ShareFactory::fakeEnvelope(),
    'tamaño fuera de la escalera' => fn (): string => 's1.'.rtrim(strtr(base64_encode(random_bytes(4096)), '+/', '-_'), '='),
    'texto suelto' => 'no es un sobre',
]);

it('rechaza un descriptor que no tiene forma de sobre v1.', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody(['descriptor' => ShareFactory::fakePackage()]))
        ->assertStatus(422)
        ->assertJson(['error' => 'invalid_descriptor']);
});

/**
 * El ADR descarta UUIDv7 para estos identificadores: llevan el instante de creación en claro dentro
 * del propio enlace y de la foto que el profesional guarde.
 */
it('rechaza un identificador que no es UUIDv4', function (): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody(['id' => (string) Str::uuid7()]))
        ->assertStatus(422)
        ->assertJson(['error' => 'invalid_share_id']);

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody(['link' => shareLinkBody(['id' => (string) Str::uuid7()])]))
        ->assertStatus(422)
        ->assertJson(['error' => 'invalid_link']);
});

/**
 * La caducidad la fija el cliente porque entra en la derivación de `wrapKey`, pero sale de una lista
 * cerrada y el servidor lo comprueba: 1 hora, 24 horas y 7 días, con holgura para el Argon2id.
 */
it('acepta solo las caducidades de la lista cerrada', function (string $expiresAt, bool $accepted): void {
    $user = User::factory()->registered()->create();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody(['expiresAt' => $expiresAt]))
        ->assertStatus($accepted ? 201 : 422);
})->with([
    'una hora' => [fn (): string => CanonicalDate::format(now()->addHour()), true],
    'un día' => [fn (): string => CanonicalDate::format(now()->addDay()), true],
    'siete días' => [fn (): string => CanonicalDate::format(now()->addDays(7)), true],
    'tres días' => [fn (): string => CanonicalDate::format(now()->addDays(3)), false],
    'un mes' => [fn (): string => CanonicalDate::format(now()->addMonth()), false],
    'en el pasado' => [fn (): string => CanonicalDate::format(now()->subHour()), false],
    'no canónica' => ['2026-07-27T10:00:00Z', false],
]);

it('lista solo los recortes propios y vivos', function (): void {
    $user = User::factory()->registered()->create();
    $other = User::factory()->registered()->create();

    $mine = Share::factory()->for($user)->create();
    Share::factory()->for($user)->expired()->create();
    Share::factory()->for($other)->create();

    $response = $this->actingAs($user)->getJson('/test/phr/shares')->assertOk();

    expect($response->json('shares'))->toHaveCount(1)
        ->and($response->json('shares.0.id'))->toBe($mine->id)
        ->and($response->json('shares.0.descriptor'))->toBe($mine->descriptor);
});

/**
 * Ni el paquete, ni la sal, ni el comprobante del PIN, ni el envoltorio salen por el listado. Es la
 * propia dueña quien pregunta, así que hoy no rompe nada; devolverlos convertiría cualquier fuga
 * futura de esta respuesta en el ataque fuera de línea que el ADR corrigió.
 */
it('no devuelve en el listado el paquete ni el material del PIN', function (): void {
    $user = User::factory()->registered()->create();
    $share = Share::factory()->for($user)->create();
    ShareLink::factory()->for($share)->create();

    $body = $this->actingAs($user)->getJson('/test/phr/shares')->assertOk()->json();
    $encoded = json_encode($body);

    expect($body['shares'][0])->not->toHaveKey('payload')
        ->and($body['shares'][0]['links'][0])->not->toHaveKeys(['pinSalt', 'pinTag', 'wrapper'])
        ->and($encoded)->not->toContain($share->payload);
});

it('no deja revocar ni re-armar el recorte de otra persona', function (): void {
    $user = User::factory()->registered()->create();
    $other = User::factory()->registered()->create();
    $theirs = Share::factory()->for($other)->create();

    $this->actingAs($user)
        ->deleteJson("/test/phr/shares/{$theirs->id}")
        ->assertNotFound();

    $this->actingAs($user)
        ->postJson("/test/phr/shares/{$theirs->id}/links", ['link' => shareLinkBody()])
        ->assertNotFound();

    expect(Share::query()->whereKey($theirs->id)->exists())->toBeTrue();
});

/** Revocar es borrado físico, no una lápida: el paquete tiene que desaparecer de la tabla. */
it('revocar borra el recorte y sus enlaces de verdad', function (): void {
    $user = User::factory()->registered()->create();
    $share = Share::factory()->for($user)->create();
    ShareLink::factory()->count(2)->for($share)->create();

    $this->actingAs($user)->deleteJson("/test/phr/shares/{$share->id}")->assertOk();

    expect(Share::query()->count())->toBe(0)
        ->and(ShareLink::query()->count())->toBe(0);
});

/**
 * Re-armar es la razón de ser de las dos capas: `S` y PIN nuevos sin volver a subir el paquete.
 */
it('re-arma un enlace sobre el mismo paquete', function (): void {
    $user = User::factory()->registered()->create();
    $share = Share::factory()->for($user)->create();
    $payload = $share->payload;

    $this->actingAs($user)
        ->postJson("/test/phr/shares/{$share->id}/links", ['link' => shareLinkBody()])
        ->assertCreated();

    expect($share->refresh()->payload)->toBe($payload)
        ->and($share->links()->count())->toBe(1);
});

it('aplica el tope de recortes activos por usuario', function (): void {
    $user = User::factory()->registered()->create();
    Share::factory()->count(Shares::MAX_ACTIVE_SHARES)->for($user)->create();

    $this->actingAs($user)
        ->postJson('/test/phr/shares', shareCreationBody())
        ->assertStatus(409)
        ->assertJson(['error' => 'share_limit_reached']);
});

it('aplica el tope de enlaces vivos por recorte', function (): void {
    $user = User::factory()->registered()->create();
    $share = Share::factory()->for($user)->create();
    ShareLink::factory()->count(Shares::MAX_LINKS_PER_SHARE)->for($share)->create();

    $this->actingAs($user)
        ->postJson("/test/phr/shares/{$share->id}/links", ['link' => shareLinkBody()])
        ->assertStatus(409);
});

/**
 * El rastro anota que hubo una compartición y cuándo, nunca de qué: ni rango, ni tipos, ni
 * identificador del recorte, que además se borra al revocarlo.
 */
it('anota crear y revocar sin contar nada del contenido', function (): void {
    $user = User::factory()->registered()->create();
    $body = shareCreationBody();

    $this->actingAs($user)->postJson('/test/phr/shares', $body)->assertCreated();
    $this->actingAs($user)->deleteJson("/test/phr/shares/{$body['id']}")->assertOk();

    $events = Activity::query()->where('log_name', AuditEvent::LOG_NAME)->pluck('event');

    expect($events)->toContain(AuditEvent::ShareCreated->value)
        ->toContain(AuditEvent::ShareRevoked->value);

    Activity::query()
        ->whereIn('event', [AuditEvent::ShareCreated->value, AuditEvent::ShareRevoked->value])
        ->each(function (Activity $activity) use ($user, $body): void {
            expect($activity->subject_id)->toBe($user->id)
                ->and(json_encode($activity->properties))->not->toContain($body['payload'])
                ->and(json_encode($activity->properties))->not->toContain($body['descriptor'])
                ->and(json_encode($activity->properties))->not->toContain($body['id']);
        });
});

/** No hay entrada de auditoría para las descargas: sería el historial de accesos que el ADR descarta. */
it('no define ningún evento de auditoría para las descargas', function (): void {
    $values = array_map(fn (AuditEvent $case): string => $case->value, AuditEvent::cases());

    expect($values)->not->toContain('share-opened')
        ->and($values)->not->toContain('share-downloaded');
});
