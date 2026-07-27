<?php

declare(strict_types=1);

use App\Crypto\CanonicalDate;
use App\Http\Controllers\Sharing\IssueShareLinkController;
use App\Http\Controllers\Sharing\ListSharesController;
use App\Http\Controllers\Sharing\StoreShareController;
use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use Database\Factories\ShareFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    config()->set('share.decoy_salt_key', Base64Url::encode(str_repeat("\x2a", 32)));

    Route::middleware('auth')->group(function (): void {
        Route::get('/test/phr/shares', ListSharesController::class);
        Route::post('/test/phr/shares', StoreShareController::class);
        Route::post('/test/phr/shares/{share}/links', IssueShareLinkController::class);
    });
});

/**
 * Cuerpo de creación con una caducidad que lleva fracción de segundo, como la que produce el
 * `new Date()` del navegador.
 *
 * @return array{body: array<string, mixed>, canonical: string, linkId: string, pinTag: string}
 */
function shareBodyWithFractionalExpiry(): array
{
    $expiresAt = Carbon::now()->addDay()->startOfSecond()->addMilliseconds(123);
    $canonical = CanonicalDate::format($expiresAt);

    $linkId = (string) Str::uuid();
    $pinTag = random_bytes(ShareLink::PIN_TAG_BYTES);

    return [
        'body' => [
            'id' => (string) Str::uuid(),
            'payload' => ShareFactory::fakePackage(),
            'descriptor' => ShareFactory::fakeEnvelope(),
            'expiresAt' => $canonical,
            'link' => [
                'id' => $linkId,
                'pinSalt' => Base64Url::encode(random_bytes(ShareLink::PIN_SALT_BYTES)),
                'pinTag' => Base64Url::encode($pinTag),
                'wrapper' => ShareFactory::fakeEnvelope(),
            ],
        ],
        'canonical' => $canonical,
        'linkId' => $linkId,
        'pinTag' => $pinTag,
    ];
}

/**
 * Reproduce el fallo real del lector: PIN correcto y aviso de «historial alterado o incompleto».
 *
 * `canonicalDate(expiresAt)` entra en el `info` de `wrapKey` y en el dato asociado del envoltorio
 * (ADR 0011). El cliente lo calcula sobre un `new Date()`, que lleva milisegundos, y lo manda tal
 * cual; `open` tiene que devolver **la misma cadena**, byte a byte, o el envoltorio no abre y el
 * lector enseña `reader.error.tampered`.
 */
it('devuelve en open el mismo expiresAt canónico que el cliente usó al cifrar', function (): void {
    $user = User::factory()->registered()->create();

    /** Instante con milisegundos, como el `new Date()` del navegador. */
    ['body' => $body, 'canonical' => $canonical, 'linkId' => $linkId, 'pinTag' => $pinTag] = shareBodyWithFractionalExpiry();

    $this->actingAs($user)->postJson('/test/phr/shares', $body)->assertCreated();

    $opened = $this->postJson("/s/{$linkId}/open", ['pinTag' => Base64Url::encode($pinTag)])
        ->assertOk()
        ->getContent();

    expect(json_decode((string) $opened, true)['expiresAt'])->toBe($canonical);
});

/**
 * Hermano del mismo fallo, un salto más allá: `open` no es el único sitio donde esa fecha vuelve
 * del motor para entrar en un AEAD.
 *
 * Re-armar un enlace (`POST /phr/shares/{share}/links`) obliga al cliente a derivar `wrapKey` con
 * `canonicalDate(expiresAt)`, y esa caducidad no la tiene: la lee del listado, que la saca de la
 * base de datos. Si el listado la devolviese truncada, el enlace re-armado nacería cifrado con una
 * clave que el lector no puede derivar —el servidor le daría en `open` la fecha completa— y el
 * profesional vería «historial alterado» con el PIN correcto, igual que en el fallo original. La
 * pantalla de re-armar todavía no existe en el cliente, así que este test es lo único que sostiene
 * hoy esa costura.
 */
it('devuelve la misma caducidad canónica en el listado y en el enlace re-armado', function (): void {
    $user = User::factory()->registered()->create();

    ['body' => $body, 'canonical' => $canonical] = shareBodyWithFractionalExpiry();

    $this->actingAs($user)->postJson('/test/phr/shares', $body)->assertCreated();

    $listed = $this->actingAs($user)->getJson('/test/phr/shares')
        ->assertOk()
        ->json('shares.0');

    expect($listed['expiresAt'])->toBe($canonical)
        ->and($listed['links'][0]['expiresAt'])->toBe($canonical);

    /** El enlace nuevo hereda la caducidad del recorte releído, así que es el mismo viaje. */
    $this->actingAs($user)
        ->postJson("/test/phr/shares/{$body['id']}/links", ['link' => shareBodyWithFractionalExpiry()['body']['link']])
        ->assertCreated()
        ->assertJsonPath('expiresAt', $canonical);

    $stored = Share::query()->findOrFail($body['id'])->links()->get();

    expect($stored->map(fn (ShareLink $link): string => CanonicalDate::format($link->expires_at))->all())
        ->toBe([$canonical, $canonical]);
});
