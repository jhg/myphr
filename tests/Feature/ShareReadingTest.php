<?php

declare(strict_types=1);

use App\Models\Share;
use App\Models\ShareLink;
use App\Security\Opaque\Base64Url;
use App\Sharing\DecoySalt;
use App\Sharing\InvalidShareLinkException;
use App\Sharing\ShareLinkGate;
use App\Support\AuditEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Spatie\Activitylog\Models\Activity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    /**
     * La sal señuelo cuelga de una clave propia del servidor y no de `APP_KEY` (ADR 0011). En los
     * tests se fija explícitamente, porque de eso depende que un enlace muerto sea indistinguible de
     * uno vivo.
     */
    config()->set('share.decoy_salt_key', Base64Url::encode(str_repeat("\x2a", 32)));
});

/**
 * Enlace vivo con un comprobante conocido, para poder abrirlo. El tag real lo calcula el cliente con
 * Argon2id sobre el PIN; el servidor solo lo compara, así que aquí basta con 32 bytes fijos.
 *
 * @return array{0: ShareLink, 1: string}
 */
function liveShareLink(array $linkState = []): array
{
    $tag = random_bytes(ShareLink::PIN_TAG_BYTES);
    $link = ShareLink::factory()->create(array_replace(['pin_tag' => $tag], $linkState));

    return [$link, Base64Url::encode($tag)];
}

function openShare(string $linkId, string $pinTag): TestResponse
{
    return test()->postJson("/s/{$linkId}/open", ['pinTag' => $pinTag]);
}

it('devuelve el envoltorio y el paquete solo con el PIN correcto', function (): void {
    [$link, $tag] = liveShareLink();

    $body = json_decode(openShare($link->id, $tag)->assertOk()->getContent(), true);

    expect($body['wrapper'])->toBe($link->wrapper)
        ->and($body['package'])->toBe($link->share->payload);
});

/**
 * El fallo crítico que este diseño corrigió: si el servidor entrega un solo byte del paquete antes
 * de validar el PIN, el ataque fuera de línea vuelve. Ni el `challenge` ni un `open` fallido pueden
 * contener nada del paquete ni del envoltorio.
 */
it('no filtra un solo byte del paquete antes de validar el PIN', function (): void {
    [$link] = liveShareLink();

    $challenge = $this->postJson("/s/{$link->id}/challenge")->assertOk()->getContent();
    $failed = openShare($link->id, Base64Url::encode(random_bytes(32)))->getContent();

    foreach ([$challenge, $failed] as $body) {
        expect($body)->not->toContain($link->share->payload)
            ->and($body)->not->toContain($link->wrapper)
            ->and($body)->not->toContain(substr($link->share->payload, 0, 40))
            ->and($body)->not->toContain(substr($link->wrapper, 0, 40));
    }
});

/**
 * La respuesta genérica única. Las cuatro causas —no existe, caducó, se revocó y PIN incorrecto—
 * tienen que producir exactamente la misma respuesta: mismo código, mismo cuerpo, mismas cabeceras
 * que dependan del caso. Si se distinguen, una lista de identificadores se convierte en un mapa de
 * qué recortes siguen vivos.
 */
it('responde lo mismo ante las cuatro causas de fallo', function (): void {
    [$live] = liveShareLink();
    [$expired, $expiredTag] = liveShareLink(['expires_at' => now()->subMinute()]);
    [$revoked, $revokedTag] = liveShareLink();
    $revoked->share->delete();

    $responses = [
        'inexistente' => openShare((string) Str::uuid(), Base64Url::encode(random_bytes(32))),
        'caducado' => openShare($expired->id, $expiredTag),
        'revocado' => openShare($revoked->id, $revokedTag),
        'PIN incorrecto' => openShare($live->id, Base64Url::encode(random_bytes(32))),
    ];

    $seen = [];

    foreach ($responses as $name => $response) {
        $seen[$name] = [
            'status' => $response->getStatusCode(),
            'body' => $response->getContent(),
            'type' => $response->headers->get('Content-Type'),
        ];
    }

    expect(array_unique(array_map('json_encode', $seen)))->toHaveCount(1)
        ->and($seen['inexistente']['status'])->toBe(403)
        ->and($seen['inexistente']['body'])->toContain(InvalidShareLinkException::CODE);
});

/**
 * En `challenge` no hay PIN que valorar todavía, así que un enlace muerto tiene que devolver una sal
 * con la misma forma que uno vivo, y la misma cada vez que se pregunte.
 */
it('devuelve una sal señuelo estable e indistinguible para enlaces que no existen', function (): void {
    [$live] = liveShareLink();
    $ghost = (string) Str::uuid();

    $vivo = $this->postJson("/s/{$live->id}/challenge")->assertOk()->json('pinSalt');
    $muerto = $this->postJson("/s/{$ghost}/challenge")->assertOk()->json('pinSalt');
    $otraVez = $this->postJson("/s/{$ghost}/challenge")->assertOk()->json('pinSalt');

    expect(strlen(Base64Url::decode($vivo)))->toBe(ShareLink::PIN_SALT_BYTES)
        ->and(strlen(Base64Url::decode($muerto)))->toBe(ShareLink::PIN_SALT_BYTES)
        ->and($muerto)->toBe($otraVez)
        ->and($muerto)->not->toBe($vivo);
});

/** Caducado y revocado tampoco pueden distinguirse en el `challenge`. */
it('da sal señuelo también a los enlaces caducados y revocados', function (): void {
    [$expired] = liveShareLink(['expires_at' => now()->subMinute()]);
    [$revoked] = liveShareLink();
    $revoked->share->delete();

    $decoy = app(DecoySalt::class);

    foreach ([$expired->id, $revoked->id] as $id) {
        $salt = $this->postJson("/s/{$id}/challenge")->assertOk()->json('pinSalt');

        expect(Base64Url::decode($salt))->toBe($decoy->for($id));
    }
});

/** Un enlace vivo cuyo recorte caducó no sirve nada, aunque el propio enlace siga vigente. */
it('no sirve un enlace vivo si su recorte caducó', function (): void {
    $share = Share::factory()->expired()->create();
    [$link, $tag] = liveShareLink(['share_id' => $share->id]);

    openShare($link->id, $tag)->assertStatus(403);
});

it('gasta un intento por cada PIN incorrecto y borra el enlace al agotarlos', function (): void {
    [$link] = liveShareLink();

    for ($attempt = ShareLink::MAX_ATTEMPTS; $attempt > 0; $attempt--) {
        openShare($link->id, Base64Url::encode(random_bytes(32)))->assertStatus(403);

        if ($attempt > 1) {
            expect(ShareLink::query()->whereKey($link->id)->value('attempts_remaining'))->toBe($attempt - 1);
        }
    }

    /** Agotar los intentos borra solo la fila del enlace, nunca el paquete. */
    expect(ShareLink::query()->whereKey($link->id)->exists())->toBeFalse()
        ->and(Share::query()->whereKey($link->share_id)->exists())->toBeTrue();
});

/** El PIN correcto devuelve el contador a su tope: los intentos acotan la fuerza bruta, no las lecturas. */
it('rearma el contador tras una apertura correcta', function (): void {
    [$link, $tag] = liveShareLink();

    openShare($link->id, Base64Url::encode(random_bytes(32)))->assertStatus(403);
    openShare($link->id, $tag)->assertOk();

    expect(ShareLink::query()->whereKey($link->id)->value('attempts_remaining'))
        ->toBe(ShareLink::MAX_ATTEMPTS);
});

/**
 * El contador vive en columna y se consume con una escritura condicional atómica. Se simula la
 * carrera igual que `RegistrationLinksTest`: una petición rival vacía el contador justo antes de que
 * se ejecute nuestro `update`, y el nuestro tiene que afectar a cero filas.
 */
it('es atómico: dos peticiones simultáneas no comparten el mismo intento', function (): void {
    [$link, $tag] = liveShareLink(['attempts_remaining' => 1]);
    $intercepted = false;

    DB::connection()->beforeExecuting(function (string $query) use (&$intercepted, $link): void {
        if ($intercepted || ! str_starts_with($query, 'update "share_links"')) {
            return;
        }

        $intercepted = true;

        DB::table('share_links')->where('id', $link->id)->update(['attempts_remaining' => 0]);
    });

    expect(fn () => app(ShareLinkGate::class)->open($link->id, Base64Url::decode($tag)))
        ->toThrow(InvalidShareLinkException::class)
        ->and($intercepted)->toBeTrue()
        ->and(DB::table('share_links')->where('id', $link->id)->value('attempts_remaining'))->toBe(0);
});

/** `lockForUpdate()` es un no-op en SQLite: un contador apoyado en él pasaría los tests sin proteger nada. */
it('no usa lockForUpdate en la puerta de lectura', function (): void {
    expect(file_get_contents(app_path('Sharing/ShareLinkGate.php')))
        ->not->toContain('->lockForUpdate(');
});

/**
 * `opened_at` es la marca del primer acceso, redondeada a la hora y escrita una sola vez. No hay
 * contador de descargas ni historial.
 */
it('marca el primer acceso una sola vez y redondeado a la hora', function (): void {
    [$link, $tag] = liveShareLink();

    $this->travelTo(now()->startOfHour()->addMinutes(37));
    openShare($link->id, $tag)->assertOk();

    $openedAt = fn (): string => Share::query()
        ->whereKey($link->share_id)
        ->value('opened_at')
        ->format('Y-m-d H:i:s');

    $first = $openedAt();

    $this->travelTo(now()->addHours(2));
    openShare($link->id, $tag)->assertOk();

    expect($first)->toBe(now()->subHours(2)->startOfHour()->format('Y-m-d H:i:s'))
        ->and($openedAt())->toBe($first);
});

/**
 * La respuesta no lleva validadores de caché ni nombre de fichero descriptivo, y sí `no-store`. El
 * nombre de un adjunto es metadato clínico.
 */
it('sirve el paquete sin caché, sin ETag y sin Content-Disposition', function (): void {
    [$link, $tag] = liveShareLink();

    $response = openShare($link->id, $tag)->assertOk();

    expect($response->headers->get('Content-Type'))->toBe('application/octet-stream')
        ->and($response->headers->get('Cache-Control'))->toContain('no-store')
        ->and($response->headers->has('ETag'))->toBeFalse()
        ->and($response->headers->has('Last-Modified'))->toBeFalse()
        ->and($response->headers->has('Content-Disposition'))->toBeFalse();
});

/** Las rutas del lector no llevan sesión: quien las usa no tiene cuenta y no debe recibir cookies. */
it('lee sin sesión, sin CSRF y sin dejar cookies', function (): void {
    [$link, $tag] = liveShareLink();

    $response = openShare($link->id, $tag)->assertOk();

    expect($response->headers->getCookies())->toBeEmpty();
});

/** Ninguna descarga deja rastro de actividad: sería el historial de accesos que el ADR 0006 descarta. */
it('no anota nada al abrir un recorte', function (): void {
    [$link, $tag] = liveShareLink();

    openShare($link->id, $tag)->assertOk();

    expect(Activity::query()->where('log_name', AuditEvent::LOG_NAME)->count())->toBe(0);
});
