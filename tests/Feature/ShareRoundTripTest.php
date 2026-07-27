<?php

declare(strict_types=1);

use App\Models\Share;
use App\Models\ShareLink;
use App\Models\User;
use App\Security\Opaque\Base64Url;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/**
 * Test de extremo a extremo del recorte compartido (ADR 0011).
 *
 * Cifra con los módulos reales de `resources/js/crypto/` —la mitad de JavaScript vive en
 * `tests/js/support/shareRoundTrip.mjs`— y en medio pone la base de datos y las rutas HTTP de
 * verdad. Es el único sitio del proyecto donde se comprueba la costura completa: lo que el
 * navegador cifra tiene que abrirlo el lector después de que el paquete, el envoltorio y **las
 * fechas** hayan pasado por el servidor.
 *
 * Nació de un fallo real: `expires_at` se guardaba sin fracción de segundo, así que
 * `canonicalDate(expiresAt)` era una cadena al cifrar y otra al descifrar; como esa cadena entra en
 * el `info` de `wrapKey` y en el dato asociado del envoltorio, el AEAD fallaba y el lector enseñaba
 * «historial alterado o incompleto» con el PIN correcto. Ni los tests de PHP ni los de JavaScript lo
 * veían, porque cada mitad era coherente consigo misma.
 */
beforeEach(function (): void {
    config()->set('share.decoy_salt_key', Base64Url::encode(str_repeat("\x2a", 32)));
});

/** `runShareClient()`, the bridge to the JavaScript half, lives in `tests/Pest.php`. */
it('cifra un recorte en el navegador y el lector lo abre tras pasar por el servidor', function (): void {
    $user = User::factory()->registered()->create();

    /**
     * El estiramiento del PIN entra hecho: Argon2id cuesta más de un segundo por lado y no toca
     * nada de esta costura, que es la caducidad y los identificadores. Lo cubre
     * `tests/js/shareKeys.test.mjs`.
     */
    $stretched = Base64Url::encode(random_bytes(32));

    $sealed = runShareClient('seal', [
        'pin' => '048261',
        'stretched' => $stretched,
        'masterKey' => Base64Url::encode(random_bytes(32)),
        'ttlHours' => 24,
        'eventCount' => 7,
    ]);

    expect($sealed['ok'])->toBeTrue(json_encode($sealed));

    $client = $sealed['result'];

    $this->actingAs($user)
        ->postJson(route('filament.phr.shares.store'), $client['request'])
        ->assertCreated();

    /** La sal tiene que volver tal cual se subió, o el lector estiraría el PIN con otra. */
    $this->postJson(route('share.challenge', ['link' => $client['linkId']]))
        ->assertOk()
        ->assertJsonPath('pinSalt', $client['pinSalt']);

    $opened = $this->postJson(
        route('share.open', ['link' => $client['linkId']]),
        ['pinTag' => $client['pinTag']],
    )->assertOk();

    /** @var array<string, mixed> $body */
    $body = json_decode($opened->getContent(), true, 512, JSON_THROW_ON_ERROR);

    $read = runShareClient('open', [
        'stretched' => $stretched,
        'pinSalt' => $client['pinSalt'],
        'fragment' => $client['fragment'],
        'linkId' => $client['linkId'],
        'opened' => $body,
    ]);

    expect($read['ok'])->toBeTrue(json_encode($read));
    expect($read['result']['eventCount'])->toBe($client['eventCount']);
    expect($read['result']['events'])->toBe($client['eventCount']);

    /**
     * La costura, dicha en voz alta: la caducidad que el servidor devuelve tiene que ser, byte a
     * byte, la que el cliente usó al cifrar. Va después del descifrado porque el descifrado es lo
     * que de verdad importa, y aquí para que, si vuelve a romperse, el fallo diga **qué** se rompió
     * y no solo que el sobre no abre.
     */
    expect($body['expiresAt'])->toBe($client['expiresAtSealed']);
});

/**
 * El recorrido completo de la funcionalidad, en un solo test y en el orden en que ocurre de verdad:
 * crear, listar, abrir con el PIN correcto, fallar con uno incorrecto, agotar los cinco intentos y
 * revocar.
 *
 * Los tests de `ShareEndpointsTest` y `ShareReadingTest` cubren cada paso por separado, con paquetes
 * de fábrica y comprobantes al azar. Este va detrás del caso que ninguno de los dos ve: que los seis
 * pasos encadenados sigan cuadrando con **cifrado real**, porque el fallo que motivó todo esto no
 * estaba en ningún paso sino entre dos de ellos. Por eso el descifrado se hace después de un ciclo
 * de PIN incorrecto: si consumir un intento tocase alguna de las piezas que entran en los datos
 * asociados, se vería aquí y en ningún otro sitio.
 */
it('recorre crear, listar, abrir, fallar el PIN, agotar los intentos y revocar', function (): void {
    $user = User::factory()->registered()->create();

    $stretched = Base64Url::encode(random_bytes(32));

    $sealed = runShareClient('seal', [
        'pin' => '731904',
        'stretched' => $stretched,
        'masterKey' => Base64Url::encode(random_bytes(32)),
        'ttlHours' => 24,
        'eventCount' => 3,
    ]);

    expect($sealed['ok'])->toBeTrue(json_encode($sealed));

    $client = $sealed['result'];
    $linkId = $client['linkId'];

    /** 1. Crear. */
    $this->actingAs($user)
        ->postJson(route('filament.phr.shares.store'), $client['request'])
        ->assertCreated();

    /**
     * 2. Listar. La caducidad que sale del listado tiene que ser la misma que se cifró: es la que
     * usaría la pantalla para re-armar un enlace, y sale de la base de datos.
     */
    $this->actingAs($user)->getJson(route('filament.phr.shares.index'))
        ->assertOk()
        ->assertJsonPath('shares.0.id', $client['request']['id'])
        ->assertJsonPath('shares.0.expiresAt', $client['expiresAtSealed'])
        ->assertJsonPath('shares.0.links.0.attemptsRemaining', ShareLink::MAX_ATTEMPTS);

    $wrongPinTag = Base64Url::encode(random_bytes(ShareLink::PIN_TAG_BYTES));

    /** 3. Un PIN incorrecto no devuelve nada y gasta un intento. */
    $this->postJson(route('share.open', ['link' => $linkId]), ['pinTag' => $wrongPinTag])
        ->assertForbidden();

    expect(ShareLink::query()->findOrFail($linkId)->attempts_remaining)
        ->toBe(ShareLink::MAX_ATTEMPTS - 1);

    /** 4. Con el PIN correcto el lector abre el paquete y el contador vuelve a su tope. */
    $body = json_decode(
        (string) $this->postJson(
            route('share.open', ['link' => $linkId]),
            ['pinTag' => $client['pinTag']],
        )->assertOk()->getContent(),
        true,
        512,
        JSON_THROW_ON_ERROR,
    );

    $read = runShareClient('open', [
        'stretched' => $stretched,
        'pinSalt' => $client['pinSalt'],
        'fragment' => $client['fragment'],
        'linkId' => $linkId,
        'opened' => $body,
    ]);

    expect($read['ok'])->toBeTrue(json_encode($read))
        ->and($read['result']['eventCount'])->toBe($client['eventCount'])
        ->and(ShareLink::query()->findOrFail($linkId)->attempts_remaining)->toBe(ShareLink::MAX_ATTEMPTS);

    /** 5. Agotar los cinco intentos borra el enlace, y solo el enlace. */
    for ($attempt = 0; $attempt < ShareLink::MAX_ATTEMPTS; $attempt++) {
        $this->postJson(route('share.open', ['link' => $linkId]), ['pinTag' => $wrongPinTag])
            ->assertForbidden();
    }

    expect(ShareLink::query()->whereKey($linkId)->exists())->toBeFalse()
        ->and(Share::query()->count())->toBe(1);

    /** Ni siquiera con el PIN bueno vuelve a servir: la fila ya no está. */
    $this->postJson(route('share.open', ['link' => $linkId]), ['pinTag' => $client['pinTag']])
        ->assertForbidden();

    /** 6. Revocar borra el recorte de verdad, sin lápida. */
    $this->actingAs($user)
        ->deleteJson(route('filament.phr.shares.destroy', ['share' => $client['request']['id']]))
        ->assertOk();

    expect(Share::query()->count())->toBe(0);
});
