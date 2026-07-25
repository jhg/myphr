<?php

declare(strict_types=1);

use App\Http\Controllers\Settings\UpdateSettingsController;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;

uses(RefreshDatabase::class);

/**
 * La ruta real vive en `PhrPanelProvider::sessionRoutes()`, que registra otro trabajo. Aquí se monta
 * una equivalente (mismo controlador, mismo middleware de autenticación) para probar el controlador
 * sin depender de ese registro.
 */
beforeEach(function (): void {
    Route::middleware('auth')->put('/test/phr/settings', UpdateSettingsController::class);
});

/** Precondición `If-Match` del sobre vigente de un usuario. */
function ifMatchFor(?string $envelope): string
{
    return $envelope === null || $envelope === '' ? '*' : '"'.hash('sha256', $envelope).'"';
}

it('persists a well formed envelope and returns its tag', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => null]);
    $envelope = envelopeCipherText();

    $this->actingAs($user)
        ->putJson('/test/phr/settings', ['encryptedSettings' => $envelope], ['If-Match' => '*'])
        ->assertOk()
        ->assertJson(['saved' => true])
        ->assertHeader('ETag', ifMatchFor($envelope));

    expect($user->refresh()->encrypted_settings)->toBe($envelope);
});

/**
 * El servidor solo valida la envoltura, pero la valida de verdad: un sobre que el cliente nunca
 * podría abrir no se almacena, porque sustituiría al único que sí abre.
 */
it('rejects a malformed envelope without writing anything', function (string $envelope): void {
    $original = envelopeCipherText();
    $user = User::factory()->registered()->create(['encrypted_settings' => $original]);

    $this->actingAs($user)
        ->putJson('/test/phr/settings', ['encryptedSettings' => $envelope], ['If-Match' => ifMatchFor($original)])
        ->assertStatus(422)
        ->assertJson(['error' => 'invalid_settings']);

    expect($user->refresh()->encrypted_settings)->toBe($original);
})->with([
    'sin prefijo v1.' => fn (): string => substr(envelopeCipherText(), 3),
    'base64url no canónico' => fn (): string => 'v1.no-es-base64url!!',
    'tamaño que no es de relleno' => fn (): string => 'v1.'.rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '='),
]);

/**
 * El usuario sale de la sesión y nunca del cuerpo: no hay campo por el que apuntar a otra fila.
 */
it('never writes the settings of another user', function (): void {
    $other = User::factory()->registered()->create(['encrypted_settings' => $otherEnvelope = envelopeCipherText()]);
    $user = User::factory()->registered()->create(['encrypted_settings' => null]);

    $this->actingAs($user)
        ->putJson('/test/phr/settings', [
            'encryptedSettings' => $mine = envelopeCipherText(),
            'userId' => $other->id,
            'user_id' => $other->id,
        ], ['If-Match' => '*'])
        ->assertOk();

    expect($other->refresh()->encrypted_settings)->toBe($otherEnvelope)
        ->and($user->refresh()->encrypted_settings)->toBe($mine);
});

/** Dos pestañas: la segunda escritura no puede pisar en silencio a la primera. */
it('rejects a stale If-Match instead of losing the other write', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => envelopeCipherText()]);
    $stale = ifMatchFor(envelopeCipherText());

    $this->actingAs($user)
        ->putJson('/test/phr/settings', ['encryptedSettings' => envelopeCipherText()], ['If-Match' => $stale])
        ->assertStatus(412)
        ->assertJson(['error' => 'settings_conflict']);
});

it('requires the If-Match precondition', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => null]);

    $this->actingAs($user)
        ->putJson('/test/phr/settings', ['encryptedSettings' => envelopeCipherText()])
        ->assertStatus(428)
        ->assertJson(['error' => 'precondition_required']);

    expect($user->refresh()->encrypted_settings)->toBeNull();
});

/**
 * El idioma es el único campo que viaja fuera del sobre, en claro, en `users.locale`: es la
 * excepción consciente del ADR 0007, porque el servidor tiene que resolverlo para pintar el panel y
 * no puede leer lo que va cifrado. Sin este test, que la elección de idioma no llegue a persistirse
 * es un fallo silencioso: el formulario responde 200 y la preferencia se pierde.
 */
it('guarda el idioma en claro junto al sobre cifrado', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => null, 'locale' => null]);
    $envelope = envelopeCipherText();

    $this->actingAs($user)
        ->putJson(
            '/test/phr/settings',
            ['encryptedSettings' => $envelope, 'locale' => 'zh_CN'],
            ['If-Match' => '*'],
        )
        ->assertOk();

    expect($user->refresh()->locale)->toBe('zh_CN')
        ->and($user->encrypted_settings)->toBe($envelope);
});

/**
 * Lista cerrada: el valor acaba en `App::setLocale()` y elige un fichero de idioma, así que aceptar
 * cualquier cadena dejaría al panel sin traducir sin decir por qué.
 */
it('rechaza un idioma que no está soportado y no escribe nada', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => null, 'locale' => 'es']);

    $this->actingAs($user)
        ->putJson(
            '/test/phr/settings',
            ['encryptedSettings' => envelopeCipherText(), 'locale' => 'klingon'],
            ['If-Match' => '*'],
        )
        ->assertUnprocessable();

    expect($user->refresh()->locale)->toBe('es')
        ->and($user->encrypted_settings)->toBeNull();
});

/**
 * Los tests de arriba montan una ruta equivalente para probar el controlador aislado, así que no
 * ven la ruta real ni su pila de middleware. Este sí: si el registro en el panel se pierde o cambia
 * de método, el resto seguiría en verde mientras la pantalla falla en el navegador, que es
 * exactamente lo que ocurrió con el idioma.
 */
it('la ruta real del panel guarda los ajustes y el idioma', function (): void {
    $user = User::factory()->registered()->create(['encrypted_settings' => null, 'locale' => null]);
    $envelope = envelopeCipherText();

    $this->actingAs($user)
        ->putJson('/phr/settings', ['encryptedSettings' => $envelope, 'locale' => 'zh_CN'], ['If-Match' => '*'])
        ->assertOk();

    expect($user->refresh()->locale)->toBe('zh_CN')
        ->and($user->encrypted_settings)->toBe($envelope);
});
